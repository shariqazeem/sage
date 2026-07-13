import "server-only";

import { chainConfig } from "./networks";
import { failedCheckReason } from "./reasons";
import { getPayoutProof, type PayoutProof } from "./chain";
import {
  supportsIntentReplayProtection,
  type VaultReplaySupport,
} from "./vault-capability";
import {
  countPaidForMission,
  getCampaignByPayoutTx,
  getDecisionByPayoutTx,
  getMissionByHash,
  getSubmission,
  missionSpecInput,
} from "@/lib/db/campaigns";
import { getAttemptByTx } from "@/lib/db/settlement-attempts";
import { derivePayoutIntent } from "@/lib/campaigns/settle";
import { campaignIdHash, missionIdHash } from "@/lib/campaigns/mission-plan";
import { missionSpecDigest } from "@/lib/campaigns/mission-spec";
import { computeDecisionCommitmentV2 } from "./campaign-commitment";
import {
  campaignFailedCheckReason,
  realCampaignVaultAdapter,
  type CampaignVaultAdapter,
} from "./campaign-vault";
import { briefFromRow } from "./decisions";
import { deriveStoredX402Status } from "@/lib/x402/x402-status";
import { money, short } from "@/lib/format";
import type {
  Campaign,
  Decision,
  Mission,
  SettlementAttempt,
  Submission,
} from "@/lib/db/schema";
import type { DecisionBrief } from "./brain-core";
import type { Hex } from "viem";

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

/**
 * V2 (CampaignVault) integrity detail — every value is RECOMPUTED and compared; a
 * stored "verified" flag is never trusted. `verified` is true only when every
 * applicable check passes. Null on a V1 proof (additive — V1 consumers ignore it).
 */
export interface V2ProofDetail {
  vaultKind: "campaign_v2";
  commitmentVersion: number;
  campaignIdHash: { stored: string | null; recomputed: string; onchain: string };
  missionIdHash: { stored: string | null; recomputed: string; onchain: string };
  missionPlanDigest: { stored: string | null; onchain: string };
  missionSpecDigest: { stored: string | null; recomputed: string | null };
  reward: { db: number | null; onchain: number | null; emitted: number };
  recipient: { submission: string | null; emitted: string };
  intent: { stored: string | null; recomputed: string | null; onchain: string };
  decisionDigest: { recomputed: string | null; onchain: string };
  token: { expected: string | null; onchain: string | null };
  mission: {
    title: string | null;
    objective: string | null;
    maxCompletions: number | null;
    paidCompletions: number | null;
  } | null;
  factoryRecognizes: boolean;
  integrity: { verified: boolean; checks: Record<string, boolean>; reasons: string[] };
}

