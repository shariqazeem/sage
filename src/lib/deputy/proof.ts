import "server-only";

import { chainConfig } from "./networks";
import { failedCheckReason } from "./reasons";
import { getPayoutProof, type PayoutProof } from "./chain";
import {
  supportsIntentReplayProtection,
  type VaultReplaySupport,
} from "./vault-capability";
import {
  getCampaignByPayoutTx,
  getDecisionByPayoutTx,
  getSubmission,
} from "@/lib/db/campaigns";
import { getAttemptByTx } from "@/lib/db/settlement-attempts";
import { derivePayoutIntent } from "@/lib/campaigns/settle";
import { briefFromRow } from "./decisions";
import { deriveStoredX402Status } from "@/lib/x402/x402-status";
import { usd, short } from "@/lib/format";
import type {
  Campaign,
  Decision,
  SettlementAttempt,
  Submission,
} from "@/lib/db/schema";
import type { DecisionBrief } from "./brain-core";

/**
 * THE canonical public-proof composition layer. One server-side join of the
 * on-chain receipt, the decoded PolicyVault event, the durable settlement attempt,
 * the campaign, the submission, the stored decision, the DecisionCommitmentV1
 * recomputation, and the vault's replay-protection capability — so the HTML page,
 * the JSON API, the OpenGraph image, and the agent profile all read ONE truth
 * instead of re-deriving proof logic four times.
 *
 * Transaction identity is chainId + txHash. The result is an explicitly-stated
 * proof STATE, never a lone boolean: a mismatch can never be presented as
 * verified, and a legacy payment is honestly distinguished from a
 * decision-committed one.
 */

export const PROOF_SCHEMA_VERSION = 1 as const;

export type ProofState =
  | "committed_settlement"
  | "committed_rejection"
  | "legacy_settlement"
  | "legacy_rejection"
  | "commitment_mismatch"
  | "incomplete_local_record"
  | "not_found";

/** The sanitized, publishable decision fields — never keys, prompts, or raw submissions. */
export interface PublicBrief {
  engine: "llm" | "heuristic";
  model: string | null;
  provider: string | null;
  recommendation: "pay" | "review" | "hold";
  reasonCode: string;
  confidence: number;
  summary: string;
  criteria: {
    criterion: string;
    met: boolean;
    confidence: number;
    quote?: string;
  }[];
  fraudSignals: { signal: string; severity: "low" | "med" | "high"; reason: string }[];
  evidenceOk: boolean;
  contentSha256: string | null;
  latencyMs: number | null;
  costUsd: number | null;
  /** the real GOAT x402 tx that paid for this verification, or null (see x402Status). */
  x402PaymentTx: string | null;
  /** the truthful RAIL-1 status: paid | live_fallback | not_configured | not_required | legacy_unknown. */
  x402Status: import("@/lib/x402/x402-status").X402Status;
  x402Reason: import("@/lib/x402/x402-status").X402Reason | null;
}

export interface CommitmentCheck {
  /** the v1 decision digest (recomputed from the brief, else the stored digest). */
  decisionDigest: string | null;
  /** payoutIntentHash recomputed from the stored decision + settlement inputs. */
  recomputedIntent: string | null;
  /** the intent hash persisted in the durable settlement attempt. */
  storedIntent: string | null;
  /** the intent hash decoded from the on-chain event (authoritative). */
  onchainIntent: string;
  /** true ONLY when every required source agrees. */
  matches: boolean;
  /** machine-readable reason when they do not (no secrets). */
  mismatchReason: string | null;
}

interface ProofBase {
  version: typeof PROOF_SCHEMA_VERSION;
  identity: { chainId: number; txHash: string };
}

export interface FoundProof extends ProofBase {
  state: Exclude<ProofState, "not_found">;
  /** true when the payout predates decision-commitment v1 (a valid PAYMENT proof, not a decision-commitment proof). */
  legacy: boolean;
  settled: boolean;
  /** the campaign's autopilot confidence bar, for the decision receipt (or null). */
  threshold: number | null;
  human: {
    outcome: string;
    recipient: string;
    amountUsd: number;
    network: string;
    campaignTitle: string | null;
    failedCheckIndex: number | null;
    failedCheckReason: string | null;
  };
  decision: PublicBrief | null;
  decisionUnavailableReason: string | null;
  chain: {
    txHash: string;
    chainId: number;
    network: string;
    explorerUrl: string;
    blockNumber: number;
    timestamp: number;
    vault: string;
    operator: string;
    eventType: "SpendSettled" | "SpendRejected";
    onchainIntent: string;
    attemptStatus: string | null;
  };
  commitment: CommitmentCheck | null;
  safety: {
    budget: number;
    perTxCap: number;
    velocityCap: number;
    remaining: number;
    vault: string;
    isMainnet: boolean;
    replaySupport: VaultReplaySupport | null;
  };
}

