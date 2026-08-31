import { beforeEach, describe, expect, it, vi } from "vitest";

const requestVaultPayout = vi.fn();
const updateSubmission = vi.fn();
const payoutRouteFor = vi.fn(async (_v: string): Promise<"split" | "direct"> => "direct");
const escrowPayouts = vi.fn(async () => ({ transactionHash: "0xescrow", totalBase: BigInt(0), count: 1 }));
/** Sage's own Starknet account — the pass-through the vault pays on the private route. */
const SAGE_OPERATOR = "0x46a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101";
const announceCampaignSettledStarknet = vi.fn(async () => {});
const notifyFounderSettled = vi.fn(async () => {});

vi.mock("@/lib/starknet/vault", () => ({
  requestVaultPayout: (...a: unknown[]) => requestVaultPayout(...a),
  // Default DIRECT: these tests were written for the public route and must keep asserting it, so
  // the private route cannot quietly become the default without a test saying so.
  payoutRouteFor: (...a: unknown[]) => payoutRouteFor(...(a as [string])),
}));
vi.mock("@/lib/starknet/claims", () => ({
  escrowPayouts: (...a: unknown[]) => escrowPayouts(...(a as [])),
}));
vi.mock("@/lib/starknet/config", () => ({
  starknetConfig: () => ({
    rpcUrl: "https://rpc.test", claimsAddress: "0x6fe", tokenAddress: "0x033",
    accountAddress: SAGE_OPERATOR, privateKey: "0x1",
  }),
  starknetAddresses: () => ({ claims: "0x6fe", token: "0x033", rpcUrl: "https://rpc.test" }),
}));
vi.mock("@/lib/db/campaigns", () => ({
  updateSubmission: (...a: unknown[]) => updateSubmission(...a),
  getDecisionBySubmission: () => null,
}));
vi.mock("@/lib/telegram/bot", () => ({
  announceCampaignSettledStarknet: (...a: unknown[]) => announceCampaignSettledStarknet(...(a as [])),
}));
vi.mock("@/lib/telegram/founder-notify", () => ({
  notifyFounderSettled: (...a: unknown[]) => notifyFounderSettled(...(a as [])),
}));

import type { Campaign, Submission } from "@/lib/db/schema";

import { settleOnStarknet } from "./settle-starknet";

const VAULT = "0x06fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57";
const WORKER = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

const campaign = (over: Partial<Campaign> = {}) =>
  ({
    id: "c1",
    title: "Test the checkout",
    rewardAmount: 500_000,
    sandbox: false,
    settlementRail: "starknet",
    vaultKind: "sage_vault_starknet",
    vaultAddress: VAULT,
    chainId: 900_001,
    ...over,
  }) as unknown as Campaign;

const submission = (over: Partial<Submission> = {}) =>
  ({
    id: "s1",
    campaignId: "c1",
    wallet: WORKER,
    status: "settling",
    payoutTx: null,
    missionIdHash: null,
    ...over,
  }) as unknown as Submission;

beforeEach(() => {
  requestVaultPayout.mockReset();
  updateSubmission.mockReset();
  payoutRouteFor.mockReset().mockResolvedValue("direct");
  escrowPayouts.mockReset().mockResolvedValue({ transactionHash: "0xescrow", totalBase: BigInt(0), count: 1 });
  announceCampaignSettledStarknet.mockClear();
  notifyFounderSettled.mockClear();
  requestVaultPayout.mockResolvedValue({
    paid: true,
    transactionHash: "0xabc",
    code: 0,
    reason: "paid",
  });
});