export interface FoundProof extends ProofBase {
  state: Exclude<ProofState, "not_found">;
  /** which vault contract settled this payout — legacy V1 rows are "policy_v1". */
  vaultKind: "policy_v1" | "campaign_v2";
  /** the DecisionCommitment version (1 = V1 policy, 2 = V2 campaign). */
  commitmentVersion: number;
  /** the V2 integrity detail (recomputed), or null for a V1/legacy proof. */
  v2: V2ProofDetail | null;
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
    vaultKind: "policy_v1",
    commitmentVersion: 1,
    v2: null,
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
  const amount = money(p.amount, p.chainId);
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

/* ────────────────────────────────────────────────── V2 proof (recomputed) ── */

/** The decoded on-chain V2 event (from the CampaignVault adapter). */
export interface V2Event {
  settled: boolean;
  txHash: string;
  chainId: number;
  vault: string;
  missionId: string;
  recipient: string;
  intentHash: string;
  decisionDigest: string;
  amountBase: number;
  failedCheckIndex: number | null;
  blockNumber: number | null;
  explorerUrl: string;
}

/** The on-chain vault facts a V2 proof compares against (from readSnapshot + readiness). */
export interface V2Chain {
  token: string;
  /** the vault's authorized operator (getOperator) — the only address that can settle. */
  operator: string;
  campaignIdHash: string;
  missionPlanDigest: string;
  factoryRecognizes: boolean;
  replaySupport: VaultReplaySupport;
  missionRewardBase: number | null;
  budgetCeilingBase: number;
  velocityCapBase: number;
  budgetRemainingBase: number;
  paidCompletions: number | null;
  maxCompletions: number | null;
}

export interface ProofV2Inputs {
  txHash: string;
  chainId: number;
  event: V2Event | null;
  chain: V2Chain | null;
  campaign: Campaign | null;
  mission: Mission | null;
  submission: Submission | null;
  attempt: SettlementAttempt | null;
  brief: DecisionBrief | null;
  /** DecisionCommitmentV2 recomputed from the stored decision + settlement inputs. */
  recomputed: { decisionDigest: string; payoutIntentHash: string } | null;
  recomputedCampaignIdHash: string | null;
  recomputedMissionIdHash: string | null;
  recomputedSpecDigest: string | null;
  network: string;
  isMainnet: boolean;
}

/**
 * PURE: build a V2 proof by RECOMPUTING the commitment, intent, id hashes, and
 * mission-spec digest from stored inputs and comparing them against the on-chain
 * event + vault. A stored "verified" flag is never consulted. `verified` is true
 * only when EVERY applicable check agrees; any mismatch or missing record yields a
 * non-verified state. The chain enforces the mission's economics; this proof records
 * that Sage's decision reproduces the exact committed payout — never that the chain
 * judged the work.
 */
export function buildProofV2(i: ProofV2Inputs): ComposedProof {
  const identity = { chainId: i.chainId, txHash: i.txHash };
  if (!i.event || !i.chain || !i.campaign) {
    return { version: PROOF_SCHEMA_VERSION, state: "not_found", identity };
  }
  const e = i.event;
  const c = i.chain;
  const checks: Record<string, boolean> = {};
  const reasons: string[] = [];
  const check = (name: string, ok: boolean, reason: string) => {
    checks[name] = ok;
    if (!ok) reasons.push(reason);
  };

  const haveLocal = !!(i.attempt && i.mission && i.submission && i.brief && i.recomputed);
  const committedV2 =
    !!i.attempt &&
    i.attempt.vaultKind === "campaign_v2" &&
    i.attempt.commitmentVersion === 2 &&
    !!i.attempt.decisionDigest;

  // ── the recomputed integrity checks (only meaningful with a local record) ──
  if (haveLocal && committedV2 && i.attempt && i.mission && i.submission && i.recomputed) {
    check("chain_id", e.chainId === i.campaign.chainId, "receipt_chain_ne_campaign");
    check("vault", eq(e.vault, i.campaign.vaultAddress), "log_vault_ne_campaign");
    check("factory_provenance", c.factoryRecognizes, "factory_provenance");
    check("commitment_version", i.attempt.commitmentVersion === 2, "commitment_version");
    check("vault_kind", i.attempt.vaultKind === "campaign_v2", "vault_kind");
    check(
      "campaign_id_hash",
      eq(i.campaign.campaignIdHash, i.recomputedCampaignIdHash) &&
        eq(i.campaign.campaignIdHash, c.campaignIdHash),
      "campaign_id_hash",
    );
    check(
      "mission_id_hash",
      eq(i.mission.missionIdHash, i.recomputedMissionIdHash) &&
        eq(i.mission.missionIdHash, e.missionId) &&
        eq(i.attempt.missionIdHash, e.missionId),
      "mission_id_hash",
    );
    check("mission_plan_digest", eq(i.campaign.missionPlanDigest, c.missionPlanDigest), "mission_plan_digest");
    check("token", eq(i.campaign.settlementToken, c.token), "token");
    check("recipient", eq(e.recipient, i.submission.wallet), "recipient");
    check(
      "decision_digest",
      eq(i.recomputed.decisionDigest, e.decisionDigest) &&
        eq(i.recomputed.decisionDigest, i.attempt.decisionDigest),
      "decision_digest",
    );
    check(
      "payout_intent",
      eq(i.attempt.payoutIntentHash, e.intentHash) &&
        eq(i.recomputed.payoutIntentHash, e.intentHash),
      "payout_intent",
    );
    check(
      "mission_spec_digest",
      !!i.recomputedSpecDigest &&
        eq(i.submission.missionSpecDigest, i.recomputedSpecDigest) &&
        eq(i.mission.specDigest, i.recomputedSpecDigest),
      "mission_spec_digest",
    );
    // Reward only "moves" on a settlement — verify DB == on-chain == emitted.
    if (e.settled) {
      check(
        "reward",
        i.mission.rewardAmount === e.amountBase &&
          (c.missionRewardBase === null || c.missionRewardBase === e.amountBase),
        "reward",
      );
    }
  }

  const verified = haveLocal && committedV2 && reasons.length === 0;

  let state: FoundProof["state"];
  if (!haveLocal || !committedV2) {
    state = "incomplete_local_record";
  } else if (verified) {
    state = e.settled ? "committed_settlement" : "committed_rejection";
  } else {
    state = "commitment_mismatch";
  }

  const reason = e.settled ? null : campaignFailedCheckReason(e.failedCheckIndex);
  const amountUsd = e.settled ? e.amountBase / 1_000_000 : 0; // a rejection paid nothing
  const outcome = e.settled
    ? state === "committed_settlement"
      ? `${money(amountUsd, e.chainId)} paid to ${short(e.recipient)} on ${i.network}.`
      : `${money(e.amountBase / 1_000_000, e.chainId)} moved on ${i.network}, but the stored decision does not reproduce the on-chain commitment — flagged for review.`
    : `A mission payout was refused on-chain — ${reason ?? "a policy check"}. No funds moved.`;

  const decision = i.brief ? toPublicBrief(i.brief) : null;

  const v2: V2ProofDetail = {
    vaultKind: "campaign_v2",
    commitmentVersion: i.attempt?.commitmentVersion ?? 2,
    campaignIdHash: {
      stored: i.campaign.campaignIdHash,
      recomputed: i.recomputedCampaignIdHash ?? "",
      onchain: c.campaignIdHash,
    },
    missionIdHash: {
      stored: i.mission?.missionIdHash ?? i.attempt?.missionIdHash ?? null,
      recomputed: i.recomputedMissionIdHash ?? "",
      onchain: e.missionId,
    },
    missionPlanDigest: { stored: i.campaign.missionPlanDigest, onchain: c.missionPlanDigest },
    missionSpecDigest: {
      stored: i.submission?.missionSpecDigest ?? i.mission?.specDigest ?? null,
      recomputed: i.recomputedSpecDigest,
    },
    reward: { db: i.mission?.rewardAmount ?? null, onchain: c.missionRewardBase, emitted: e.amountBase },
    recipient: { submission: i.submission?.wallet ?? null, emitted: e.recipient },
    intent: {
      stored: i.attempt?.payoutIntentHash ?? null,
      recomputed: i.recomputed?.payoutIntentHash ?? null,
      onchain: e.intentHash,
    },
    decisionDigest: { recomputed: i.recomputed?.decisionDigest ?? null, onchain: e.decisionDigest },
    token: { expected: i.campaign.settlementToken, onchain: c.token },
    mission: i.mission
      ? {
          title: i.mission.title,
          objective: i.mission.objective,
          maxCompletions: i.mission.maxCompletions,
          paidCompletions: c.paidCompletions,
        }
      : null,
    factoryRecognizes: c.factoryRecognizes,
    integrity: { verified, checks, reasons },
  };

  return {
    version: PROOF_SCHEMA_VERSION,
    state,
    vaultKind: "campaign_v2",
    commitmentVersion: i.attempt?.commitmentVersion ?? 2,
    v2,
    legacy: false,
    settled: e.settled,
    threshold: i.campaign.autopilotThreshold ?? null,
    identity,
    human: {
      outcome,
      recipient: e.recipient,
      amountUsd,
      network: i.network,
      campaignTitle: i.campaign.title ?? null,
      failedCheckIndex: e.failedCheckIndex,
      failedCheckReason: reason,
    },
    decision,
    decisionUnavailableReason: decision ? null : "The decision record for this payout is unavailable.",
    chain: {
      txHash: e.txHash,
      chainId: e.chainId,
      network: i.network,
      explorerUrl: e.explorerUrl,
      blockNumber: e.blockNumber ?? 0,
      timestamp: 0,
      vault: e.vault,
      operator: c.operator,
      eventType: e.settled ? "SpendSettled" : "SpendRejected",
      onchainIntent: e.intentHash,
      attemptStatus: i.attempt?.status ?? null,
    },
    commitment: {
      decisionDigest: i.recomputed?.decisionDigest ?? i.attempt?.decisionDigest ?? null,
      recomputedIntent: i.recomputed?.payoutIntentHash ?? null,
      storedIntent: i.attempt?.payoutIntentHash ?? null,
      onchainIntent: e.intentHash,
      matches: verified,
      mismatchReason: verified ? null : (reasons[0] ?? (haveLocal ? null : "incomplete_local_record")),
    },
    safety: {
      budget: c.budgetCeilingBase / 1_000_000,
      perTxCap: (c.missionRewardBase ?? e.amountBase) / 1_000_000,
      velocityCap: c.velocityCapBase / 1_000_000,
      remaining: c.budgetRemainingBase / 1_000_000,
      vault: e.vault,
      isMainnet: i.isMainnet,
      replaySupport: c.replaySupport,
    },
  };
}

/**
 * I/O shell: resolve the chain, join every source, recompute the commitment, read
 * the vault capability, and hand it all to the pure {@link buildProof}. Never
 * throws — an unreadable chain yields a not_found rather than a crash.
 */
export async function composeProof(
  txHash: string,
  chainIdHint?: number,
  deps: { adapter?: CampaignVaultAdapter } = {},
): Promise<ComposedProof> {
  const campaign = getCampaignByPayoutTx(txHash);
  const attempt = getAttemptByTx(txHash);
  const chainId =
    chainIdHint ?? campaign?.chainId ?? attempt?.chainId ?? chainConfig().chainId;

  // V2 (CampaignVault) settlements are decoded + verified through the V2 composer.
  if (campaign?.commitmentVersion === 2 || attempt?.vaultKind === "campaign_v2") {
    return composeProofV2(txHash, chainId, campaign, attempt, deps.adapter);
  }

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

/**
 * I/O shell for a V2 (CampaignVault) proof: decode the on-chain event, read the
 * vault snapshot + readiness, recompute the DecisionCommitmentV2 + id hashes +
 * mission-spec digest from the stored record, and hand it all to the pure
 * {@link buildProofV2}. Never throws — an unreadable chain yields not_found.
 */
async function composeProofV2(
  txHash: string,
  chainId: number,
  campaign: Campaign | null,
  attempt: SettlementAttempt | null,
  adapterOverride?: CampaignVaultAdapter,
): Promise<ComposedProof> {
  const identity = { chainId, txHash };
  const vaultAddr = (campaign?.vaultAddress ?? attempt?.vaultAddress) as `0x${string}` | undefined;
  if (!vaultAddr) return { version: PROOF_SCHEMA_VERSION, state: "not_found", identity };

  const adapter = adapterOverride ?? realCampaignVaultAdapter;
  const decoded = await adapter.awaitOutcome(txHash as `0x${string}`, chainId, vaultAddr).catch(() => null);
  if (!decoded) return { version: PROOF_SCHEMA_VERSION, state: "not_found", identity };

  const decision = getDecisionByPayoutTx(txHash);
  const submission = decision ? getSubmission(decision.submissionId) : null;
  const brief = decision ? briefFromRow(decision) : null;
  const mission =
    campaign && decoded.missionId ? getMissionByHash(campaign.id, decoded.missionId) : null;

  // Recompute the V2 commitment + id hashes + spec digest from the STORED record.
  let recomputed: { decisionDigest: string; payoutIntentHash: string } | null = null;
  let recomputedCampaignIdHash: string | null = null;
  let recomputedMissionIdHash: string | null = null;
  let recomputedSpecDigest: string | null = null;
  if (campaign && mission && submission && decision) {
    try {
      recomputedCampaignIdHash = campaignIdHash(campaign.id);
      recomputedMissionIdHash = missionIdHash(campaign.id, mission.missionKey);
      recomputedSpecDigest = missionSpecDigest(missionSpecInput(mission, recomputedCampaignIdHash));
      const cc = computeDecisionCommitmentV2({
        chainId: campaign.chainId,
        vault: campaign.vaultAddress,
        campaignIdHash: (campaign.campaignIdHash ?? recomputedCampaignIdHash) as Hex,
        missionPlanDigest: campaign.missionPlanDigest as Hex,
        missionIdHash: mission.missionIdHash as Hex,
        submissionId: submission.id,
        decisionId: decision.id,
        recipient: submission.wallet,
        rewardBase: BigInt(mission.rewardAmount),
        evidenceSha256: decision.contentSha256,
        criteria: decision.brief.criteria,
        fraudSignals: decision.brief.fraudSignals,
        recommendation: decision.brief.recommendation,
        reasonCode: decision.brief.reasonCode,
        confidence: decision.brief.confidence,
        model: decision.model,
        provider: decision.brief.provider,
      });
      recomputed = { decisionDigest: cc.decisionDigest, payoutIntentHash: cc.payoutIntentHash };
    } catch {
      recomputed = null; // malformed stored inputs → surfaced as incomplete/mismatch
    }
  }

  const cfg = chainConfig(chainId);
  // Read the vault snapshot + readiness for the chain facts + safety numbers.
  const snapshot = await adapter
    .readSnapshot(vaultAddr, chainId, [decoded.missionId as `0x${string}`])
    .catch(() => null);
  const readiness = mission
    ? await adapter
        .readMissionReadiness(
          vaultAddr,
          chainId,
          decoded.missionId as `0x${string}`,
          decoded.recipient as `0x${string}`,
        )
        .catch(() => null)
    : null;

  const chainFacts = snapshot
    ? {
        token: snapshot.token,
        operator: snapshot.operator,
        campaignIdHash: snapshot.campaignIdHash,
        missionPlanDigest: snapshot.missionPlanDigest,
        factoryRecognizes: snapshot.factoryRecognizes,
        replaySupport: snapshot.replaySupport,
        missionRewardBase:
          snapshot.missions[decoded.missionId.toLowerCase()]?.rewardBase != null
            ? Number(snapshot.missions[decoded.missionId.toLowerCase()].rewardBase)
            : null,
        budgetCeilingBase: Number(snapshot.budgetCeiling),
        velocityCapBase: readiness?.velocityCapBase ?? 0,
        budgetRemainingBase: readiness?.budgetRemainingBase ?? 0,
        paidCompletions:
          mission && decoded.missionId ? countPaidForMission(decoded.missionId) : null,
        maxCompletions: mission?.maxCompletions ?? null,
      }
    : null;

  return buildProofV2({
    txHash,
    chainId,
    event: {
      settled: decoded.status === "settled",
      txHash: decoded.txHash,
      chainId: decoded.chainId,
      vault: decoded.vault,
      missionId: decoded.missionId,
      recipient: decoded.recipient,
      intentHash: decoded.intentHash,
      decisionDigest: decoded.decisionDigest,
      amountBase: decoded.amountBase,
      failedCheckIndex: decoded.failedCheckIndex,
      blockNumber: decoded.blockNumber,
      explorerUrl: decoded.explorerUrl,
    },
    chain: chainFacts,
    campaign,
    mission,
    submission,
    attempt,
    brief,
    recomputed,
    recomputedCampaignIdHash,
    recomputedMissionIdHash,
    recomputedSpecDigest,
    network: cfg.name,
    isMainnet: cfg.isMainnet,
  });
}