export type ComposedProof = (ProofBase & { state: "not_found" }) | FoundProof;

/** Narrowing helper for the four consumers. */
export function isFoundProof(p: ComposedProof): p is FoundProof {
  return p.state !== "not_found";
}

function toPublicBrief(b: DecisionBrief): PublicBrief {
  return {
    engine: b.engine,
    model: b.model,
    provider: b.provider,
    recommendation: b.recommendation,
    reasonCode: b.reasonCode,
    confidence: b.confidence,
    summary: b.summary,
    criteria: b.criteria.map((c) => ({
      criterion: c.criterion,
      met: c.met,
      confidence: c.confidence,
      ...(c.quote ? { quote: c.quote } : {}),
    })),
    fraudSignals: b.fraudSignals.map((f) => ({
      signal: f.signal,
      severity: f.severity,
      reason: f.reason,
    })),
    evidenceOk: b.evidenceOk,
    contentSha256: b.contentSha256,
    latencyMs: b.latencyMs,
    costUsd: b.costUsd,
    x402PaymentTx: b.x402PaymentTx,
    x402Status: b.x402Status ?? deriveStoredX402Status(null, b.x402PaymentTx),
    x402Reason: b.x402Reason ?? null,
  };
}

const eq = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The joined inputs — everything the pure discriminator needs. */
export interface ProofInputs {
  txHash: string;
  chainId: number;
  proof: PayoutProof | null;
  campaign: Campaign | null;
  decision: Decision | null;
  submission: Submission | null;
  attempt: SettlementAttempt | null;
  /** payoutIntentHash + digest recomputed from the stored decision, or null. */
  recomputed: { payoutIntentHash: string; decisionDigest: string | null } | null;
  brief: DecisionBrief | null;
  capability: VaultReplaySupport | null;
}

/**
 * PURE: decide the proof state from the joined inputs and build the composed
 * result. No I/O — the whole discrimination (including the integrity check) is
 * unit-testable without a chain or a database.
 */
export function buildProof(i: ProofInputs): ComposedProof {
  const identity = { chainId: i.chainId, txHash: i.txHash };
  if (!i.proof) return { version: PROOF_SCHEMA_VERSION, state: "not_found", identity };

  const p = i.proof;
  const onchainIntent = p.intentHash;
  const eventType = p.settled ? ("SpendSettled" as const) : ("SpendRejected" as const);

  // The commitment check only applies to a payout that went through the
  // decision-committed durable path (an attempt row carrying a decision digest).
  const committedPath = !!(i.attempt && i.attempt.decisionDigest);
  let commitment: CommitmentCheck | null = null;
  if (committedPath && i.attempt) {
    const storedIntent = i.attempt.payoutIntentHash;
    const recomputedIntent = i.recomputed?.payoutIntentHash ?? null;
    const recomputedDigest = i.recomputed?.decisionDigest ?? null;
    const storedMatches = eq(storedIntent, onchainIntent);
    const canRecompute = recomputedIntent != null;
    const recomputedMatches =
      canRecompute &&
      eq(recomputedIntent, onchainIntent) &&
      eq(recomputedDigest, i.attempt.decisionDigest);
    const matches = storedMatches && canRecompute && recomputedMatches;
    let mismatchReason: string | null = null;
    if (!storedMatches) mismatchReason = "stored_intent_ne_onchain";
    else if (!canRecompute) mismatchReason = "cannot_recompute_missing_brief";
    else if (!recomputedMatches) mismatchReason = "recomputed_intent_ne_onchain";
    commitment = {
      decisionDigest: recomputedDigest ?? i.attempt.decisionDigest,
      recomputedIntent,
      storedIntent,
      onchainIntent,
      matches,
      mismatchReason,
    };
  }

  // Discriminate.
  let state: FoundProof["state"];
  let legacy = false;
  if (commitment) {
    if (commitment.matches) {
      state = p.settled ? "committed_settlement" : "committed_rejection";
    } else if (commitment.mismatchReason === "cannot_recompute_missing_brief") {
      state = "incomplete_local_record";
    } else {
      state = "commitment_mismatch";
    }
  } else {
    legacy = true;
    state = p.settled ? "legacy_settlement" : "legacy_rejection";
  }

  const reason = p.settled ? null : failedCheckReason(p.failedCheckIndex);
  const outcome = buildOutcome(state, p, reason);

  const decision = i.brief ? toPublicBrief(i.brief) : null;
  const decisionUnavailableReason = decision
    ? null
    : legacy
      ? "This payout predates Sage's decision receipts (decision commitment v1)."
      : "The decision record for this payout is unavailable.";

  return {
    version: PROOF_SCHEMA_VERSION,
    state,
    legacy,
    settled: p.settled,
    threshold: i.campaign?.autopilotThreshold ?? null,
    identity,
    human: {
      outcome,
      recipient: p.recipient,
      amountUsd: p.amount,
      network: p.network,
      campaignTitle: i.campaign?.title ?? null,
      failedCheckIndex: p.failedCheckIndex,
      failedCheckReason: reason,
    },
    decision,
    decisionUnavailableReason,
    chain: {
      txHash: p.txHash,
      chainId: p.chainId,
      network: p.network,
      explorerUrl: p.explorerUrl,
      blockNumber: p.blockNumber,
      timestamp: p.timestamp,
      vault: p.vault,
      operator: p.operator,
      eventType,
      onchainIntent,
      attemptStatus: i.attempt?.status ?? null,
    },
    commitment,
    safety: {
      budget: p.budget,
      perTxCap: p.perTxCap,
      velocityCap: p.velocityCap,
      remaining: p.remaining,
      vault: p.vault,
      isMainnet: chainConfig(p.chainId).isMainnet,
      replaySupport: i.capability,
    },
  };
}

