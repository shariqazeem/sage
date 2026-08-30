import { beforeEach, describe, expect, it, vi } from "vitest";

const requestVaultPayout = vi.fn();
const updateSubmission = vi.fn();
const announceCampaignSettledStarknet = vi.fn(async () => {});
const notifyFounderSettled = vi.fn(async () => {});

vi.mock("@/lib/starknet/vault", () => ({
  requestVaultPayout: (...a: unknown[]) => requestVaultPayout(...a),
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
