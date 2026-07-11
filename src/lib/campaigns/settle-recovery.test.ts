import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hash } from "viem";

/**
 * The crux crash-safety verification for settleWithRecovery: the payout is bound
 * to its AI decision (P2), one durable attempt exists per intent (P3), and NO
 * path ever blind-resends — a re-trigger, a crash mid-broadcast, or an errored
 * attempt all resolve from persisted state / the chain, never by paying twice.
 *
 * Runs against the REAL in-memory db (SAGE_DB_PATH=":memory:"); only the chain
 * (signer + readers) is mocked, so the durable ledger + resume logic are real.
 */

vi.mock("@/lib/deputy/signer", () => ({
  ensureVendorApproved: vi.fn(),
  submitRequestSpend: vi.fn(),
  awaitSpendOutcome: vi.fn(),
}));
vi.mock("@/lib/deputy/chain", () => ({
  isIntentUsed: vi.fn(),
  findSettleTxByIntent: vi.fn(),
}));

import {
  awaitSpendOutcome,
  ensureVendorApproved,
  submitRequestSpend,
} from "@/lib/deputy/signer";
import { findSettleTxByIntent, isIntentUsed } from "@/lib/deputy/chain";
import { derivePayoutIntent, settleWithRecovery } from "./settle";
import {
  createCampaign,
  createSubmission,
  getDecisionBySubmission,
  insertDecision,
} from "@/lib/db/campaigns";
import {
  getAttempt,
  markBroadcast,
  markFailed,
  prepareAttempt,
} from "@/lib/db/settlement-attempts";
import type { StoredBrief } from "@/lib/deputy/brain-core";
import type { Campaign, Submission } from "@/lib/db/schema";

let seq = 0;

function brief(): StoredBrief {
  return {
    criteria: [
      { criterion: "the app loads", met: true, confidence: 0.95, quote: "it loads" },
    ],
    fraudSignals: [],
    recommendation: "pay",
    reasonCode: "all_criteria_met",
    confidence: 0.95,
    summary: "genuine work",
    provider: "api.commonstack.ai",
  };
}

/** Seed a real campaign + submission + Deputy decision. */
function seed(): { campaign: Campaign; submission: Submission } {
  const campaign = createCampaign({
    title: "recovery",
    rewardAmount: 500_000,
    vaultAddress: `0x${"1".repeat(40)}`,
    posterWallet: `0x${"2".repeat(40)}`,
    chainId: 59902,
  });
  seq += 1;
  const wallet = `0x${seq.toString(16).padStart(40, "0")}`;
  const r = createSubmission({ campaignId: campaign.id, wallet });
  if (!r.ok) throw new Error(`seed failed: ${r.error}`);
  insertDecision({
    submissionId: r.submission.id,
    campaignId: campaign.id,
    engine: "llm",
    model: "gemini-3.1-flash-lite-preview",
    brief: brief(),
    contentSha256: "a".repeat(64),
    evidenceOk: true,
    latencyMs: 1200,
    costUsd: 0.0003,
    x402PaymentTx: null,
  });
  return { campaign, submission: r.submission };
}

const intentFor = (c: Campaign, s: Submission): Hash =>
  derivePayoutIntent(c, s, getDecisionBySubmission(s.id)).payoutIntentHash;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureVendorApproved).mockResolvedValue({
    approved: true,
    added: false,
    reason: "already_approved",
    txHashes: [],
  });
  // The real broadcast fires onBroadcast the instant the tx is sent — the mock
  // faithfully reproduces that so the durable txHash write is exercised.
  vi.mocked(submitRequestSpend).mockImplementation(async (a) => {
    await a.onBroadcast?.("0xNEW" as Hash);
    return {
      txHash: "0xNEW" as Hash,
      settled: true,
      failedCheckIndex: null,
      explorerUrl: "https://explorer/tx/0xNEW",
    };
  });
  vi.mocked(awaitSpendOutcome).mockResolvedValue({
    txHash: "0xOLD" as Hash,
    settled: true,
    failedCheckIndex: null,
    explorerUrl: "https://explorer/tx/0xOLD",
  });
  vi.mocked(isIntentUsed).mockResolvedValue(false);
  vi.mocked(findSettleTxByIntent).mockResolvedValue(null);
});

describe("derivePayoutIntent — the payout is bound to the decision (P2)", () => {
  it("a decision yields a v1-committed intent; no decision yields the legacy intent", () => {
    const { campaign, submission } = seed();
    const dec = getDecisionBySubmission(submission.id);
    const bound = derivePayoutIntent(campaign, submission, dec);
    const boundAgain = derivePayoutIntent(campaign, submission, dec);

    expect(bound.decisionDigest).toBeTruthy();
    expect(bound.payoutIntentHash).toBe(boundAgain.payoutIntentHash); // deterministic

    const legacy = derivePayoutIntent(campaign, submission, null);
    expect(legacy.decisionDigest).toBeNull();
    // binding to the decision changes the value that moves money on-chain.
    expect(legacy.payoutIntentHash).not.toBe(bound.payoutIntentHash);
  });
});

