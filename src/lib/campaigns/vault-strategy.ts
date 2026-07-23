import "server-only";

import { getAddress, type Address, type Hash, type Hex } from "viem";

import type {
  Campaign,
  Decision,
  Mission,
  SettlementAttempt,
  Submission,
  VaultKind,
} from "@/lib/db/schema";
import {
  settleSubmission,
  derivePayoutIntent,
  outcomeFromSpend,
  outcomeFromAttempt,
  type SettleOutcome,
} from "./settle-core";
import { awaitSpendOutcome } from "@/lib/deputy/signer";
import { operatorAddress } from "@/lib/deputy/signer";
import { findSettleTxByIntent, isIntentUsed as v1IsIntentUsed } from "@/lib/deputy/chain";
import { explorerTxUrl } from "@/lib/deputy/networks";
import {
  campaignFailedCheckReason,
  realCampaignVaultAdapter,
  resolveCanonicalOutcome,
  type CampaignPayoutOutcome,
  type CampaignVaultAdapter,
} from "@/lib/deputy/campaign-vault";
import { computeDecisionCommitmentV2 } from "@/lib/deputy/campaign-commitment";
import {
  checkVaultAgreement,
  type AgreementResult,
  type ChainCampaignSnapshot,
  type DbCampaignPlan,
} from "./vault-agreement";
import { getDecisionBySubmission, getMissionByHash, listMissions } from "@/lib/db/campaigns";
import {
  getAttempt,
  markBroadcast,
  markBroadcasting,
  markFailed,
  markRejected,
  markSettled,
  planResume,
  prepareAttempt,
} from "@/lib/db/settlement-attempts";

/**
 * The vault-agnostic settlement seam. Sage settles against two vault kinds — the
 * V1 PolicyVault (allowlisted-vendor spends) and the V2 CampaignVault (mission-bound
 * payouts to previously-unknown testers). The crash-recovery orchestration
 * ({@link settleWithRecoveryVia}) is written ONCE, against a normalized
 * {@link VaultStrategy}, so it never branches on vault kind: it prepares a durable
 * attempt, resumes from persisted state (never a blind resend), and applies the
 * outcome. Everything kind-specific — how the intent is committed, how a payout is
 * broadcast, how an on-chain event is decoded — lives behind the strategy.
 *
 * SAFETY: the strategy is chosen ONLY from the campaign's persisted `vaultKind`
 * (never probed from chain, never inferred from a revert); an unknown kind fails
 * closed. Every recovered V2 event is integrity-checked against the durable attempt
 * before it can mark a submission paid, and every V2 broadcast is gated on the DB
 * agreeing with the on-chain plan.
 */

/* ─────────────────────────────────────────────── normalized outcome ─────── */

export type NormalizedStatus = "settled" | "rejected" | "not_found" | "pending";

/**
 * A vault-kind-agnostic view of a settlement outcome — everything the orchestration
 * needs to persist the durable attempt, integrity-check a recovered event, and
 * render a truthful {@link SettleOutcome}. V2 fields (missionIdHash, blockNumber,
 * decoded amount) are null for V1; V1 vendor-approval fields are false/null for V2.
 */
export interface NormalizedOutcome {
  status: NormalizedStatus;
  vaultKind: VaultKind;
  commitmentVersion: number;
  chainId: number;
  vault: Address;
  intentHash: Hash;
  txHash: Hash | null;
  blockNumber: number | null;
  recipient: Address | null;
  /** the settled amount (V2: decoded + verified from the event; V1: campaign reward). */
  amountBase: number | null;
  failedCheckIndex: number | null;
  missionIdHash: Hash | null;
  decisionDigest: Hash | null;
  explorerUrl: string | null;
  reason: string | null;
  // V1 (PolicyVault) vendor-approval surface — V2 never sets these.
  needsOwnerAdd: boolean;
  vendorAdded: boolean;
  vendorTxHash: Hash | null;
}

/** The pure, durable-attempt inputs + what a fresh broadcast will consume. */
export interface SettlementPlan {
  vaultKind: VaultKind;
  commitmentVersion: number;
  payoutIntentHash: Hash;
  decisionDigest: Hash | null;
  submissionId: string;
  campaignId: string;
  chainId: number;
  vaultAddress: string;
  recipient: string;
  amountBase: number;
  missionIdHash: Hash | null;
}

