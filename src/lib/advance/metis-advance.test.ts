import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADVANCES ON METIS (26 Oct 2026): the pot, the offer it can pay, the advance out, and the waterfall home.
 * The capacity formula is stubbed (it has its own tests); the ledger is the real database, because its
 * guards (one active advance per borrower, one repayment row per payout) are the point; the chain is
 * stubbed per test, and every money movement is asserted.
 */
const h = vi.hoisted(() => ({ capacity: 5 }));
vi.mock("@/lib/campaigns/credit", () => ({
  walletCreditSignals: () => (h.capacity > 0 ? { record: {}, signals: {} } : null),
  advanceCapacityUsd: () => h.capacity,
}));

import type { Address, Hash } from "viem";
import { db } from "@/lib/db";
import { advanceFeeTopups, advanceRepayments, advances } from "@/lib/db/schema";
import { advanceHistory, createAdvance, getActiveAdvance, reserveFeeTopup } from "@/lib/db/advances";
import { NOT_ON_METIS, offerWithPot, POT_PAUSED, POT_UNREACHABLE } from "./self-serve";
import { disburseAdvance } from "./disburse";
import { collectAdvanceRepayments, type MetisPayout } from "./collect";
import { potConfig, type PotConfig } from "./pot";

const BORROWER = "0x1111111111111111111111111111111111111111";
const POT_KEY = `0x${"7".repeat(64)}`;
const ENV = { ADVANCE_SELF_SERVE: "1", ADVANCE_MAX_USD: "2", ADVANCE_MULTIPLE: "1", ADVANCE_WATERFALL_BPS: "5000" } as unknown as NodeJS.ProcessEnv;
const usdc = (usd: number) => BigInt(Math.round(usd * 1_000_000));
const metis = (n: number) => BigInt(Math.round(n * 1e6)) * BigInt(1e12);
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const pot = (): PotConfig => {
  const c = potConfig({ ADVANCE_POT_PRIVATE_KEY: POT_KEY });
  if (!c.ok) throw new Error(c.message);
  return c.pot;
};

beforeEach(() => {
  db.delete(advanceRepayments).run();
  db.delete(advances).run();
  db.delete(advanceFeeTopups).run();
  h.capacity = 5;
});