describe("settling on Starknet", () => {
  it("asks the vault to release, naming a mission and never an amount", async () => {
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(true);
    expect(out.txHash).toBe("0xabc");
    const args = requestVaultPayout.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.vaultAddress).toBe(VAULT);
    expect(args.recipient).toBe(WORKER);
    // THE PROPERTY THAT MATTERS: no amount is passed. The vault derives it.
    expect(Object.keys(args)).not.toContain("amount");
    expect(Object.keys(args)).not.toContain("amountBase");
    expect(updateSubmission).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ status: "paid", payoutTx: "0xabc" }),
    );
  });

  /**
   * A REFUSAL IS A SUCCESSFUL TRANSACTION THAT MOVED NOTHING. The vault returns a code rather than
   * reverting, so "the transaction succeeded" and "the worker was paid" are different facts, and
   * treating the first as the second would mark someone paid against a transfer that never happened.
   */
  it("does not mark paid when the vault refuses", async () => {
    requestVaultPayout.mockResolvedValue({
      paid: false,
      transactionHash: "0xdef",
      code: 9,
      reason: "the campaign's budget ceiling is reached",
    });
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(false);
    expect(out.reason).toMatch(/budget ceiling/);
    expect(updateSubmission).not.toHaveBeenCalled();
  });

  /**
   * The vault IS the guarantee, so its absence is a reason to stop — not a reason to fall back to
   * paying from Sage's own balance, which is a materially weaker promise nobody chose.
   */
  it("refuses to pay a campaign that has no vault", async () => {
    const out = await settleOnStarknet(campaign({ vaultKind: "policy_v1" }), submission());
    expect(out.settled).toBe(false);
    expect(out.reason).toMatch(/no Starknet vault/);
    expect(requestVaultPayout).not.toHaveBeenCalled();
  });

  it("refuses a vault address that is not a Starknet address", async () => {
    const out = await settleOnStarknet(campaign({ vaultAddress: "not-an-address" }), submission());
    expect(out.settled).toBe(false);
    expect(requestVaultPayout).not.toHaveBeenCalled();
  });

  /** The sweep re-evaluates pending work, so this WILL be called again on work already paid. */
  it("refuses a submission that already carries a payout", async () => {
    const out = await settleOnStarknet(campaign(), submission({ payoutTx: "0xalready" }));
    expect(out.settled).toBe(false);
    expect(requestVaultPayout).not.toHaveBeenCalled();
  });

  it("refuses a submission already marked paid", async () => {
    const out = await settleOnStarknet(campaign(), submission({ status: "paid" }));
    expect(out.settled).toBe(false);
    expect(requestVaultPayout).not.toHaveBeenCalled();
  });

  it("never pays from the sandbox", async () => {
    const out = await settleOnStarknet(campaign({ sandbox: true }), submission());
    expect(out.settled).toBe(false);
    expect(requestVaultPayout).not.toHaveBeenCalled();
  });

  it("refuses a recipient that is not a Starknet address", async () => {
    const out = await settleOnStarknet(campaign(), submission({ wallet: "not-an-address" }));
    expect(out.settled).toBe(false);
    expect(out.reason).toMatch(/not a Starknet address/);
    expect(requestVaultPayout).not.toHaveBeenCalled();
  });

  it("refuses a non-positive reward", async () => {
    const out = await settleOnStarknet(campaign({ rewardAmount: 0 }), submission());
    expect(out.settled).toBe(false);
    expect(requestVaultPayout).not.toHaveBeenCalled();
  });

  /**
   * The commitment path derives 256-bit keccak digests, and a felt holds 252 bits. Passing one
   * through unreduced would overflow — so both the intent and the digest are masked identically,
   * which keeps the on-chain replay guarantee intact.
   */
  it("reduces its commitments into the felt field", async () => {
    await settleOnStarknet(campaign(), submission());
    const args = requestVaultPayout.mock.calls[0]?.[0] as { intentHash: string; decisionDigest: string };
    const FELT_MAX = BigInt(1) << BigInt(252);
    expect(BigInt(args.intentHash)).toBeLessThan(FELT_MAX);
    expect(BigInt(args.decisionDigest)).toBeLessThan(FELT_MAX);
    expect(BigInt(args.intentHash)).toBeGreaterThan(BigInt(0));
  });

  it("holds without marking paid when the call throws", async () => {
    requestVaultPayout.mockRejectedValue(new Error("vault payout reverted on chain (REVERTED)"));
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(false);
    expect(out.reason).toMatch(/reverted on chain/);
    expect(updateSubmission).not.toHaveBeenCalled();
  });

  it("never throws for control flow", async () => {
    requestVaultPayout.mockRejectedValue(new Error("network down"));
    await expect(settleOnStarknet(campaign(), submission())).resolves.toMatchObject({
      settled: false,
    });
  });
});

