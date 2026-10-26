import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * SELF-SERVE ADVANCE, ON METIS (26 Oct 2026): the owner takes what the published formula allows and the pot
 * can pay, once their approval covers it, and nobody else takes anything.
 */
const p = vi.hoisted(() => ({
  configured: true,
  usdcBase: BigInt(10_000_000),
  metisWei: BigInt("500000000000000000"),
  allowance: BigInt(0),
  borrowerMetis: BigInt(0),
  fee: BigInt("800000000000000"),
  sendUsdc: vi.fn<(...a: unknown[]) => Promise<string>>(async () => `0x${"ab".repeat(32)}`),
  sendMetis: vi.fn<(...a: unknown[]) => Promise<string>>(async () => `0x${"cd".repeat(32)}`),
}));
const POT = "0x2222222222222222222222222222222222222222";
vi.mock("@/lib/advance/pot", () => ({
  POT_CHAIN_ID: 1088,
  POT_MIN_METIS_WEI: BigInt("5000000000000000"),
  MIN_ADVANCE_BASE: BigInt(100_000),
  potConfig: () => (p.configured ? { ok: true, pot: { address: POT, token: "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21", account: {} } } : { ok: false, reason: "unconfigured", message: "unset" }),
  potBalances: async () => ({ usdcBase: p.usdcBase, metisWei: p.metisWei }),
  allowanceToPot: async () => p.allowance,
  metisBalanceOf: async () => p.borrowerMetis,
  approvalFeeWei: async () => p.fee,
  potSendUsdc: (...a: unknown[]) => p.sendUsdc(...a),
  potSendMetis: (...a: unknown[]) => p.sendMetis(...a),
  potReceipt: async () => "success",
}));
const walletCreditSignals = vi.fn();
const advanceCapacityUsd = vi.fn();
vi.mock("@/lib/campaigns/credit", () => ({ walletCreditSignals: (...a: unknown[]) => walletCreditSignals(...(a as [])), advanceCapacityUsd: (...a: unknown[]) => advanceCapacityUsd(...(a as [])) }));
const evm = vi.fn<() => Promise<string | null>>();
vi.mock("@/lib/auth/session", () => ({ getSessionAddress: () => evm() }));

import { GET, POST } from "./route";
import { db } from "@/lib/db";
import { advanceFeeTopups, advances } from "@/lib/db/schema";

const OWNER = "0x00000000000000000000000000000000000000aa";
const ctx = { params: Promise.resolve({ wallet: OWNER }) };
const post = (body: unknown) => POST(new NextRequest("http://x/api/record/w/advance", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), ctx);

beforeEach(() => {
  db.delete(advances).run();
  db.delete(advanceFeeTopups).run();
  walletCreditSignals.mockReturnValue({ record: {}, signals: { inflow90dUsd: 3 } });
  advanceCapacityUsd.mockReturnValue(1.0);
  evm.mockResolvedValue(null);
  Object.assign(p, { configured: true, usdcBase: BigInt(10_000_000), metisWei: BigInt("500000000000000000"), allowance: BigInt(0), borrowerMetis: BigInt(0) });
  p.sendUsdc.mockClear();
  p.sendMetis.mockClear();
  process.env.ADVANCE_SELF_SERVE = "1"; process.env.ADVANCE_MAX_USD = "5"; process.env.ADVANCE_MULTIPLE = "1"; process.env.ADVANCE_WATERFALL_BPS = "5000";
});

describe("self-serve advance on Metis", () => {
  it("GET publishes the offer as the pot can pay it, where the approval stands, and no secrets", async () => {
    const res = await GET(new NextRequest("http://x"), ctx);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j).toMatchObject({ ok: true, capacityUsd: 1.0, offerUsd: 1.0, active: null, pot: { open: true, address: POT }, approval: { approved: false, needsFee: true } });
    expect(JSON.stringify(j)).not.toMatch(/secret|privateKey/i);
  });

  it("says calmly that advances are paused while the pot cannot pay, and takes nothing", async () => {
    p.usdcBase = BigInt(0);
    const j = await (await GET(new NextRequest("http://x"), ctx)).json();
    expect(j.pot).toMatchObject({ open: false });
    expect(j.pot.message).toMatch(/paused while the lending pot is topped up/);
    evm.mockResolvedValue(OWNER);
    p.allowance = BigInt(1_000_000);
    expect((await post({ usd: 1 })).status).toBe(503);
    expect(p.sendUsdc).not.toHaveBeenCalled();
  });

  it("fails closed when not armed, and refuses anyone but the record's own wallet", async () => {
    process.env.ADVANCE_SELF_SERVE = "0";
    expect((await post({ usd: 1 })).status).toBe(404);
    process.env.ADVANCE_SELF_SERVE = "1";
    expect((await post({ usd: 1 })).status).toBe(403); // signed out
    evm.mockResolvedValue("0x00000000000000000000000000000000000000bb");
    expect((await post({ usd: 1 })).status).toBe(403);
    expect(p.sendUsdc).not.toHaveBeenCalled();
    expect(db.select().from(advances).all()).toHaveLength(0);
  });

  it("sends nothing before the owner has approved repayment", async () => {
    evm.mockResolvedValue(OWNER);
    const r = await post({ usd: 1 });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/Approve repayment first/);
    expect(p.sendUsdc).not.toHaveBeenCalled();
  });

  it("the owner, approved, takes the offer: sent to their own wallet, and not twice", async () => {
    evm.mockResolvedValue(OWNER);
    p.allowance = BigInt(1_000_000);
    const r = await post({ usd: 1 });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ ok: true, disburseTx: `0x${"ab".repeat(32)}`, usd: 1 });
    expect(j.explorerUrl).toContain(`0x${"ab".repeat(32)}`);
    expect(p.sendUsdc).toHaveBeenCalledTimes(1);
    const [, to, amount] = p.sendUsdc.mock.calls[0] as [unknown, string, bigint];
    expect(to.toLowerCase()).toBe(OWNER);
    expect(amount).toBe(BigInt(1_000_000));
    expect((await post({ usd: 1 })).status).toBe(409);
  });

  it("refuses more than is on offer, and a failed send leaves no row", async () => {
    evm.mockResolvedValue(OWNER);
    p.allowance = BigInt(5_000_000);
    expect((await post({ usd: 1.5 })).status).toBe(409);
    p.sendUsdc.mockRejectedValueOnce(new Error("insufficient funds"));
    expect((await post({ usd: 1 })).status).toBe(502);
    expect(db.select().from(advances).all()).toHaveLength(0); // the borrower can try again later
  });

  it("covers the approval's fee once, and only for a wallet with no METIS", async () => {
    evm.mockResolvedValue(OWNER);
    const first = await (await post({ step: "fee" })).json();
    expect(first).toMatchObject({ ok: true, covered: true });
    await post({ step: "fee" });
    expect(p.sendMetis).toHaveBeenCalledTimes(1);
    expect(p.sendMetis.mock.calls[0][2]).toBe(p.fee);
    db.delete(advanceFeeTopups).run();
    p.borrowerMetis = p.fee; // a wallet that can pay its own
    expect(await (await post({ step: "fee" })).json()).toMatchObject({ ok: true, covered: false });
    expect(p.sendMetis).toHaveBeenCalledTimes(1);
  });
});