describe("settleWithRecovery — one payout, never a blind resend", () => {
  it("a fresh submission broadcasts once, on the decision-bound intent, and marks settled", async () => {
    const { campaign, submission } = seed();
    const expected = intentFor(campaign, submission);

    const out = await settleWithRecovery(campaign, submission);

    expect(out.settled).toBe(true);
    expect(out.txHash).toBe("0xNEW");
    expect(submitRequestSpend).toHaveBeenCalledTimes(1);
    // the vault is asked to consume the decision-bound intent, not a bare one.
    expect(vi.mocked(submitRequestSpend).mock.calls[0][0].intentHash).toBe(expected);

    const row = getAttempt(expected);
    expect(row?.status).toBe("settled");
    expect(row?.txHash).toBe("0xNEW");
    expect(row?.decisionDigest).toBeTruthy(); // the v1 commitment is on record
  });

  it("a re-trigger after settlement returns the recorded outcome WITHOUT re-broadcasting", async () => {
    const { campaign, submission } = seed();
    await settleWithRecovery(campaign, submission); // settles

    vi.mocked(submitRequestSpend).mockClear();
    const again = await settleWithRecovery(campaign, submission); // re-fire

    expect(again.settled).toBe(true);
    expect(again.txHash).toBe("0xNEW");
    expect(submitRequestSpend).not.toHaveBeenCalled(); // anti-double-pay
  });

  it("a crash between broadcast and receipt resumes by READING the tx, never re-sending", async () => {
    const { campaign, submission } = seed();
    const intent = intentFor(campaign, submission);
    // Model the crash: an attempt that broadcast 0xOLD but never recorded its outcome.
    prepareAttempt({
      payoutIntentHash: intent,
      decisionDigest: null,
      submissionId: submission.id,
      campaignId: campaign.id,
      chainId: campaign.chainId,
      vaultAddress: campaign.vaultAddress,
      recipient: submission.wallet,
      amountBase: campaign.rewardAmount,
    });
    markBroadcast(intent, "0xOLD" as Hash);

    const out = await settleWithRecovery(campaign, submission);

    expect(awaitSpendOutcome).toHaveBeenCalledWith("0xOLD", campaign.chainId);
    expect(submitRequestSpend).not.toHaveBeenCalled(); // resumed, not resent
    expect(out.txHash).toBe("0xOLD");
    expect(getAttempt(intent)?.status).toBe("settled");
  });

  it("an errored attempt whose intent already settled reconciles from the chain, not a resend", async () => {
    const { campaign, submission } = seed();
    const intent = intentFor(campaign, submission);
    prepareAttempt({
      payoutIntentHash: intent,
      decisionDigest: null,
      submissionId: submission.id,
      campaignId: campaign.id,
      chainId: campaign.chainId,
      vaultAddress: campaign.vaultAddress,
      recipient: submission.wallet,
      amountBase: campaign.rewardAmount,
    });
    markFailed(intent, "RPC exploded mid-send");
    vi.mocked(isIntentUsed).mockResolvedValue(true);
    vi.mocked(findSettleTxByIntent).mockResolvedValue("0xFOUND" as Hash);

    const out = await settleWithRecovery(campaign, submission);

    expect(isIntentUsed).toHaveBeenCalled();
    expect(submitRequestSpend).not.toHaveBeenCalled(); // the intent already moved money
    expect(out.settled).toBe(true);
    expect(out.txHash).toBe("0xFOUND");
    expect(getAttempt(intent)?.status).toBe("settled");
  });

  it("an errored attempt whose intent did NOT settle is safe to broadcast fresh", async () => {
    const { campaign, submission } = seed();
    const intent = intentFor(campaign, submission);
    prepareAttempt({
      payoutIntentHash: intent,
      decisionDigest: null,
      submissionId: submission.id,
      campaignId: campaign.id,
      chainId: campaign.chainId,
      vaultAddress: campaign.vaultAddress,
      recipient: submission.wallet,
      amountBase: campaign.rewardAmount,
    });
    markFailed(intent, "RPC exploded before send");
    vi.mocked(isIntentUsed).mockResolvedValue(false);

    const out = await settleWithRecovery(campaign, submission);

    expect(isIntentUsed).toHaveBeenCalled();
    expect(submitRequestSpend).toHaveBeenCalledTimes(1); // no money moved → resend is safe
    expect(out.settled).toBe(true);
  });

  it("a rejected spend is recorded as rejected and never re-charged", async () => {
    const { campaign, submission } = seed();
    const intent = intentFor(campaign, submission);
    vi.mocked(submitRequestSpend).mockImplementation(async (a) => {
      await a.onBroadcast?.("0xREJ" as Hash);
      return {
        txHash: "0xREJ" as Hash,
        settled: false,
        failedCheckIndex: 5,
        explorerUrl: "https://explorer/tx/0xREJ",
      };
    });

    const out = await settleWithRecovery(campaign, submission);
    expect(out.settled).toBe(false);
    expect(out.failedCheckIndex).toBe(5);
    expect(getAttempt(intent)?.status).toBe("rejected");

    vi.mocked(submitRequestSpend).mockClear();
    const again = await settleWithRecovery(campaign, submission);
    expect(again.settled).toBe(false);
    expect(submitRequestSpend).not.toHaveBeenCalled(); // recorded rejection, no re-send
  });
});