/**
 * A PAYOUT NOBODY IS TOLD ABOUT.
 *
 * The EVM rail announces and DMs from inside settle-flow, so all five of its entry points are
 * covered by construction. On this rail the announce lived in ONE caller — the deputy pipeline —
 * so a payout settled by the sweep, the decide route or a review tool told nobody anything.
 *
 * Latent rather than live when it was found: both Starknet campaigns had no announce chat and a
 * founder with no Telegram binding, so nothing was actually missed. Pinned here so the rails stay
 * symmetric before one of those is set, rather than after somebody notices the silence.
 */
describe("who is told about a Starknet payout", () => {
  it("announces on the campaign's channel and DMs the founder, from the settler itself", async () => {
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(true);
    expect(announceCampaignSettledStarknet).toHaveBeenCalledTimes(1);
    expect(notifyFounderSettled).toHaveBeenCalledTimes(1);
    const [, ann] = announceCampaignSettledStarknet.mock.calls[0] as unknown as [
      unknown,
      { txHash: string; amountBase: number; recipient: string; explorerUrl: string | null },
    ];
    expect(ann.txHash).toBe("0xabc");
    expect(ann.amountBase).toBe(500_000);
    expect(ann.recipient).toBe(WORKER);
  });

  it("says nothing when the vault REFUSED — a refusal is not a payout", async () => {
    requestVaultPayout.mockResolvedValue({ paid: false, transactionHash: "0xdef", code: 10, reason: "the vault's daily payout cap is reached" });
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(false);
    expect(announceCampaignSettledStarknet).not.toHaveBeenCalled();
    expect(notifyFounderSettled).not.toHaveBeenCalled();
  });

  it("says nothing when settlement threw", async () => {
    requestVaultPayout.mockRejectedValue(new Error("rpc down"));
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(false);
    expect(announceCampaignSettledStarknet).not.toHaveBeenCalled();
    expect(notifyFounderSettled).not.toHaveBeenCalled();
  });

  it("a messaging failure never affects a payout that already happened", async () => {
    // The money has moved by this point. Fire-and-forget, exactly as the EVM path does it.
    announceCampaignSettledStarknet.mockRejectedValueOnce(new Error("telegram down") as never);
    notifyFounderSettled.mockRejectedValueOnce(new Error("telegram down") as never);
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(true);
    expect(out.txHash).toBe("0xabc");
  });
});

/**
 * THE PRIVATE ROUTE.
 *
 * Sage cannot pay into a shielded note: the pool's viewing key lives in the wallet, and only the
 * wallet reaches the proving service. So a private payout is the vault releasing the reward to
 * Sage and Sage escrowing it behind the worker's commitment — the worker opens it themselves,
 * publicly or privately, to any address. The income is never glued to the identity they submitted
 * with.
 *
 * The vault stays the cap either way: it derives the amount, and Sage can only escrow what was
 * released. Escrowing from Sage's own float would be unbounded money, which is the one thing this
 * product exists to prevent.
 */
