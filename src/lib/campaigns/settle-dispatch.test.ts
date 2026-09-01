import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * THE MANUALLY-APPROVED PATH IS THE LIKELIEST PATH OF ALL RIGHT NOW.
 *
 * Autopay holds anything below the bar, and a held submission is exactly what a founder reviews
 * and approves by hand. Every one of those paths called the EVM settle flow for every approved
 * submission, whatever chain its campaign pays on. That flow's first act is
 * `getAddress(campaign.vaultAddress)`, which throws on a felt.
 *
 * The sweep was fixed first, inline. That left the decide route, the standalone settle route and
 * the Telegram/admin review tools still calling the EVM flow directly — where the EVM strategy
 * selector refuses a Cairo vault with a THROW, at the end of the approve path, after the
 * submission is already marked approved and journalled. The founder gets a 502 and no way forward.
 *
 * These tests are on the real dispatcher, not a copy of its rule. The previous version of this
 * file re-implemented the branch in the test and then grepped the sweep's source for it — which
 * proves the copy works, not the product.
 */

const settleApprovedSubmission = vi.fn(async (_c?: unknown, _s?: unknown, _d?: unknown) => ({
  outcome: {
    settled: true, txHash: "0xevm", explorerUrl: "https://evm/tx", reason: null,
    recipient: "0x1111111111111111111111111111111111111111", amountBase: 500000,
    needsOwnerAdd: false, failedCheckIndex: null, vendorAdded: false, vendorTxHash: null,
  },
  vault: { balance: BigInt(1) },
}));
type StarknetOutcome = {
  settled: boolean; txHash: string | null; explorerUrl: string | null; reason: string | null;
  recipient: string | null; rewardBase: bigint | null;
};
const settleOnStarknet = vi.fn(
  async (_c?: unknown, _s?: unknown): Promise<StarknetOutcome> => ({
    settled: true, txHash: "0xstark", explorerUrl: "https://voyager/tx", reason: null,
    recipient: "0x64b48806902a367c8598f4f95c305e8c1a1acba5f082d294a43793113115691",
    rewardBase: BigInt(500000),
  }),
);

const recordEventOnce = vi.fn((_input: Record<string, unknown>) => ({ event: {} as never, inserted: true }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/campaigns", () => ({
  recordEventOnce: (input: Record<string, unknown>) => recordEventOnce(input),
}));
vi.mock("./settle-flow", () => ({
  settleApprovedSubmission: (...a: unknown[]) => settleApprovedSubmission(...(a as [])),
}));
vi.mock("./settle-starknet", () => ({
  settleOnStarknet: (...a: unknown[]) => settleOnStarknet(...(a as [])),
}));

import { settleByRail } from "./settle-dispatch";

const campaign = (settlementRail?: string) => ({ id: "c1", settlementRail }) as never;
const submission = { id: "s1" } as never;

beforeEach(() => {
  settleApprovedSubmission.mockClear();
  settleOnStarknet.mockClear();
  recordEventOnce.mockClear();
});

describe("settling a founder-approved submission", () => {
  it("pays a Starknet campaign through the Cairo vault", async () => {
    const r = await settleByRail(campaign("starknet"), submission);
    expect(settleOnStarknet).toHaveBeenCalledTimes(1);
    expect(settleApprovedSubmission).not.toHaveBeenCalled();
    expect(r.outcome.txHash).toBe("0xstark");
    expect(r.outcome.amountBase).toBe(500000);
    // A Cairo vault is not a viem-read CampaignVault; a fabricated shape would be read as a balance.
    expect(r.vault).toBeNull();
  });

  it("pays an EVM campaign exactly as before", async () => {
    const r = await settleByRail(campaign("evm"), submission);
    expect(settleApprovedSubmission).toHaveBeenCalledTimes(1);
    expect(settleOnStarknet).not.toHaveBeenCalled();
    expect(r.outcome.txHash).toBe("0xevm");
    expect(r.vault).not.toBeNull();
  });

  it("treats an absent rail as EVM, so no existing campaign changes behaviour", async () => {
    await settleByRail(campaign(undefined), submission);
    expect(settleApprovedSubmission).toHaveBeenCalledTimes(1);
    expect(settleOnStarknet).not.toHaveBeenCalled();
  });

  it("never sends one campaign's approval down both rails", async () => {
    // Paying twice is the failure this dispatcher exists to make impossible.
    await settleByRail(campaign("starknet"), submission);
    await settleByRail(campaign("evm"), submission);
    expect(settleOnStarknet).toHaveBeenCalledTimes(1);
    expect(settleApprovedSubmission).toHaveBeenCalledTimes(1);
  });

  it("passes strategy deps through to the EVM flow untouched", async () => {
    const deps = { payoutReplay: { journal: [] } };
    await settleByRail(campaign("evm"), submission, deps as never);
    expect(settleApprovedSubmission.mock.calls[0]![2]).toBe(deps);
  });

  it("reports a refused Starknet payout honestly rather than as a payment", async () => {
    settleOnStarknet.mockResolvedValueOnce({
      settled: false, txHash: null, explorerUrl: null,
      reason: "the vault does not hold enough to pay this", recipient: null, rewardBase: null,
    });
    const r = await settleByRail(campaign("starknet"), submission);
    expect(r.outcome.settled).toBe(false);
    expect(r.outcome.amountBase).toBeNull();
    expect(r.outcome.recipient).toBeNull();
    expect(r.outcome.reason).toMatch(/does not hold enough/);
  });
});