/** Hooks fired around a fresh broadcast so the durable ledger stays ahead of the chain. */
export interface BroadcastHooks {
  /**
   * Fired with the broadcast IDENTITY the instant it is computed — BEFORE submission —
   * so "a tx may now be in flight" is durable before the RPC can accept one. Only V2
   * fires it; V1 leaves it unused (V1 attempts never enter the `broadcasting` state).
   */
  onPreflight?: (meta: {
    sender: string;
    nonce: number | null;
    calldataHash: string;
  }) => void | Promise<void>;
  /** Fired with the tx hash the instant it is submitted (after the RPC returns it). */
  onBroadcast: (txHash: Hash) => void | Promise<void>;
}

/**
 * The reconciliation of an AMBIGUOUS broadcast (a tx that MAY have been accepted):
 *   - settled/rejected: a trustworthy canonical on-chain outcome was found;
 *   - resend: PROVABLY no tx was accepted (reserved nonce unused) — safe to broadcast;
 *   - hold: a tx may be pending / a settlement may be concealed — HOLD, never resend.
 */
export type BroadcastReconciliation =
  | { kind: "settled"; outcome: NormalizedOutcome }
  | { kind: "rejected"; outcome: NormalizedOutcome }
  | { kind: "resend" }
  | { kind: "hold"; reason: string };

/** How the orchestration interacts with a vault, regardless of kind. */
export interface VaultStrategy {
  readonly vaultKind: VaultKind;
  readonly commitmentVersion: number;
  /** PURE: the durable-attempt inputs + broadcast params. No chain, no db writes. */
  plan(): SettlementPlan;
  /** Broadcast a fresh settlement; hooks persist the identity + hash around submission. */
  broadcast(hooks: BroadcastHooks): Promise<NormalizedOutcome>;
  /** Read the outcome of an already-broadcast tx (crash recovery — never re-sends). */
  awaitOutcome(txHash: Hash): Promise<NormalizedOutcome>;
  /** Replay guard: has this intent already settled on-chain? */
  isIntentUsed(): Promise<boolean>;
  /** Recovery: find the settled outcome for this intent, or null if not settled. */
  findOutcomeByIntent(): Promise<NormalizedOutcome | null>;
  /**
   * Reconcile an AMBIGUOUS `broadcasting` attempt (a tx may be in flight). Consults
   * the intent's canonical on-chain outcome and the reserved nonce; never blind-resends.
   */
  reconcileBroadcasting(attempt: SettlementAttempt): Promise<BroadcastReconciliation>;
}

/** Injected dependencies (tests supply fakes; production uses the real adapter). */
export interface VaultStrategyDeps {
  /** the CampaignVault V2 chain adapter (a fake transport/signer under test). */
  campaignAdapter?: CampaignVaultAdapter;
  /** the Sage operator configured for a chain (for V2 agreement). */
  operatorAddress?: (chainId: number) => Address;
  /** Phase 4 — payout action-replay test seam (fake browser runner + loopback/egress deps). Undefined in prod. */
  payoutReplay?: import("@/lib/deputy/payout-replay").PayoutReplayDeps;
}

/* ─────────────────────────────────────────────────────────── errors ─────── */

/** A DB↔chain mismatch — the V2 vault does not enforce what the DB claims. HOLD. */
export class VaultAgreementError extends Error {
  constructor(
    readonly intentHash: string,
    readonly fields: string[],
  ) {
    super(`vault disagrees with plan for ${intentHash}: ${fields.join(", ")}`);
    this.name = "VaultAgreementError";
  }
}

/** A recovered on-chain event disagrees with the durable attempt — never a settlement. */
export class SettlementIntegrityError extends Error {
  constructor(
    readonly intentHash: string,
    readonly fields: string[],
  ) {
    super(`recovered event disagrees with attempt ${intentHash}: ${fields.join(", ")}`);
    this.name = "SettlementIntegrityError";
  }
}

/**
 * A broadcast that MAY have been accepted cannot be resolved to a trustworthy on-chain
 * outcome and cannot be proven un-sent. HOLD — never resend (a resend could double-pay).
 */
export class AmbiguousBroadcastError extends Error {
  constructor(
    readonly intentHash: string,
    reason: string,
  ) {
    super(`ambiguous broadcast for ${intentHash}: ${reason}`);
    this.name = "AmbiguousBroadcastError";
  }
}

const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const eqHex = (a: string | null, b: string | null): boolean =>
  (a?.toLowerCase() ?? null) === (b?.toLowerCase() ?? null);

/**
 * Build the application-derived plan for a campaign_v2 campaign and compare it to
 * the on-chain snapshot. ONE builder, shared by the pipeline's V2 pre-flight and
 * the strategy's pre-broadcast guard, so both judge agreement identically. The
 * budget is Σ(reward × maxCompletions) over the FULL mission plan.
 *
 * The expected settlement token comes ONLY from the campaign's persisted
 * `settlementToken` — recorded INDEPENDENTLY at creation, never read back from the
 * vault being validated. A missing token (or one that disagrees with the vault) is a
 * closed door: `""` can never equal the on-chain token, so agreement fails. This is
 * what lets us detect a vault deployed with the wrong token. It NEVER repairs the DB.
 */