function buildOutcome(
  state: FoundProof["state"],
  p: PayoutProof,
  reason: string | null,
): string {
  const amount = usd(p.amount);
  const who = short(p.recipient);
  switch (state) {
    case "committed_settlement":
    case "legacy_settlement":
      return `${amount} paid to ${who} on ${p.network}.`;
    case "committed_rejection":
    case "legacy_rejection":
      return `A ${amount} payout was refused on-chain — ${reason ?? "a policy check"}. No funds moved.`;
    case "commitment_mismatch":
      return p.settled
        ? `${amount} moved on ${p.network}, but the stored decision does not reproduce the on-chain commitment — flagged for review.`
        : `A ${amount} payout was refused, and the stored decision does not reproduce the on-chain commitment — flagged for review.`;
    case "incomplete_local_record":
      return `${amount} ${p.settled ? "paid" : "refused"} on-chain; Sage's local decision record is incomplete.`;
  }
}

/**
 * I/O shell: resolve the chain, join every source, recompute the commitment, read
 * the vault capability, and hand it all to the pure {@link buildProof}. Never
 * throws — an unreadable chain yields a not_found rather than a crash.
 */
export async function composeProof(
  txHash: string,
  chainIdHint?: number,
): Promise<ComposedProof> {
  const campaign = getCampaignByPayoutTx(txHash);
  const attempt = getAttemptByTx(txHash);
  const chainId =
    chainIdHint ?? campaign?.chainId ?? attempt?.chainId ?? chainConfig().chainId;

  const proof = await getPayoutProof(txHash, chainId).catch(() => null);
  if (!proof) {
    return { version: PROOF_SCHEMA_VERSION, state: "not_found", identity: { chainId, txHash } };
  }

  const decision = getDecisionByPayoutTx(txHash);
  const submission = decision ? getSubmission(decision.submissionId) : null;
  const brief = decision ? briefFromRow(decision) : null;

  let recomputed: { payoutIntentHash: string; decisionDigest: string | null } | null =
    null;
  if (campaign && submission && decision) {
    try {
      recomputed = derivePayoutIntent(campaign, submission, decision);
    } catch {
      recomputed = null; // malformed stored inputs → can't recompute (surfaced as incomplete/mismatch)
    }
  }

  const capability = await supportsIntentReplayProtection(
    proof.vault as `0x${string}`,
    proof.chainId,
  ).catch(() => null);

  return buildProof({
    txHash: proof.txHash,
    chainId: proof.chainId,
    proof,
    campaign,
    decision,
    submission,
    attempt,
    recomputed,
    brief,
    capability,
  });
}
