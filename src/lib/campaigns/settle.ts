import "server-only";

import { getAddress, type Address, type Hash } from "viem";
import {
  awaitSpendOutcome,
  ensureVendorApproved,
  submitRequestSpend,
  type RequestSpendResult,
} from "@/lib/deputy/signer";
import { findSettleTxByIntent, isIntentUsed } from "@/lib/deputy/chain";
import { explorerTxUrl } from "@/lib/deputy/networks";
import { failedCheckReason } from "@/lib/deputy/reasons";
import { computeDecisionCommitment } from "@/lib/deputy/payout-commitment";
import { submissionIntentHash } from "@/lib/db/keys";
import { getDecisionBySubmission } from "@/lib/db/campaigns";
import {
  getAttempt,
  markBroadcast,
  markFailed,
  markRejected,
  markSettled,
  planResume,
  prepareAttempt,
} from "@/lib/db/settlement-attempts";
import type {
  Campaign,
  Decision,
  SettlementAttempt,
  Submission,
} from "@/lib/db/schema";

/**
 * The on-chain outcome of settling one approved submission. Everything the
 * review UI and the proof page need to render truthfully — including the honest
 * "we couldn't pay, and exactly why" paths.
 */
export interface SettleOutcome {
  settled: boolean;
  txHash: Hash | null;
  explorerUrl: string | null;
  /** The failing policy check (1..7) when a spend soft-rejects, else null. */
  failedCheckIndex: number | null;
  reason: string | null;
  /** true when the vault's owner (not our operator) must approve the recipient. */
  needsOwnerAdd: boolean;
  /** true when THIS call allowlisted the recipient server-side (we own the vault). */
  vendorAdded: boolean;
  /** the executeAddVendor tx hash, when we added the recipient. */
  vendorTxHash: Hash | null;
  recipient: Address;
  /** Reward in 6dp base units, echoed for the caller. */
  amountBase: number;
}

/* ─────────────────────────────── P2: the decision-bound payout intent ──── */

export interface PayoutIntent {
  payoutIntentHash: Hash;
  /** the v1 decision digest, or null when there is no decision (a legacy intent). */
  decisionDigest: Hash | null;
}

/**
 * Derive the on-chain payout intent for a submission. When a Deputy decision
 * exists, the intent is BOUND to that exact decision via the v1 commitment — so
 * the value that moves money is a function of the AI judgment that authorized it
 * (change any committed field and the intent changes). With no decision on record
 * it falls back to the legacy per-(campaign, submission) intent: still
 * deterministic, just not decision-bound. Pure — unit-testable without a chain.
 */
export function derivePayoutIntent(
  campaign: Campaign,
  submission: Submission,
  decision: Decision | null,
): PayoutIntent {
  if (!decision) {
    return {
      payoutIntentHash: submissionIntentHash(campaign.id, submission.id),
      decisionDigest: null,
    };
  }
  const brief = decision.brief;
  const { decisionDigest, payoutIntentHash } = computeDecisionCommitment({
    chainId: campaign.chainId,
    vault: campaign.vaultAddress,
    campaignId: campaign.id,
    submissionId: submission.id,
    decisionId: decision.id,
    recipient: submission.wallet,
    amountBase: BigInt(campaign.rewardAmount),
    evidenceSha256: decision.contentSha256,
    criteria: brief.criteria,
    fraudSignals: brief.fraudSignals,
    recommendation: brief.recommendation,
    reasonCode: brief.reasonCode,
    confidence: brief.confidence,
    model: decision.model,
    provider: brief.provider,
  });
  return { payoutIntentHash, decisionDigest };
}

/**
 * Reconstruct a SettleOutcome from an already-completed attempt row — the
 * app-level anti-double-pay guard. When a re-trigger finds the intent already
 * settled (or rejected) on record, we return that recorded result WITHOUT
 * touching the chain again. Pure.
 */
export function outcomeFromAttempt(attempt: SettlementAttempt): SettleOutcome {
  const settled = attempt.status === "settled";
  const txHash = (attempt.txHash ?? null) as Hash | null;
  return {
    settled,
    txHash,
    explorerUrl: txHash ? explorerTxUrl(attempt.chainId, txHash) : null,
    failedCheckIndex: settled ? null : attempt.failedCheckIndex,
    reason: settled ? null : failedCheckReason(attempt.failedCheckIndex),
    needsOwnerAdd: false,
    vendorAdded: false,
    vendorTxHash: null,
    recipient: getAddress(attempt.recipient),
    amountBase: attempt.amountBase,
  };
}