export function evaluateCampaignAgreement(
  campaign: Campaign,
  allMissions: Mission[],
  snapshot: ChainCampaignSnapshot,
  operatorFor: (chainId: number) => Address,
): AgreementResult {
  const budgetBase = allMissions.reduce(
    (s, m) => s + BigInt(m.rewardAmount) * BigInt(m.maxCompletions),
    BigInt(0),
  );
  const db: DbCampaignPlan = {
    chainId: campaign.chainId,
    vaultKind: "campaign_v2",
    ownerFounder: campaign.posterWallet,
    operatorConfigured: operatorFor(campaign.chainId),
    // Independent of the vault: the token the founder deployed with, recorded at
    // creation. Missing ⇒ "" ⇒ guaranteed mismatch ⇒ HOLD (fail closed).
    token: campaign.settlementToken ?? "",
    campaignIdHash: campaign.campaignIdHash ?? "",
    missionPlanDigest: campaign.missionPlanDigest ?? "",
    budgetBase,
    missions: allMissions.map((m) => ({
      missionIdHash: m.missionIdHash,
      rewardBase: BigInt(m.rewardAmount),
      maxCompletions: BigInt(m.maxCompletions),
    })),
  };
  return checkVaultAgreement(db, snapshot);
}

/* ─────────────────────────────────────────── V1 (PolicyVault) strategy ──── */

/**
 * Wraps the FROZEN V1 primitives ({@link settleSubmission}, {@link derivePayoutIntent},
 * the V1 signer/chain readers) unchanged. Its normalized outcomes round-trip back to
 * byte-identical V1 {@link SettleOutcome}s, so V1 behavior is preserved exactly.
 */
export class PolicyVaultV1Strategy implements VaultStrategy {
  readonly vaultKind: VaultKind = "policy_v1";
  readonly commitmentVersion = 1;
  private readonly plan_: SettlementPlan;

  constructor(
    private readonly campaign: Campaign,
    private readonly submission: Submission,
    decision: Decision | null,
  ) {
    const { payoutIntentHash, decisionDigest } = derivePayoutIntent(
      campaign,
      submission,
      decision,
    );
    this.plan_ = {
      vaultKind: "policy_v1",
      commitmentVersion: 1,
      payoutIntentHash,
      decisionDigest,
      submissionId: submission.id,
      campaignId: campaign.id,
      chainId: campaign.chainId,
      vaultAddress: campaign.vaultAddress,
      recipient: submission.wallet,
      amountBase: campaign.rewardAmount,
      missionIdHash: null,
    };
  }

  plan(): SettlementPlan {
    return this.plan_;
  }

  private normalize(o: SettleOutcome): NormalizedOutcome {
    const status: NormalizedStatus = o.settled ? "settled" : o.txHash ? "rejected" : "pending";
    return {
      status,
      vaultKind: "policy_v1",
      commitmentVersion: 1,
      chainId: this.plan_.chainId,
      vault: getAddress(this.plan_.vaultAddress),
      intentHash: this.plan_.payoutIntentHash,
      txHash: o.txHash,
      blockNumber: null,
      recipient: o.recipient,
      amountBase: o.amountBase,
      failedCheckIndex: o.failedCheckIndex,
      missionIdHash: null,
      decisionDigest: this.plan_.decisionDigest,
      explorerUrl: o.explorerUrl,
      reason: o.reason,
      needsOwnerAdd: o.needsOwnerAdd,
      vendorAdded: o.vendorAdded,
      vendorTxHash: o.vendorTxHash,
    };
  }

  async broadcast(hooks: BroadcastHooks): Promise<NormalizedOutcome> {
    // V1 keeps its exact behavior: it does not use the pre-flight identity hook (it
    // never enters the `broadcasting` state) — its allowlist+spend leg is unchanged.
    const o = await settleSubmission({
      campaign: this.campaign,
      submission: this.submission,
      intentHash: this.plan_.payoutIntentHash,
      onBroadcast: hooks.onBroadcast,
    });
    return this.normalize(o);
  }

  async reconcileBroadcasting(): Promise<BroadcastReconciliation> {
    // V1 attempts never enter `broadcasting`, so this is unreachable in practice.
    throw new Error("policy_v1 attempts do not use the broadcasting state");
  }

  async awaitOutcome(txHash: Hash): Promise<NormalizedOutcome> {
    const res = await awaitSpendOutcome(txHash, this.campaign.chainId);
    return this.normalize(outcomeFromSpend(res, this.campaign, this.submission));
  }