describe("paying a worker privately", () => {
  const privateRail = () => payoutRouteFor.mockResolvedValue("split");

  it("asks the vault to pay SAGE, with the worker still named as the earner", async () => {
    privateRail();
    await settleOnStarknet(campaign(), submission());
    const args = requestVaultPayout.mock.calls[0]![0] as { recipient: string; payoutTarget?: string };
    // The worker is the vault's replay key and the name on the receipt; only the destination moves.
    // That is what lets a two-slot mission pay two different people into one escrow.
    expect(BigInt(args.recipient)).toBe(BigInt(WORKER));
    expect(BigInt(args.payoutTarget!)).toBe(BigInt(SAGE_OPERATOR));
  });

  it("escrows EXACTLY what the vault released, behind a fresh commitment", async () => {
    privateRail();
    await settleOnStarknet(campaign(), submission());
    const [legs] = escrowPayouts.mock.calls[0] as unknown as [
      { claimCommitment: string; refundCommitment: string; amountBase: bigint }[],
      number,
    ];
    expect(legs).toHaveLength(1);
    expect(legs[0].amountBase).toBe(BigInt(500_000));
    expect(legs[0].claimCommitment).not.toBe(legs[0].refundCommitment);
  });

  it("records the claim so the worker can be handed it once", async () => {
    privateRail();
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(true);
    const patch = updateSubmission.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.status).toBe("paid");
    expect(patch.claimSecret).toMatch(/^0x[0-9a-f]+$/);
    expect(patch.claimCommitment).toBeTruthy();
    expect(patch.claimEscrowTx).toBe("0xescrow");
  });

  it("VAULT FIRST — nothing is escrowed before the vault has released it", async () => {
    privateRail();
    const order: string[] = [];
    requestVaultPayout.mockImplementation(async () => {
      order.push("vault");
      return { paid: true, transactionHash: "0xabc", code: 0, reason: "paid" };
    });
    escrowPayouts.mockImplementation(async () => {
      order.push("escrow");
      return { transactionHash: "0xescrow", totalBase: BigInt(0), count: 1 };
    });
    await settleOnStarknet(campaign(), submission());
    // The other order escrows from Sage's own float — money the vault never bounded.
    expect(order).toEqual(["vault", "escrow"]);
  });

  it("HOLDS when the vault paid but the escrow failed — never reports a payout nobody can reach", async () => {
    privateRail();
    escrowPayouts.mockImplementation(async () => {
      throw new Error("deposit reverted");
    });
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(false);
    expect(out.reason).toMatch(/escrowing it behind a claim failed/i);
    // Held, not marked paid: the next sweep retries and nobody was told they were paid.
    expect(updateSubmission).not.toHaveBeenCalled();
  });

  it("escrows nothing when the vault REFUSED", async () => {
    privateRail();
    requestVaultPayout.mockResolvedValue({
      paid: false, transactionHash: "0xdef", code: 10, reason: "the vault's daily payout cap is reached",
    });
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(false);
    expect(escrowPayouts).not.toHaveBeenCalled();
  });

  it("leaves a legacy vault paying publicly, with no claim at all", async () => {
    // Its class has no request_payout_to; asking would revert as an unknown selector.
    payoutRouteFor.mockResolvedValue("direct");
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(true);
    expect(escrowPayouts).not.toHaveBeenCalled();
    const args = requestVaultPayout.mock.calls[0]![0] as { payoutTarget?: string };
    expect(args.payoutTarget).toBeUndefined();
    const patch = updateSubmission.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.claimSecret).toBeUndefined();
  });

  it("mints a different secret for every payout", async () => {
    privateRail();
    await settleOnStarknet(campaign(), submission());
    await settleOnStarknet(campaign(), submission({ id: "s2" }));
    const a = (updateSubmission.mock.calls[0]![1] as Record<string, unknown>).claimSecret;
    const b = (updateSubmission.mock.calls[1]![1] as Record<string, unknown>).claimSecret;
    expect(a).not.toBe(b);
  });
});

/* ─────────────────────────── the waterfall (capital in) ───────────────────────────
   The advances ledger below is the REAL module against the in-memory DB, so the schema's own
   guards — one active advance, one repayment per payout — are part of what is under test. */