function outcomeFromSpend(
  res: RequestSpendResult,
  campaign: Campaign,
  submission: Submission,
  vendorAdded = false,
  vendorTxHash: Hash | null = null,
): SettleOutcome {
  return {
    settled: res.settled,
    txHash: res.txHash,
    explorerUrl: res.explorerUrl,
    failedCheckIndex: res.failedCheckIndex,
    reason: res.settled ? null : failedCheckReason(res.failedCheckIndex),
    needsOwnerAdd: false,
    vendorAdded,
    vendorTxHash,
    recipient: getAddress(submission.wallet),
    amountBase: campaign.rewardAmount,
  };
}

function persistSpend(payoutIntentHash: Hash, res: RequestSpendResult): void {
  if (res.settled) markSettled(payoutIntentHash, res.txHash);
  else markRejected(payoutIntentHash, res.txHash, res.failedCheckIndex);
}

const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/* ───────────────────────────────────────────────── the spend primitive ── */

/**
 * Settle one approved submission: make sure the recipient is an allowlisted
 * vendor (adding it if we own the vault), then release the reward with the
 * operator key against the given `intentHash`. The amount and recipient are the
 * campaign's + submission's own — never client-supplied — and the vault enforces
 * policy regardless. The caller supplies the intent hash (decision-bound in the
 * durable path) and an `onBroadcast` hook so the tx hash is persisted the instant
 * it is broadcast. Prefer {@link settleWithRecovery} — this is its broadcast leg.
 */
export async function settleSubmission(args: {
  campaign: Campaign;
  submission: Submission;
  intentHash: Hash;
  onBroadcast?: (txHash: Hash) => void | Promise<void>;
}): Promise<SettleOutcome> {
  const { campaign, submission, intentHash } = args;
  // HARD SANDBOX GUARD: a sandbox campaign (the public "try to jailbreak the
  // Deputy" box) can NEVER settle. This THROWS rather than returns, so any code
  // path that reaches a spend for a sandbox campaign fails loudly — payment is
  // structurally unreachable, not merely gated.
  if (campaign.sandbox) {
    throw new Error(
      `refusing to settle sandbox campaign ${campaign.id} — payment is structurally disabled`,
    );
  }
  const vault = getAddress(campaign.vaultAddress);
  const recipient = getAddress(submission.wallet);
  const amount = BigInt(campaign.rewardAmount);

  const vendor = await ensureVendorApproved(vault, recipient, campaign.chainId);
  if (!vendor.approved) {
    const reason =
      vendor.reason === "owner_must_add"
        ? "the recipient must be approved by the vault owner before payout"
        : vendor.reason === "timelock_pending"
          ? "the recipient's approval is still inside its timelock window"
          : "the recipient could not be approved for payout";
    return {
      settled: false,
      txHash: null,
      explorerUrl: null,
      failedCheckIndex: 3, // would fail the vendor check
      reason,
      needsOwnerAdd: vendor.reason === "owner_must_add",
      vendorAdded: false,
      vendorTxHash: null,
      recipient,
      amountBase: campaign.rewardAmount,
    };
  }

  const res = await submitRequestSpend({
    vault,
    vendor: recipient,
    amount,
    intentHash,
    chainId: campaign.chainId,
    onBroadcast: args.onBroadcast,
  });
  return outcomeFromSpend(res, campaign, submission, vendor.added, vendor.txHashes.at(-1) ?? null);
}

/* ────────────────────────────────── the durable, crash-safe entry point ── */

/**
 * Settle one approved submission, crash-recoverably. This is the durable entry
 * point the flow uses. It:
 *   1. binds the payout to its AI decision (P2) — the intent hash is a function
 *      of the exact decision that authorized it;
 *   2. records ONE durable attempt per intent (P3), writing the tx hash the
 *      instant it is broadcast; and
 *   3. RESUMES from the persisted attempt instead of ever blind-resending —
 *      reading a prior tx's receipt, or verifying `isIntentUsed` on-chain before
 *      any resend.
 *
 * The vault's on-chain replay guard (check 7) is the ultimate backstop that money
 * can't move twice; this keeps the APP's record consistent with what actually
 * happened on-chain, so a crash mid-settle never becomes a double payout or a
 * settled payout mis-recorded as blocked.
 */