  async isIntentUsed(): Promise<boolean> {
    return v1IsIntentUsed(
      getAddress(this.plan_.vaultAddress),
      this.plan_.payoutIntentHash,
      this.campaign.chainId,
    );
  }

  async findOutcomeByIntent(): Promise<NormalizedOutcome | null> {
    const tx = await findSettleTxByIntent(
      getAddress(this.plan_.vaultAddress),
      this.plan_.payoutIntentHash,
      this.campaign.chainId,
    );
    if (!tx) return null;
    // V1 does not decode the settle event; the intent WAS consumed on-chain, so the
    // outcome is the plan's own recipient/amount at the found tx (matches prior behavior).
    return {
      status: "settled",
      vaultKind: "policy_v1",
      commitmentVersion: 1,
      chainId: this.plan_.chainId,
      vault: getAddress(this.plan_.vaultAddress),
      intentHash: this.plan_.payoutIntentHash,
      txHash: tx,
      blockNumber: null,
      recipient: getAddress(this.plan_.recipient),
      amountBase: this.plan_.amountBase,
      failedCheckIndex: null,
      missionIdHash: null,
      decisionDigest: this.plan_.decisionDigest,
      explorerUrl: explorerTxUrl(this.plan_.chainId, tx),
      reason: null,
      needsOwnerAdd: false,
      vendorAdded: false,
      vendorTxHash: null,
    };
  }
}

/* ─────────────────────────────────────────── V2 (CampaignVault) strategy ── */

/**
 * Settles a mission-bound payout to a previously-unknown tester. It NEVER allowlists
 * a recipient and NEVER supplies an amount — the vault derives the exact reward from
 * the immutable mission. Before any broadcast it re-checks that the DB agrees with the
 * on-chain plan (invariant: HOLD before broadcast). Recovered events are decoded by
 * the adapter and integrity-checked by the orchestration before they can settle.
 */
export class CampaignVaultV2Strategy implements VaultStrategy {
  readonly vaultKind: VaultKind = "campaign_v2";
  readonly commitmentVersion = 2;
  private readonly plan_: SettlementPlan;

  constructor(
    private readonly campaign: Campaign,
    private readonly submission: Submission,
    private readonly decision: Decision,
    private readonly mission: Mission,
    private readonly allMissions: Mission[],
    private readonly adapter: CampaignVaultAdapter,
    private readonly operatorFor: (chainId: number) => Address,
  ) {
    const brief = decision.brief;
    const { decisionDigest, payoutIntentHash } = computeDecisionCommitmentV2({
      chainId: campaign.chainId,
      vault: campaign.vaultAddress,
      campaignIdHash: campaign.campaignIdHash as Hex,
      missionPlanDigest: campaign.missionPlanDigest as Hex,
      missionIdHash: mission.missionIdHash as Hex,
      submissionId: submission.id,
      decisionId: decision.id,
      recipient: submission.wallet,
      // the EXACT on-chain mission reward — never operator- or AI-chosen.
      rewardBase: BigInt(mission.rewardAmount),
      evidenceSha256: decision.contentSha256,
      criteria: brief.criteria,
      fraudSignals: brief.fraudSignals,
      recommendation: brief.recommendation,
      reasonCode: brief.reasonCode,
      confidence: brief.confidence,
      model: decision.model,
      provider: brief.provider,
    });
    this.plan_ = {
      vaultKind: "campaign_v2",
      commitmentVersion: 2,
      payoutIntentHash,
      decisionDigest,
      submissionId: submission.id,
      campaignId: campaign.id,
      chainId: campaign.chainId,
      vaultAddress: campaign.vaultAddress,
      recipient: submission.wallet,
      amountBase: mission.rewardAmount,
      missionIdHash: mission.missionIdHash as Hash,
    };
  }

  plan(): SettlementPlan {
    return this.plan_;
  }

  /** HOLD before broadcast: the deployed vault must enforce exactly what the DB claims. */
  private async assertAgrees(): Promise<void> {
    const missionIds = this.allMissions.map((m) => m.missionIdHash as Hash);
    const snapshot = await this.adapter.readSnapshot(
      getAddress(this.campaign.vaultAddress),
      this.campaign.chainId,
      missionIds,
    );
    const result = evaluateCampaignAgreement(
      this.campaign,
      this.allMissions,
      snapshot,
      this.operatorFor,
    );
    if (!result.ok) {
      throw new VaultAgreementError(
        this.plan_.payoutIntentHash,
        result.mismatches.map((m) => m.field),
      );
    }
  }