describe("every caller settles through the dispatcher", () => {
  /**
   * THE GUARD THAT SURVIVES THE NEXT CALL SITE. The rail branch was written twice, inline, and
   * three other callers never got it. A test that names today's callers would go stale the moment
   * somebody adds a fourth — so this asks the question structurally instead: who imports the
   * frozen EVM flow directly?
   */
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
    }
    return out;
  };

  it("nothing imports settleApprovedSubmission except the dispatcher and the deputy pipeline", () => {
    /**
     * The pipeline is the one legitimate exception, and it earns it: its two rails do genuinely
     * different work AFTER the settler returns — different journal details, a different announce
     * function — so folding it into the dispatcher would flatten real differences rather than
     * remove a duplicate branch. It branches correctly and has its own tests
     * (pipeline-starknet.test.ts). Every other file must go through settleByRail.
     */
    const offenders = walk("src")
      .filter((f) => !/settle-flow\.ts$|settle-dispatch\.ts$|deputy\/pipeline\.ts$/.test(f))
      .filter((f) => /import\s*\{[^}]*\bsettleApprovedSubmission\b/.test(readFileSync(f, "utf8")));
    expect(
      offenders,
      "these settle EVM-only and will throw on a Cairo vault — call settleByRail instead",
    ).toEqual([]);
  });

  it("nothing calls settleOnStarknet outside the dispatcher and the deputy pipeline", () => {
    // The pipeline branches earlier, for its own preflight reasons, and is allowed to.
    const allowed = ["settle-dispatch.ts", "settle-starknet.ts", "pipeline.ts"];
    const offenders = walk("src")
      .filter((f) => !allowed.some((a) => f.endsWith(a)))
      .filter((f) => /import\s*\{[^}]*\bsettleOnStarknet\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("the dispatcher journals what the Starknet rail settles", () => {
  /**
   * Measured on prod 2026-09-01: two manually-approved Starknet payouts carried a payout_tx and
   * NO ledger event — the EVM flow journals internally, the Starknet settler journals nothing,
   * and only the autopilot caller was writing its own row. The explorer headed "Every
   * settlement" was blind to real mainnet money. The write belongs on the dispatch, where every
   * caller — sweep, pipeline, review tools, and the next one — passes through.
   */
  it("a settled Starknet payout writes the `settled` ledger event, amount and tx intact", async () => {
    await settleByRail(campaign("starknet"), submission);
    expect(recordEventOnce).toHaveBeenCalledTimes(1);
    const arg = recordEventOnce.mock.calls[0]![0];
    expect(arg.kind).toBe("settled");
    expect(arg.txHash).toBe("0xstark");
    expect(arg.amount).toBe(500000);
    expect(arg.campaignId).toBe("c1");
    expect(arg.submissionId).toBe("s1");
  });

  it("a refused Starknet payout journals nothing here — refusals have their own bookkeeping", async () => {
    settleOnStarknet.mockResolvedValueOnce({
      settled: false, txHash: "0xrefusal", explorerUrl: null, reason: "code 3",
      recipient: null, rewardBase: null,
    });
    await settleByRail(campaign("starknet"), submission);
    expect(recordEventOnce).not.toHaveBeenCalled();
  });

  it("the EVM rail's journal stays inside the frozen flow — the dispatcher adds no second row", async () => {
    await settleByRail(campaign("evm"), submission);
    expect(recordEventOnce).not.toHaveBeenCalled();
  });
});