export async function settleWithRecovery(
  campaign: Campaign,
  submission: Submission,
): Promise<SettleOutcome> {
  if (campaign.sandbox) {
    throw new Error(
      `refusing to settle sandbox campaign ${campaign.id} — payment is structurally disabled`,
    );
  }
  const vault = getAddress(campaign.vaultAddress);
  const decision = getDecisionBySubmission(submission.id);
  const { payoutIntentHash, decisionDigest } = derivePayoutIntent(
    campaign,
    submission,
    decision,
  );

  prepareAttempt({
    payoutIntentHash,
    decisionDigest,
    submissionId: submission.id,
    campaignId: campaign.id,
    chainId: campaign.chainId,
    vaultAddress: campaign.vaultAddress,
    recipient: submission.wallet,
    amountBase: campaign.rewardAmount,
  });

  const attempt = getAttempt(payoutIntentHash);

  // Defensive: the intent commits to chainId + vault (decision-bound) or maps 1:1
  // to a campaign (legacy), so a found attempt's chain/vault must match this
  // campaign. A disagreement would signal a hash collision or a bug — refuse
  // rather than settle against a mismatched record.
  if (
    attempt &&
    (attempt.chainId !== campaign.chainId ||
      attempt.vaultAddress.toLowerCase() !== vault.toLowerCase())
  ) {
    throw new Error(
      `settlement attempt ${payoutIntentHash} chain/vault mismatch — refusing to settle`,
    );
  }

  const plan = planResume(attempt);

  // Already completed on record → return the recorded outcome, never re-pay.
  if ((plan.kind === "settled" || plan.kind === "rejected") && attempt) {
    return outcomeFromAttempt(attempt);
  }

  // A prior attempt broadcast a tx whose outcome we never persisted → read that
  // tx's receipt; NEVER re-send.
  if (plan.kind === "await") {
    try {
      const res = await awaitSpendOutcome(plan.txHash, campaign.chainId);
      persistSpend(payoutIntentHash, res);
      return outcomeFromSpend(res, campaign, submission);
    } catch (err) {
      markFailed(payoutIntentHash, errMsg(err));
      throw err;
    }
  }

  // Anomalous/errored → check the chain BEFORE any resend. If the intent already
  // settled, reconcile from the chain; otherwise fall through to a fresh spend.
  if (plan.kind === "verify") {
    const used = await isIntentUsed(vault, payoutIntentHash, campaign.chainId).catch(
      () => false,
    );
    if (used) {
      const tx =
        plan.txHash ??
        (await findSettleTxByIntent(vault, payoutIntentHash, campaign.chainId));
      if (!tx) {
        throw new Error(
          `intent ${payoutIntentHash} is used on-chain but its settle tx was not found — holding for reconciliation`,
        );
      }
      markSettled(payoutIntentHash, tx);
      const row = getAttempt(payoutIntentHash);
      if (row) return outcomeFromAttempt(row);
    }
    // not used (or tx just marked) — safe to broadcast fresh (fall through).
  }

  // Fresh broadcast. `onBroadcast` persists the tx hash the instant it is sent.
  try {
    const res = await settleSubmission({
      campaign,
      submission,
      intentHash: payoutIntentHash,
      onBroadcast: (h) => markBroadcast(payoutIntentHash, h),
    });
    // A vendor-not-approved / needs-owner-add result produced NO tx → leave the
    // attempt 'prepared' (retryable); a re-fire after the owner allowlists the
    // recipient resumes it. Only a real on-chain result advances the attempt.
    if (res.txHash) {
      if (res.settled) markSettled(payoutIntentHash, res.txHash);
      else markRejected(payoutIntentHash, res.txHash, res.failedCheckIndex);
    }
    return res;
  } catch (err) {
    markFailed(payoutIntentHash, errMsg(err));
    throw err;
  }
}