  private normalize(o: CampaignPayoutOutcome): NormalizedOutcome {
    const settled = o.status === "settled";
    return {
      status: o.status,
      vaultKind: "campaign_v2",
      commitmentVersion: 2,
      chainId: o.chainId,
      vault: o.vault,
      intentHash: o.intentHash,
      txHash: o.txHash,
      blockNumber: o.blockNumber,
      recipient: o.recipient,
      amountBase: o.amountBase,
      failedCheckIndex: settled ? null : o.failedCheckIndex,
      missionIdHash: o.missionId,
      decisionDigest: o.decisionDigest,
      explorerUrl: o.explorerUrl,
      reason: settled ? null : campaignFailedCheckReason(o.failedCheckIndex),
      needsOwnerAdd: false,
      vendorAdded: false,
      vendorTxHash: null,
    };
  }

  /** Resolve this intent's canonical on-chain outcome (settled wins over replay rejection). */
  private async resolveIntentOnChain(): Promise<BroadcastReconciliation> {
    const outcomes = await this.adapter.findAllOutcomesByIntent(
      getAddress(this.campaign.vaultAddress),
      this.plan_.payoutIntentHash,
      this.campaign.chainId,
    );
    const r = resolveCanonicalOutcome(outcomes);
    switch (r.kind) {
      case "settled":
        return { kind: "settled", outcome: this.normalize(r.outcome) };
      case "rejected":
        return { kind: "rejected", outcome: this.normalize(r.outcome) };
      case "duplicate_settlement":
        // Two settlements for one intent violates the vault's replay guard — critical.
        throw new SettlementIntegrityError(this.plan_.payoutIntentHash, ["duplicate_settlement"]);
      case "replay_no_settlement":
        // A replay rejection means a settlement EXISTS but we did not surface it — never
        // treat the rejection as terminal (never conceal a settled tx).
        return {
          kind: "hold",
          reason: "intent replayed on-chain but its settlement was not found — holding for reconciliation",
        };
      case "none":
        return { kind: "resend" };
    }
  }

  async broadcast(hooks: BroadcastHooks): Promise<NormalizedOutcome> {
    // Structural HOLD: never send requestPayout unless the DB agrees with the chain.
    await this.assertAgrees();
    // Phase-2 replay pre-flight: if THIS intent is already used on-chain, never
    // broadcast — reconcile the canonical outcome, or HOLD if it can't be trusted.
    if (await this.isIntentUsed()) {
      const res = await this.resolveIntentOnChain();
      if (res.kind === "settled" || res.kind === "rejected") return res.outcome;
      throw new AmbiguousBroadcastError(
        this.plan_.payoutIntentHash,
        "intent already used on-chain but no trustworthy outcome was found",
      );
    }
    const o = await this.adapter.requestPayout({
      vault: getAddress(this.campaign.vaultAddress),
      missionId: this.plan_.missionIdHash as Hash,
      recipient: getAddress(this.submission.wallet),
      decisionDigest: this.plan_.decisionDigest as Hash,
      intentHash: this.plan_.payoutIntentHash,
      chainId: this.campaign.chainId,
      // persist the broadcast identity BEFORE submission (the crash-window fix) ...
      onPreflight: hooks.onPreflight,
      // ... then persist the hash the instant it is submitted.
      onBroadcast: hooks.onBroadcast,
    });
    return this.normalize(o);
  }

  async reconcileBroadcasting(attempt: SettlementAttempt): Promise<BroadcastReconciliation> {
    const res = await this.resolveIntentOnChain();
    if (res.kind !== "resend") return res; // settled / rejected / hold
    // No on-chain outcome for this intent. Only re-broadcast if the reserved nonce is
    // PROVABLY unused (no tx was accepted); a consumed nonce ⟺ a tx is/was in flight.
    if (attempt.broadcastNonce == null || !attempt.senderAddress) {
      return {
        kind: "hold",
        reason: "ambiguous broadcast without a reserved nonce — holding for operator reconciliation",
      };
    }
    const sender = getAddress(attempt.senderAddress);
    const [pending, latest] = await Promise.all([
      this.adapter.getSenderNonce(sender, this.campaign.chainId, "pending"),
      this.adapter.getSenderNonce(sender, this.campaign.chainId, "latest"),
    ]);
    if (pending <= attempt.broadcastNonce && latest <= attempt.broadcastNonce) {
      return { kind: "resend" }; // nonce unused → no tx was accepted → safe to broadcast
    }
    return {
      kind: "hold",
      reason: "a transaction consumed the reserved nonce but no matching settlement was found — holding for reconciliation",
    };
  }