describe("the pot's own key", () => {
  it("is off until set, and refuses a malformed key", () => {
    expect(potConfig({})).toMatchObject({ ok: false, reason: "unconfigured" });
    expect(potConfig({ ADVANCE_POT_PRIVATE_KEY: "0x1234" })).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("refuses a key Sage already signs payouts or x402 settlements with: one key is one nonce sequence", () => {
    for (const name of ["GOAT_AGENT_PRIVATE_KEY", "METIS_MAINNET_OPERATOR_PRIVATE_KEY", "X402_METIS_FACILITATOR_PRIVATE_KEY"]) {
      expect(potConfig({ ADVANCE_POT_PRIVATE_KEY: POT_KEY, [name]: POT_KEY.slice(2).toUpperCase() })).toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(potConfig({ ADVANCE_POT_PRIVATE_KEY: POT_KEY }).ok).toBe(true);
  });
});

describe("the offer, as the pot can pay it", () => {
  const deps = (over: Partial<{ usdcBase: bigint; metisWei: bigint; allowance: bigint; borrowerMetis: bigint; covered: boolean }> = {}) => ({
    config: () => ({ ok: true as const, pot: pot() }),
    balances: async () => ({ usdcBase: over.usdcBase ?? usdc(10), metisWei: over.metisWei ?? metis(0.5) }),
    allowance: async () => over.allowance ?? BigInt(0),
    metisOf: async () => over.borrowerMetis ?? BigInt(0),
    feeWei: async () => metis(0.0008),
    feeCovered: () => over.covered ?? false,
  });

  it("offers nothing while the pot is not set up, in one calm sentence", async () => {
    const o = await offerWithPot(BORROWER, { config: () => ({ ok: false, reason: "unconfigured", message: "x" }) }, ENV);
    expect(o).toMatchObject({ offerUsd: 0, pot: { open: false, message: POT_PAUSED }, approval: null });
  });

  it("pauses when the pot holds no USDC, or too little METIS to pay its own fees", async () => {
    expect((await offerWithPot(BORROWER, deps({ usdcBase: BigInt(0) }), ENV))?.pot).toEqual({ open: false, message: POT_PAUSED });
    expect((await offerWithPot(BORROWER, deps({ metisWei: metis(0.001) }), ENV))?.pot).toEqual({ open: false, message: POT_PAUSED });
  });

  it("caps the formula's offer at what the pot holds, floored to the cent", async () => {
    // capacity 5, the facility's max 2, the pot holds 1.234567
    const o = await offerWithPot(BORROWER, deps({ usdcBase: BigInt(1_234_567) }), ENV);
    expect(o?.pot.open).toBe(true);
    expect(o?.offerUsd).toBe(1.23);
    expect((await offerWithPot(BORROWER, deps(), ENV))?.offerUsd).toBe(2);
  });

  it("knows where the approval stands, and covers the fee only for a wallet with no METIS, once", async () => {
    expect((await offerWithPot(BORROWER, deps(), ENV))?.approval).toMatchObject({ approved: false, needsFee: true });
    expect((await offerWithPot(BORROWER, deps({ borrowerMetis: metis(0.01) }), ENV))?.approval).toMatchObject({ approved: false, needsFee: false });
    expect((await offerWithPot(BORROWER, deps({ covered: true }), ENV))?.approval).toMatchObject({ needsFee: false });
    expect((await offerWithPot(BORROWER, deps({ allowance: usdc(2) }), ENV))?.approval).toMatchObject({ approved: true, needsFee: false });
  });

  it("tells a Starknet record that advances pay on Metis, and an unreachable chain that it is brief", async () => {
    expect((await offerWithPot(`0x${"4f1f".repeat(16)}`, deps(), ENV))?.pot).toEqual({ open: false, message: NOT_ON_METIS });
    const down = { ...deps(), balances: async () => { throw new Error("rpc down"); } };
    expect((await offerWithPot(BORROWER, down, ENV))?.pot).toEqual({ open: false, message: POT_UNREACHABLE });
  });
});

describe("the advance out", () => {
  const sends: Array<{ to: Address; amount: bigint }> = [];
  const deps = (over: Partial<{ allowance: bigint; usdcBase: bigint; metisWei: bigint; send: () => Promise<Hash>; receipt: (h: Hash) => Promise<"success" | "reverted"> }> = {}) => ({
    pot: pot(),
    balances: async () => ({ usdcBase: over.usdcBase ?? usdc(10), metisWei: over.metisWei ?? metis(0.5) }),
    allowance: async () => over.allowance ?? usdc(2),
    send: over.send ?? (async (_p: PotConfig, to: Address, amount: bigint) => { sends.push({ to, amount }); return hash(1); }),
    receipt: over.receipt ?? (async () => "success" as const),
  });
  const take = (d = deps(), usd = 2) => disburseAdvance({ wallet: BORROWER, usd, multiple: 1, waterfallBps: 5000 }, d);
  beforeEach(() => { sends.length = 0; });

  it("refuses before a cent moves when the borrower has not approved repayment", async () => {
    const r = await take(deps({ allowance: usdc(1.99) }));
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(sends).toHaveLength(0);
    expect(getActiveAdvance(BORROWER)).toBeNull();
  });

  it("refuses while the pot is short of the advance or of METIS for its fee", async () => {
    expect(await take(deps({ usdcBase: usdc(1) }))).toMatchObject({ ok: false, status: 503 });
    expect(await take(deps({ metisWei: metis(0.001) }))).toMatchObject({ ok: false, status: 503 });
    expect(sends).toHaveLength(0);
  });

  it("sends exactly the advance to the borrower, and writes the transaction before waiting for it", async () => {
    let txAtWait: string | null = null;
    const r = await take(deps({ receipt: async () => { txAtWait = getActiveAdvance(BORROWER)?.disburseTx ?? null; return "success"; } }));
    expect(r).toMatchObject({ ok: true, disburseTx: hash(1) });
    expect(sends).toEqual([{ to: "0x1111111111111111111111111111111111111111", amount: usdc(2) }]);
    expect(txAtWait).toBe(hash(1));
    const row = getActiveAdvance(BORROWER);
    expect(row).toMatchObject({ chainId: 1088, principalBase: 2_000_000, outstandingBase: 2_000_000, potAddress: pot().address });
  });

  it("voids the advance when the send fails or the transfer reverts: nothing moved, nothing owed", async () => {
    expect(await take(deps({ send: async () => { throw new Error("nonce too low"); } }))).toMatchObject({ ok: false, status: 502 });
    expect(getActiveAdvance(BORROWER)).toBeNull();
    expect(await take(deps({ receipt: async () => "reverted" }))).toMatchObject({ ok: false, status: 502 });
    expect(getActiveAdvance(BORROWER)).toBeNull();
  });

  it("keeps the advance when its receipt does not come back: the money is most likely on its way", async () => {
    const r = await take(deps({ receipt: async () => { throw new Error("timeout"); } }));
    expect(r).toMatchObject({ ok: true, confirming: true });
    expect(getActiveAdvance(BORROWER)?.disburseTx).toBe(hash(1));
  });

  it("one active advance at a time, the formula binds, and a Starknet address is refused", async () => {
    expect((await take()).ok).toBe(true);
    expect(await take()).toMatchObject({ ok: false, status: 409 });
    h.capacity = 1;
    db.delete(advances).run();
    expect(await take()).toMatchObject({ ok: false, status: 409 });
    expect(await disburseAdvance({ wallet: `0x${"4f1f".repeat(16)}`, usd: 1, multiple: 1, waterfallBps: 5000 }, deps())).toMatchObject({ ok: false, status: 409 });
  });
});

describe("the waterfall home: collecting from each later verified payout", () => {
  const seedAdvance = (principalUsd = 2) => createAdvance({ borrowerWallet: BORROWER, principalBase: usdc(principalUsd), multiple: 1, waterfallBps: 5000, potAddress: pot().address, chainId: 1088 });
  const collected: bigint[] = [];
  const run = (payouts: MetisPayout[], over: Partial<{ allowance: bigint; held: bigint; collect: () => Promise<Hash>; receipt: () => Promise<"success" | "reverted">; potMetis: bigint; limit: number }> = {}) => {
    let n = 0;
    return collectAdvanceRepayments(
      {
        pot: pot(),
        payouts: () => payouts,
        potMetisWei: async () => over.potMetis ?? metis(0.5),
        allowance: async () => over.allowance ?? usdc(2),
        balanceOf: async () => over.held ?? usdc(5),
        collect: over.collect ?? (async (_p: PotConfig, _from: Address, amount: bigint) => { collected.push(amount); return hash(++n + 100); }),
        receipt: over.receipt ?? (async () => "success" as const),
      },
      over.limit ?? 5,
    );
  };
  const payout = (id: string, usd: number, at = 2_000_000_000): MetisPayout => ({ submissionId: id, amountBase: usdc(usd), at });
  beforeEach(() => { collected.length = 0; });

  it("collects half of each later payout, never more than is owed, and closes the advance at zero", async () => {
    const adv = seedAdvance(2);
    const s = await run([payout("s1", 1), payout("s2", 3)]);
    // $0.50 of the $1 payout, then $1.50 (half of $3 would be more than what is left)
    expect(collected).toEqual([usdc(0.5), usdc(1.5)]);
    expect(s).toMatchObject({ collected: 2, collectedBase: 2_000_000, missed: 0 });
    const [h1] = advanceHistory(BORROWER);
    expect(h1).toMatchObject({ id: adv.id, status: "repaid", outstandingBase: 0 });
    expect(h1.repayments.map((r) => r.amountBase).sort()).toEqual([1_500_000, 500_000].sort());
  });

  it("never collects the same payout twice", async () => {
    seedAdvance(10);
    await run([payout("s1", 1)]);
    await run([payout("s1", 1)]);
    expect(collected).toEqual([usdc(0.5)]);
  });

  it("caps a share by what the borrower approved and still holds", async () => {
    seedAdvance(10);
    await run([payout("s1", 4)], { allowance: usdc(0.2) });
    await run([payout("s2", 4)], { held: usdc(0.1) });
    expect(collected).toEqual([usdc(0.2), usdc(0.1)]);
  });

  it("records a share it cannot collect as missed, once, and leaves it owed", async () => {
    seedAdvance(2);
    const s = await run([payout("s1", 1)], { allowance: BigInt(0) });
    expect(s).toMatchObject({ collected: 0, missed: 1 });
    expect(collected).toEqual([]);
    const [h1] = advanceHistory(BORROWER);
    expect(h1).toMatchObject({ status: "active", outstandingBase: 2_000_000 });
    expect(h1.repayments).toEqual([expect.objectContaining({ submissionId: "s1", amountBase: 0, escrowTx: null, note: "the approval was withdrawn" })]);
    expect((await run([payout("s1", 1)])).collected).toBe(0); // considered once
  });

  it("a collection refused in simulation is missed and costs nothing; a reverted one is missed", async () => {
    seedAdvance(10);
    expect(await run([payout("s1", 1)], { collect: async () => { throw new Error("transfer amount exceeds allowance"); } })).toMatchObject({ collected: 0, missed: 1 });
    expect(await run([payout("s2", 1)], { receipt: async () => "reverted" })).toMatchObject({ collected: 0, missed: 1 });
    expect(advanceHistory(BORROWER)[0].outstandingBase).toBe(10_000_000);
  });

  it("an unconfirmed collection counts as collected: that can only ever under-collect", async () => {
    seedAdvance(10);
    const s = await run([payout("s1", 1)], { receipt: async () => { throw new Error("timeout"); } });
    expect(s.collected).toBe(1);
    expect(advanceHistory(BORROWER)[0].outstandingBase).toBe(9_500_000);
  });

  it("pauses without METIS for the pot's own fees, and sends at most `limit` per tick", async () => {
    seedAdvance(10);
    expect(await run([payout("s1", 1)], { potMetis: metis(0.0001) })).toMatchObject({ paused: "pot short of METIS for fees", collected: 0 });
    const s = await run([payout("a", 1), payout("b", 1), payout("c", 1)], { limit: 2 });
    expect(s.collected).toBe(2);
  });
});

describe("the one-time fee cover", () => {
  it("is reserved before it is sent, so two requests cannot both send", () => {
    expect(reserveFeeTopup({ wallet: BORROWER, chainId: 1088, amountWei: metis(0.0008) })).toBe(true);
    expect(reserveFeeTopup({ wallet: BORROWER, chainId: 1088, amountWei: metis(0.0008) })).toBe(false);
  });
});