describe("waterfall — an active advance splits the escrow", () => {
  const privateRail = () => payoutRouteFor.mockResolvedValue("split");

  const arm = async (over: Partial<{ principal: bigint; bps: number }> = {}) => {
    const { createAdvance } = await import("@/lib/db/advances");
    return createAdvance({
      borrowerWallet: WORKER,
      principalBase: over.principal ?? BigInt(200_000), // $0.20 against the $0.50 payout
      multiple: 1,
      waterfallBps: over.bps ?? 5000,
      potAddress: SAGE_OPERATOR,
    });
  };

  beforeEach(async () => {
    const { db } = await import("@/lib/db");
    const { advances, advanceRepayments } = await import("@/lib/db/schema");
    db.delete(advanceRepayments).run();
    db.delete(advances).run();
  });

  it("escrows TWO legs whose sum is EXACTLY the vault's release", async () => {
    privateRail();
    await arm(); // 50% of $0.50 = $0.25 > $0.20 outstanding → repay caps at $0.20
    await settleOnStarknet(campaign(), submission());
    const [legs] = escrowPayouts.mock.calls[0] as unknown as [{ amountBase: bigint; claimCommitment: string }[]];
    expect(legs).toHaveLength(2);
    expect(legs[0].amountBase + legs[1].amountBase).toBe(BigInt(500_000));
    expect(legs[1].amountBase).toBe(BigInt(200_000)); // capped by the balance, never the fraction
    expect(legs[0].claimCommitment).not.toBe(legs[1].claimCommitment);
  });

  it("records the repayment and retires the advance at zero", async () => {
    privateRail();
    const adv = await arm();
    await settleOnStarknet(campaign(), submission());
    const { advanceHistory } = await import("@/lib/db/advances");
    const [row] = advanceHistory(WORKER);
    expect(row.id).toBe(adv.id);
    expect(row.status).toBe("repaid");
    expect(row.outstandingBase).toBe(0);
    expect(row.repayments).toHaveLength(1);
    expect(row.repayments[0].amountBase).toBe(200_000);
    expect(row.repayments[0].submissionId).toBe(submission().id);
    expect(row.repayments[0].escrowTx).toBe("0xescrow");
    // and the pot's secret is persisted — an unrecorded secret is stranded money
    expect(row.repayments[0].claimSecret).toMatch(/^0x/);
  });

  it("the worker still gets THEIR claim — secrets on the submission are the worker leg's", async () => {
    privateRail();
    await arm();
    await settleOnStarknet(campaign(), submission());
    const patch = updateSubmission.mock.calls[0]![1] as Record<string, unknown>;
    const [legs] = escrowPayouts.mock.calls[0] as unknown as [{ claimCommitment: string }[]];
    expect(patch.claimCommitment).toBe(legs[0].claimCommitment);
    const { advanceHistory } = await import("@/lib/db/advances");
    expect(patch.claimCommitment).not.toBe(advanceHistory(WORKER)[0].repayments[0].claimCommitment);
  });

  it("a FAILED escrow records NO repayment — the ledger cannot outrun the chain", async () => {
    privateRail();
    await arm();
    escrowPayouts.mockRejectedValueOnce(new Error("sequencer down"));
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(false);
    const { advanceHistory } = await import("@/lib/db/advances");
    const [row] = advanceHistory(WORKER);
    expect(row.status).toBe("active");
    expect(row.outstandingBase).toBe(200_000);
    expect(row.repayments).toHaveLength(0);
  });

  it("full waterfall on a small balance: the worker leg exists whenever they are owed anything", async () => {
    privateRail();
    await arm({ bps: 10_000, principal: BigInt(100_000) }); // 100% routing, $0.10 owed
    await settleOnStarknet(campaign(), submission());
    const [legs] = escrowPayouts.mock.calls[0] as unknown as [{ amountBase: bigint }[]];
    expect(legs).toHaveLength(2);
    expect(legs[0].amountBase).toBe(BigInt(400_000)); // worker keeps the remainder
    expect(legs[1].amountBase).toBe(BigInt(100_000));
  });

  it("100% waterfall, balance >= payout: ONE pot leg, no zero-amount claim, no dead link", async () => {
    privateRail();
    await arm({ bps: 10_000, principal: BigInt(2_000_000) }); // owes $2, earns $0.50
    await settleOnStarknet(campaign(), submission());
    const [legs] = escrowPayouts.mock.calls[0] as unknown as [{ amountBase: bigint }[]];
    expect(legs).toHaveLength(1);
    expect(legs[0].amountBase).toBe(BigInt(500_000));
    const patch = updateSubmission.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.status).toBe("paid");
    expect(patch.claimSecret).toBeNull(); // nothing to claim — the receipt is the repayment row
    const { advanceHistory } = await import("@/lib/db/advances");
    expect(advanceHistory(WORKER)[0].outstandingBase).toBe(1_500_000);
  });

  it("no advance → ONE leg, byte-for-byte the old behaviour", async () => {
    privateRail();
    await settleOnStarknet(campaign(), submission());
    const [legs] = escrowPayouts.mock.calls[0] as unknown as [{ amountBase: bigint }[]];
    expect(legs).toHaveLength(1);
    expect(legs[0].amountBase).toBe(BigInt(500_000));
  });
});