  async awaitOutcome(txHash: Hash): Promise<NormalizedOutcome> {
    const o = await this.adapter.awaitOutcome(
      txHash,
      this.campaign.chainId,
      getAddress(this.campaign.vaultAddress),
    );
    return this.normalize(o);
  }

  async isIntentUsed(): Promise<boolean> {
    return this.adapter.isIntentUsed(
      getAddress(this.campaign.vaultAddress),
      this.plan_.payoutIntentHash,
      this.campaign.chainId,
    );
  }

  async findOutcomeByIntent(): Promise<NormalizedOutcome | null> {
    const res = await this.resolveIntentOnChain();
    return res.kind === "settled" ? res.outcome : null;
  }
}

/* ───────────────────────────────────────────────────── strategy select ──── */

/**
 * Choose the settlement strategy for a campaign — EXHAUSTIVELY over the campaign's
 * PERSISTED `vaultKind`. The kind is never inferred from chain probing or a revert;
 * an unknown kind fails closed (throws). For campaign_v2, the mission the submission
 * targets must exist and belong to the campaign, and the campaign must carry its
 * on-chain identity — else settlement is refused (never fabricated).
 */
export function selectVaultStrategy(
  campaign: Campaign,
  submission: Submission,
  decision: Decision | null,
  deps: VaultStrategyDeps = {},
): VaultStrategy {
  switch (campaign.vaultKind) {
    case "policy_v1":
      return new PolicyVaultV1Strategy(campaign, submission, decision);
    case "campaign_v2": {
      if (!decision) {
        throw new Error(
          `campaign_v2 ${campaign.id} requires a Deputy decision before settlement`,
        );
      }
      if (!submission.missionIdHash) {
        throw new Error(
          `submission ${submission.id} has no mission — cannot settle on campaign_v2 ${campaign.id}`,
        );
      }
      if (!campaign.campaignIdHash || !campaign.missionPlanDigest) {
        throw new Error(
          `campaign_v2 ${campaign.id} is missing its on-chain identity — refusing to settle`,
        );
      }
      const mission = getMissionByHash(campaign.id, submission.missionIdHash);
      if (!mission) {
        throw new Error(
          `mission ${submission.missionIdHash} not found on campaign ${campaign.id} — refusing to settle`,
        );
      }
      const allMissions = listMissions(campaign.id);
      const adapter = deps.campaignAdapter ?? realCampaignVaultAdapter;
      const operatorFor = deps.operatorAddress ?? operatorAddress;
      return new CampaignVaultV2Strategy(
        campaign,
        submission,
        decision,
        mission,
        allMissions,
        adapter,
        operatorFor,
      );
    }
    default: {
      const _exhaustive: never = campaign.vaultKind;
      void _exhaustive;
      throw new Error(
        `unknown vault kind '${String(campaign.vaultKind)}' for campaign ${campaign.id} — refusing to settle`,
      );
    }
  }
}

/* ─────────────────────────────────────────── outcome + integrity helpers ── */

/** NormalizedOutcome → the public SettleOutcome (byte-identical to V1 for V1). */
export function toSettleOutcome(n: NormalizedOutcome, plan: SettlementPlan): SettleOutcome {
  const settled = n.status === "settled";
  return {
    settled,
    txHash: n.txHash,
    explorerUrl: n.explorerUrl ?? (n.txHash ? explorerTxUrl(plan.chainId, n.txHash) : null),
    failedCheckIndex: settled ? null : n.failedCheckIndex,
    reason: settled ? null : n.reason,
    needsOwnerAdd: n.needsOwnerAdd,
    vendorAdded: n.vendorAdded,
    vendorTxHash: n.vendorTxHash,
    recipient: getAddress(n.recipient ?? plan.recipient),
    amountBase: n.amountBase ?? plan.amountBase,
  };
}

/** The recorded outcome for a completed attempt — V2 rows get the V2 reason map. */
function settleOutcomeFromRecord(attempt: SettlementAttempt): SettleOutcome {
  const base = outcomeFromAttempt(attempt);
  if (attempt.vaultKind === "campaign_v2" && !base.settled) {
    return { ...base, reason: campaignFailedCheckReason(attempt.failedCheckIndex) };
  }
  return base;
}

/**
 * Defensive: a found durable attempt must describe the SAME payout as the current
 * plan. The intent hash commits to chain + vault (+ mission for V2), so a
 * disagreement signals a hash collision or a bug — refuse rather than settle against
 * a mismatched record. Preserves the V1 chain/vault guard and adds V2 identity.
 */
function assertAttemptMatchesPlan(
  attempt: SettlementAttempt | null,
  plan: SettlementPlan,
): void {
  if (!attempt) return;
  const bad: string[] = [];
  if (attempt.chainId !== plan.chainId) bad.push("chain_id");
  if (attempt.vaultAddress.toLowerCase() !== plan.vaultAddress.toLowerCase()) bad.push("vault");
  if (attempt.vaultKind !== plan.vaultKind) bad.push("vault_kind");
  if ((attempt.commitmentVersion ?? 1) !== plan.commitmentVersion) bad.push("commitment_version");
  if (!eqHex(attempt.missionIdHash, plan.missionIdHash)) bad.push("mission");
  if (bad.length) {
    throw new Error(
      `settlement attempt ${plan.payoutIntentHash} disagrees with plan (${bad.join(", ")}) — refusing to settle`,
    );
  }
}

/**
 * Integrity gate for a recovered / freshly-decoded on-chain event: for V2 it must
 * match the durable plan on vault, chain, intent, mission, recipient, decision
 * commitment, kind, version — and, when it claims to have settled, the EXACT reward.
 * Any disagreement is an integrity error (never a settlement). V1 keeps its existing
 * guarantees (no per-event decode), so this is a no-op for V1.
 */
function assertRecoveredMatchesPlan(n: NormalizedOutcome, plan: SettlementPlan): void {
  if (plan.vaultKind !== "campaign_v2") return;
  const bad: string[] = [];
  if (n.vaultKind !== "campaign_v2") bad.push("vault_kind");
  if (n.commitmentVersion !== 2) bad.push("commitment_version");
  if (n.chainId !== plan.chainId) bad.push("chain_id");
  if (!n.vault || getAddress(n.vault) !== getAddress(plan.vaultAddress)) bad.push("vault");
  if (!eqHex(n.intentHash, plan.payoutIntentHash)) bad.push("intent");
  if (!eqHex(n.missionIdHash, plan.missionIdHash)) bad.push("mission");
  if (!n.recipient || getAddress(n.recipient) !== getAddress(plan.recipient)) bad.push("recipient");
  if (!eqHex(n.decisionDigest, plan.decisionDigest)) bad.push("decision_digest");
  if (n.status === "settled" && n.amountBase !== plan.amountBase) bad.push("reward");
  if (bad.length) throw new SettlementIntegrityError(plan.payoutIntentHash, bad);
}

/** Persist a resumed (awaited) outcome — settled or rejected — from its tx. */
function persistNormalized(intentHash: Hash, n: NormalizedOutcome): void {
  if (n.status === "settled" && n.txHash) markSettled(intentHash, n.txHash);
  else if (n.status === "rejected" && n.txHash) {
    markRejected(intentHash, n.txHash, n.failedCheckIndex);
  }
}

/* ──────────────────────────────── the durable, crash-safe orchestration ──── */

/**
 * Settle one approved submission through a chosen strategy, crash-recoverably. This
 * is the ONE settlement orchestration for both vault kinds. It:
 *   1. records ONE durable attempt per intent (writing the tx hash the instant it
 *      is broadcast), and
 *   2. RESUMES from the persisted attempt instead of ever blind-resending — reading
 *      a prior tx's receipt, or verifying the intent on-chain before any resend.
 * For V2 it additionally integrity-checks every recovered event before it can mark a
 * submission paid, so a mismatched event is a loud error, never a false settlement.
 */
export async function settleWithRecoveryVia(strategy: VaultStrategy): Promise<SettleOutcome> {
  const plan = strategy.plan();

  prepareAttempt({
    payoutIntentHash: plan.payoutIntentHash,
    decisionDigest: plan.decisionDigest,
    submissionId: plan.submissionId,
    campaignId: plan.campaignId,
    chainId: plan.chainId,
    vaultAddress: plan.vaultAddress,
    recipient: plan.recipient,
    amountBase: plan.amountBase,
    commitmentVersion: plan.commitmentVersion,
    missionIdHash: plan.missionIdHash,
    vaultKind: plan.vaultKind,
  });

  const attempt = getAttempt(plan.payoutIntentHash);
  assertAttemptMatchesPlan(attempt, plan);
  const resume = planResume(attempt);

  // Already completed on record → return the recorded outcome, never re-pay.
  if ((resume.kind === "settled" || resume.kind === "rejected") && attempt) {
    return settleOutcomeFromRecord(attempt);
  }

  // A prior attempt broadcast a tx whose outcome we never persisted → read that tx's
  // receipt; NEVER re-send. Integrity-check the recovered event before trusting it.
  if (resume.kind === "await") {
    try {
      const n = await strategy.awaitOutcome(resume.txHash);
      assertRecoveredMatchesPlan(n, plan);
      persistNormalized(plan.payoutIntentHash, n);
      return toSettleOutcome(n, plan);
    } catch (err) {
      markFailed(plan.payoutIntentHash, errMsg(err));
      throw err;
    }
  }

  // AMBIGUOUS broadcast (a tx MAY be in flight) → reconcile from the chain; NEVER
  // blind-resend. Only re-broadcast when the strategy PROVES no tx was accepted.
  if (resume.kind === "reconcile_broadcast" && attempt) {
    const res = await strategy.reconcileBroadcasting(attempt);
    if (res.kind === "settled") {
      assertRecoveredMatchesPlan(res.outcome, plan);
      if (res.outcome.txHash) markSettled(plan.payoutIntentHash, res.outcome.txHash);
      const row = getAttempt(plan.payoutIntentHash);
      return row ? settleOutcomeFromRecord(row) : toSettleOutcome(res.outcome, plan);
    }
    if (res.kind === "rejected") {
      if (res.outcome.txHash) {
        markRejected(plan.payoutIntentHash, res.outcome.txHash, res.outcome.failedCheckIndex);
      }
      const row = getAttempt(plan.payoutIntentHash);
      return row ? settleOutcomeFromRecord(row) : toSettleOutcome(res.outcome, plan);
    }
    if (res.kind === "hold") {
      // A tx may be pending / a settlement may be concealed → HOLD, never resend.
      throw new AmbiguousBroadcastError(plan.payoutIntentHash, res.reason);
    }
    // res.kind === "resend" → provably no tx was accepted → fall through to broadcast.
  }

  // Anomalous/errored → check the chain BEFORE any resend. If the intent already
  // settled, reconcile from the chain (integrity-checked); else fall through.
  if (resume.kind === "verify") {
    const used = await strategy.isIntentUsed().catch(() => false);
    if (used) {
      const n = await strategy.findOutcomeByIntent();
      if (!n) {
        throw new Error(
          `intent ${plan.payoutIntentHash} is used on-chain but its settle tx was not found — holding for reconciliation`,
        );
      }
      assertRecoveredMatchesPlan(n, plan);
      if (n.txHash) markSettled(plan.payoutIntentHash, n.txHash);
      const row = getAttempt(plan.payoutIntentHash);
      if (row) return settleOutcomeFromRecord(row);
    }
    // not used (or just reconciled) — safe to broadcast fresh (fall through).
  }

  // Fresh broadcast. `onPreflight` persists the broadcast IDENTITY (sender/nonce/
  // calldata) BEFORE submission; `onBroadcast` persists the tx hash the instant it is
  // sent. A crash in between leaves an ambiguous `broadcasting` attempt (above).
  try {
    const n = await strategy.broadcast({
      onPreflight: (meta) =>
        markBroadcasting(plan.payoutIntentHash, {
          senderAddress: meta.sender,
          nonce: meta.nonce,
          calldataHash: meta.calldataHash,
        }),
      onBroadcast: (h) => markBroadcast(plan.payoutIntentHash, h),
    });
    // A settled/rejected on-chain result is decoded — integrity-check it (V2) before
    // it advances the attempt. A no-tx result (V1 needs-owner-add) leaves it prepared.
    if (n.status === "settled" || n.status === "rejected") assertRecoveredMatchesPlan(n, plan);
    if (n.txHash) {
      if (n.status === "settled") markSettled(plan.payoutIntentHash, n.txHash);
      else if (n.status === "rejected") {
        markRejected(plan.payoutIntentHash, n.txHash, n.failedCheckIndex);
      }
    }
    return toSettleOutcome(n, plan);
  } catch (err) {
    // If we already entered `broadcasting` (identity persisted, a tx MAY be in flight),
    // do NOT overwrite that ambiguous marker — recovery must reconcile it, not resend.
    const cur = getAttempt(plan.payoutIntentHash);
    if (cur?.status !== "broadcasting") markFailed(plan.payoutIntentHash, errMsg(err));
    throw err;
  }
}

/**
 * The durable, vault-agnostic settlement entry point. Selects the strategy from the
 * campaign's persisted vault kind, then settles crash-recoverably. Sandbox campaigns
 * can NEVER settle — this throws for them (payment is structurally unreachable).
 */
export async function settleWithRecovery(
  campaign: Campaign,
  submission: Submission,
  deps: VaultStrategyDeps = {},
): Promise<SettleOutcome> {
  if (campaign.sandbox) {
    throw new Error(
      `refusing to settle sandbox campaign ${campaign.id} — payment is structurally disabled`,
    );
  }
  const decision = getDecisionBySubmission(submission.id);
  const strategy = selectVaultStrategy(campaign, submission, decision, deps);
  return settleWithRecoveryVia(strategy);
}
