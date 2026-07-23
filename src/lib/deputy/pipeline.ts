import "server-only";

import { getAddress } from "viem";
import { short, usd } from "@/lib/format";
import { encodeDetail } from "@/lib/campaigns/journal";
import type { Campaign, Submission } from "@/lib/db/schema";
import {
  casSubmissionStatus,
  countPaidByWalletInCampaign,
  getCampaign,
  getDecisionBySubmission,
  getSubmission,
  listEarlierSubmissionsForDedup,
  listPaidSubmissionsForDedup,
  listSubmissionsForDedup,
  recordEvent,
  recordEventOnce,
  setObservationShadow,
  updateSubmission,
} from "@/lib/db/campaigns";
import { findDuplicate, findNearDuplicate } from "./dedup";
import { observationAutopayEnabled, runObservationDecision, toObservationShadow } from "./observation-judge";
import { obsJudgeV2Mode, observationV2Shadow } from "./observation-judge-v2";
import { OBS_MAX_ATTEMPTS, type PrivateKey } from "./observation-verify";
import { observationRetryLine, reasonSentence } from "./reason-copy";
import { getVaultState, isVendorApproved } from "@/lib/deputy/chain";
import {
  replayHoldReason,
  requiresReplayProtection,
  supportsIntentReplayProtection,
} from "@/lib/deputy/vault-capability";
import { settleApprovedSubmission } from "@/lib/campaigns/settle-flow";
import {
  evaluateCampaignAgreement,
  type VaultStrategyDeps,
} from "@/lib/campaigns/vault-strategy";
import { realCampaignVaultAdapter } from "@/lib/deputy/campaign-vault";
import { getMissionByHash, listMissions } from "@/lib/db/campaigns";
import {
  identityMismatchSummary,
  missionToIdentity,
  verifyPublicIdentity,
} from "@/lib/campaigns/public-identity";
import { operatorAddress } from "@/lib/deputy/signer";
import { ensureDecision } from "./decisions";
import { gateFromBrief } from "./autopilot";
import { payoutActionReplayMode, runPayoutActionReplay } from "./payout-replay";
import { dbReplayJournal } from "@/lib/db/payout-replay-journal";
import { payoutReplaySchemaReady } from "./canary-preflight";
import { judgeIdentityGate, MODEL_POLICY_VERSION } from "./model-policy";
import { entailmentMode, entailmentInputFromBrief, runEntailmentVeto } from "./entailment";
import { notifyFounderHeld } from "@/lib/telegram/founder-notify";
import { notifyTelegram } from "./notify";
import { mainnetAutopilotEnabled } from "@/lib/env";
import { agentLog, newCorrelationId } from "./agent-log";

/**
 * The autonomy pipeline. `runDeputyOnSubmission` is the ONE place the Deputy
 * decides to act on its own — and it acts only inside a mandate the human already
 * confirmed. It never signs governance: on a founder vault where the recipient
 * isn't allowlisted it HOLDS for the owner's signature. Every payout is a real
 * `requestSpend` the vault can still reject; the pre-flight is a courtesy so we
 * don't burn a tx we can predict will fail, but the vault is the enforcement.
 *
 * It never throws for control flow and never retry-loops a spend: any failure
 * resets the submission to pending for human review. Every run carries one
 * correlationId (see agent-log.ts) threaded through decision → gate → preflight →
 * cas → settle → journal, so a single run is greppable end-to-end.
 */

export type PipelineAction = "skipped" | "held" | "settled";

export interface PipelineResult {
  action: PipelineAction;
  reason: string;
  txHash?: string | null;
  /** the correlation id for this run — lets callers thread it into their logs. */
  correlationId?: string;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
}

/**
 * Courtesy pre-flight against live vault state. A pass here is not a guarantee —
 * a race can still produce a real on-chain SpendRejected, which we surface
 * honestly — it just avoids a tx we can already see will fail. An UNREADABLE
 * vault (RPC failure) holds rather than proceeds: we won't fire a settle we
 * couldn't pre-check, and the submission stays pending so the next sweep retries
 * once the RPC recovers (self-healing, no lost work).
 */
async function preflight(
  campaign: Campaign,
  submission: Submission,
): Promise<{ ok: boolean; reason: string }> {
  const amount = campaign.rewardAmount / 1_000_000; // whole USDC
  const vault = getAddress(campaign.vaultAddress);

  let state;
  try {
    state = await getVaultState(vault, campaign.chainId);
  } catch {
    return {
      ok: false,
      reason: "vault state temporarily unreadable — held for review",
    };
  }
  if (state.status !== "active") return { ok: false, reason: "the vault is not active" };
  if (state.remaining < amount) return { ok: false, reason: "not enough remaining budget" };
  if (state.perTxCap < amount) return { ok: false, reason: "amount exceeds the per-payout cap" };
  if (state.velocityCap < amount) return { ok: false, reason: "amount exceeds the 24h velocity cap" };

  // REAL-MONEY REPLAY SAFETY: on a mainnet chain, the Deputy auto-pays only from a
  // vault that enforces on-chain intent replay protection (check 7 / isIntentUsed).
  // A CONFIRMED legacy vault holds with an explicit reason; an UNREADABLE
  // capability also holds (an RPC failure is not proof the vault is safe). Manual
  // approval remains available. Testnet vaults are exempt (test USDC).
  if (requiresReplayProtection(campaign.chainId)) {
    const support = await supportsIntentReplayProtection(vault, campaign.chainId);
    const hold = replayHoldReason(support);
    if (hold) return { ok: false, reason: hold };
  }

  // A founder vault where the recipient isn't allowlisted needs the OWNER's
  // signature — the Deputy never signs governance. Hold for it.
  if (!campaign.ownerIsSage) {
    const approved = await isVendorApproved(
      vault,
      getAddress(submission.wallet),
      campaign.chainId,
    ).catch(
      () => true, // can't read → don't block on the courtesy; let settle surface it
    );
    if (!approved) return { ok: false, reason: "awaiting owner allowlist signature" };
  }
  return { ok: true, reason: "" };
}

/**
 * V2 (CampaignVault) pre-flight. The SAFETY-critical step is the DB↔chain agreement:
 * before any signing, the deployed vault must enforce EXACTLY the mission plan the
 * DB claims (owner, operator, campaign id, plan digest, budget, token, lifecycle,
 * replay protection, and each mission's reward + cap). Any mismatch HOLDS — the
 * mismatched fields are surfaced, never silently reconciled. The remaining checks
 * (lifecycle, budget, mission completions, recipient-already-paid) are a courtesy;
 * the vault soft-rejects them regardless. NB: NO recipient allowlisting — V2 pays a
 * previously-unknown tester bounded to the approved mission.
 */
async function preflightV2(
  campaign: Campaign,
  submission: Submission,
  deps: VaultStrategyDeps,
): Promise<{ ok: boolean; reason: string }> {
  if (!submission.missionIdHash) {
    return { ok: false, reason: "submission has no mission — held for review" };
  }
  const mission = getMissionByHash(campaign.id, submission.missionIdHash);
  if (!mission) {
    return { ok: false, reason: "mission not found for this submission — held for review" };
  }
  const adapter = deps.campaignAdapter ?? realCampaignVaultAdapter;
  const operatorFor = deps.operatorAddress ?? operatorAddress;
  const vault = getAddress(campaign.vaultAddress);
  const allMissions = listMissions(campaign.id);
  const missionIds = allMissions.map((m) => m.missionIdHash as `0x${string}`);

  let snapshot;
  try {
    snapshot = await adapter.readSnapshot(vault, campaign.chainId, missionIds);
  } catch {
    return { ok: false, reason: "vault state temporarily unreadable — held for review" };
  }

  // PUBLIC-IDENTITY INVARIANT (pre-broadcast): re-derive campaignIdHash / missionIdHash /
  // MissionSpecV1 digest / missionPlanDigest from the PUBLIC ids and compare against the
  // stored AND on-chain values. This never trusts a stored hash merely because it matches
  // the chain; a public id that disagrees with the committed identity HOLDS before any CAS
  // or signing. (The decision path also holds pre-LLM; this is the defense-in-depth gate a
  // pre-existing decision can't bypass.)
  const identity = verifyPublicIdentity({
    publicCampaignId: campaign.id,
    storedCampaignIdHash: campaign.campaignIdHash,
    storedMissionPlanDigest: campaign.missionPlanDigest,
    missions: allMissions.map(missionToIdentity),
    submission: {
      missionIdHash: submission.missionIdHash,
      missionSpecDigest: submission.missionSpecDigest,
    },
    onchain: { campaignIdHash: snapshot.campaignIdHash, missionPlanDigest: snapshot.missionPlanDigest },
  });
  if (!identity.ok) {
    return {
      ok: false,
      reason: `public identity mismatch (${identityMismatchSummary(identity)}) — held`,
    };
  }

  // THE gate: the vault must enforce exactly the DB's plan.
  const agreement = evaluateCampaignAgreement(campaign, allMissions, snapshot, operatorFor);
  if (!agreement.ok) {
    return {
      ok: false,
      reason: `vault configuration disagrees with the campaign plan (${agreement.mismatches
        .map((m) => m.field)
        .join(", ")}) — held`,
    };
  }

  // Courtesy readiness (the vault soft-rejects these anyway).
  let readiness;
  try {
    readiness = await adapter.readMissionReadiness(
      vault,
      campaign.chainId,
      mission.missionIdHash as `0x${string}`,
      getAddress(submission.wallet),
    );
  } catch {
    return { ok: false, reason: "vault state temporarily unreadable — held for review" };
  }
  if (readiness.state !== "active") return { ok: false, reason: "the vault is not active" };
  if (readiness.recipientCompleted) {
    return { ok: false, reason: "this recipient has already been paid for this mission" };
  }
  if (readiness.missionRemaining <= 0) {
    return { ok: false, reason: "this mission has no remaining completions" };
  }
  if (readiness.budgetRemainingBase < mission.rewardAmount) {
    return { ok: false, reason: "not enough remaining budget" };
  }
  // Velocity: the exact mission reward must fit inside the vault's REMAINING 24h
  // velocity (cap − rolling spend), using the contract's own numbers. Insufficient
  // velocity HOLDS before signing (the vault would soft-reject check 10 anyway).
  const velocityRemaining = readiness.velocityCapBase - readiness.rollingSpendBase;
  if (velocityRemaining < mission.rewardAmount) {
    return { ok: false, reason: "amount exceeds the remaining 24h velocity cap" };
  }
  return { ok: true, reason: "" };
}

function journalHeld(
  campaign: Campaign,
  submission: Submission,
  reason: string,
  cid?: string,
): void {
  recordEvent({
    campaignId: campaign.id,
    submissionId: submission.id,
    kind: "autopay_held",
    detail: encodeDetail(`${short(submission.wallet)} · ${reason}`, { cid }),
  });
  void notifyTelegram(
    `⏸️ <b>Held by Deputy</b>\n${campaign.title}\n${usd(campaign.rewardAmount / 1_000_000)} → ${short(submission.wallet)}\n${reason}\n${appUrl()}/app`,
  );
}

export async function runDeputyOnSubmission(
  submissionId: string,
  deps: VaultStrategyDeps = {},
): Promise<PipelineResult> {
  const cid = newCorrelationId();

  // a. load submission + campaign + decision (compute via brain if missing)
  const submission = getSubmission(submissionId);
  if (!submission) return { action: "skipped", reason: "no submission", correlationId: cid };
  const campaign = getCampaign(submission.campaignId);
  if (!campaign) return { action: "skipped", reason: "no campaign", correlationId: cid };
  // HARD SANDBOX: the public jailbreak box can never move money — bail before any
  // decision/gate/CAS/settle path. settleSubmission also throws as a structural
  // backstop, so payment is unreachable even if this guard were ever removed.
  if (campaign.sandbox) {
    return {
      action: "skipped",
      reason: "sandbox — payment structurally disabled",
      correlationId: cid,
    };
  }
  agentLog(cid, "start", {
    submissionId,
    campaignId: campaign.id,
    autonomy: campaign.autonomy,
    status: submission.status,
  });

  // PAYOUT-REPLAY PREFLIGHT — canary AND shadow REQUIRE the migration-0026/0027 schema (shadow reads/writes the
  // journal too). If it is missing, REFUSE before any decision/gate/CAS/settle (fail closed), never after a PAY.
  if (payoutActionReplayMode() !== "off" && !payoutReplaySchemaReady().ok) {
    const reason = "action_replay_preflight_failed:missing_schema";
    agentLog(cid, "payout_replay_preflight", { ok: false, missing: payoutReplaySchemaReady().missing });
    if (campaign.autonomy === "autopilot" && submission.status === "pending") {
      journalHeld(campaign, submission, reason, cid);
      return { action: "held", reason, correlationId: cid };
    }
    return { action: "skipped", reason, correlationId: cid };
  }

  const brief = await ensureDecision(submissionId, { cid }).catch(() => null);
  if (!brief) {
    agentLog(cid, "decision", { ok: false });
    return { action: "skipped", reason: "no decision", correlationId: cid };
  }
  const decisionRow = getDecisionBySubmission(submissionId);
  agentLog(cid, "decision", {
    engine: brief.engine,
    recommendation: brief.recommendation,
    confidence: brief.confidence,
  });

  // b0. P16 — observation-based missions are judged against Sage's OWN pinned private corpus, NOT the
  // url-verifiable brain. They are decided HERE, BEFORE the url-lane gate: a lived experience is
  // legitimately absent from a static re-fetch, so the brain's `evidence_mismatch` is a FALSE fraud
  // signal that must never pre-empt the observation judge (the bug this ordering fixes). Compute the
  // full observation decision (deterministic corpus match + injection + near-dup + the conditional LLM
  // judge), persist the SHADOW (would-have-autopaid) for calibration, and RELEASE only if
  // OBSERVATION_AUTOPAY is armed AND the whole bar passes. Default (flag off, or any failure): HOLD.
  // url-verifiable missions skip this block entirely and hit the gate below, byte-identical to before.
  const mission = submission.missionIdHash
    ? getMissionByHash(campaign.id, submission.missionIdHash)
    : null;
  const isObservation = mission?.verifiabilityClass === "observation-based";
  if (isObservation && mission) {
    const key: PrivateKey = {
      observations: campaign.privateCorpus ?? [],
      distinctSources: campaign.privateCorpusSources,
      digest: campaign.privateCorpusDigest ?? "0x0",
    };
    // Only a REAL injection counts as fraud here — "prompt injection" is the frozen detector's
    // constant (brain-core detectInjection). The url-lane reason codes (evidence_mismatch/no_evidence)
    // are meaningless for an account judged against the corpus, so they must NOT block; the
    // observation judge re-detects injection independently regardless.
    const hasHighFraud = brief.fraudSignals.some(
      (f) => f.severity === "high" && f.signal === "prompt injection",
    );
    // The PUBLIC card surface a tester could parrot — the same mission prose distill excluded from the
    // key. A corroboration's lexical anchor must be a NON-public token, so parrot-zero stays structural
    // in the recall path (the product name / card verbs can never anchor a "match").
    const publicStrings = [
      mission.title,
      mission.objective,
      mission.instructions,
      mission.targetSurface,
      ...(mission.criteria ?? []),
      ...(mission.evidenceList ?? []),
      ...(mission.evidenceRequirements ? [mission.evidenceRequirements] : []),
      mission.descriptionMd,
    ].filter((s): s is string => typeof s === "string" && s.length > 0);
    const decision = await runObservationDecision({
      account: submission.note,
      key,
      // CAUSAL priors (2b): only submissions that existed BEFORE this one, so a later copy can never
      // retroactively flag this genuine account as a near-dup on a re-sweep.
      priors: listEarlierSubmissionsForDedup(campaign.id, submissionId, submission.createdAt),
      missionObjective: mission.objective,
      criteria: mission.criteria,
      publicStrings,
      hasHighFraud,
      // The corroboration recall path needs a STRONG judge to bridge the vision↔experience vocabulary
      // gap (a weak model finds only the near-lexical matches — measured). OBS_JUDGE_MODEL routes just the
      // observation judge to it; unset → falls back to the default judge model (weaker recall → genuine
      // work holds for the founder, the SAFE degradation, never a wrong pay).
      model: process.env.OBS_JUDGE_MODEL || undefined,
    }).catch(() => null);
    const autopay = !!decision && observationAutopayEnabled() && decision.bar.pass;
    if (decision) {
      const shadow = toObservationShadow(decision, autopay, Math.floor(Date.now() / 1000)) as unknown as Record<string, unknown>;
      // OBS JUDGE V2 SHADOW — an action/state-grounded verdict on the SAME submission (reconstructed from
      // the existing private corpus), compared to the legacy bar. Off by default; it NEVER affects `autopay`
      // or settlement — it only adds a leak-safe telemetry key to the shadow journal.
      if (obsJudgeV2Mode() === "shadow") {
        const v2 = observationV2Shadow(submission.note, campaign.privateCorpus, decision.bar.pass);
        shadow.v2 = v2;
        agentLog(cid, "observation_v2", { disagreement: v2.disagreement, v2Pass: v2.v2Pass, legacyPass: v2.legacyPass, stateSpecific: v2.stateSpecificMatches });
      }
      setObservationShadow(submissionId, shadow);
    }
    agentLog(cid, "observation", {
      barPass: decision?.bar.pass ?? false,
      distinct: decision?.publicView.distinctSources ?? 0,
      reasons: decision?.bar.reasons ?? ["no_decision"],
      autopay,
    });
    if (!autopay) {
      // P20 — a hold is RETRYABLE only when the work FELL SHORT of the bar but looks honest and the tester
      // has attempts left: thin, not dishonest, so we coach + let them resubmit (leak-safe, no founder DM —
      // that would be noise on every thin first try). Everything else is a FINAL hold that DOES notify the
      // founder: a submission that PASSED the bar (ready to pay — autopay is just off/mainnet), a fraud
      // signal (an attack shouldn't get retries), a null decision (fail-safe), or exhausted attempts.
      const attempt = submission.attempt ?? 1;
      const fraudFlagged =
        (decision?.injectionDetected ?? false) || (decision?.bar.reasons.includes("high_fraud") ?? false);
      const barPassed = decision?.bar.pass ?? false;
      const retryable = !!decision && !barPassed && !fraudFlagged && attempt < OBS_MAX_ATTEMPTS;
      const reasonCode = retryable ? "observation_retry" : "observation_review";
      if (campaign.autonomy === "autopilot" && submission.status === "pending") {
        journalHeld(
          campaign,
          submission,
          retryable ? observationRetryLine(attempt, OBS_MAX_ATTEMPTS) : reasonSentence("observation_review"),
          cid,
        );
        if (!retryable) void notifyFounderHeld(campaign, submission); // DM only on FINAL holds (P20.4)
        return { action: "held", reason: reasonCode, correlationId: cid };
      }
      return { action: "skipped", reason: reasonCode, correlationId: cid };
    }
    // OBSERVATION_AUTOPAY armed + full bar passed → skip the url-lane gate, fall to Sybil + settle.
  }

  // b. gate — the exact autopilot conditions, for url-verifiable missions ONLY (observation missions
  // were fully decided above). mainnet real-money campaigns need DEPUTY_AUTOPILOT_MAINNET armed, else
  // they hold for manual approval.
  if (!isObservation) {
    const gate = gateFromBrief(
      brief,
      campaign,
      submission.status,
      mainnetAutopilotEnabled(),
    );
    agentLog(cid, "gate", { pay: gate.pay, reason: gate.reason });
    if (!gate.pay) {
      // Only journal a hold for an autopilot campaign on a still-pending item;
      // a manual campaign (or an already-handled item) is just a silent skip.
      if (campaign.autonomy === "autopilot" && submission.status === "pending") {
        journalHeld(campaign, submission, gate.reason, cid);
        // DM the founder who launched this campaign from Telegram (best-effort, never blocks).
        void notifyFounderHeld(campaign, submission);
        return { action: "held", reason: gate.reason, correlationId: cid };
      }
      return { action: "skipped", reason: gate.reason, correlationId: cid };
    }

    // b2. UNAPPROVED JUDGE IDENTITY — deterministic, subtract-only. gate.pay is true here; a payout may be
    // authorized ONLY by the EXACT (provider, model, prompt, parser) combination that PASSED the promotion
    // battery (P-JUDGE + red-team). The identity stamped on the brief by callProvider is checked against
    // the approved allowlist, so a fallback model, a different provider, a bumped prompt or parser, an
    // alias that resolved elsewhere, or missing/legacy provenance all fall to MANUAL REVIEW — even at
    // pay/1.0. The existing gates above are untouched; this can only turn a would-pay into a hold.
    const identityGate = judgeIdentityGate(brief, gate.pay);
    if (identityGate.blocked) {
      // the REQUESTED primary model, for the audit line (read inline so the pipeline needs no brain import).
      const requested = process.env.LLM_MODEL?.trim() || process.env.DEPUTY_MODEL?.trim() || "default";
      const reason = `judge_identity_unapproved (requested=${requested}, actual=${brief.model ?? "none"}@${brief.provider ?? "none"}, prompt=${brief.promptVersion ?? "none"}, parser=${brief.parserVersion ?? "none"}, policy=${MODEL_POLICY_VERSION})`;
      agentLog(cid, "model_policy", { blocked: identityGate.blocked, requested, actual: brief.model, provider: brief.provider, promptVersion: brief.promptVersion, parserVersion: brief.parserVersion, approvedModel: identityGate.approvedModel });
      if (campaign.autonomy === "autopilot" && submission.status === "pending") {
        journalHeld(campaign, submission, reason, cid);
        void notifyFounderHeld(campaign, submission);
        return { action: "held", reason, correlationId: cid };
      }
      return { action: "skipped", reason, correlationId: cid };
    }

    // b3. ENTAILMENT VETO (shadow-gated) — the final CONTENT check before autopay. gate.pay + identity are
    // both satisfied here, so this runs ONLY for a would-be autopay (post-qualification). An independently-
    // approved model re-checks whether the brief's OWN cited quotes ENTAIL each met criterion (a marketing
    // phrase ≠ the tester did it). off → skip; shadow → run + journal, never change the payout; enforce →
    // a not_entailed/uncertain verdict or any failure downgrades to MANUAL REVIEW. It NEVER mutates the
    // brief (quotes/confidence/recommendation) — like the identity gate, it can only turn a would-pay into
    // a hold. Journals digests + verdict enums only, never raw page/criterion content.
    const emode = entailmentMode();
    if (emode !== "off") {
      const veto = await runEntailmentVeto(entailmentInputFromBrief(brief, submission.note));
      agentLog(cid, "entailment", {
        mode: emode, ran: veto.ran, vetoed: veto.vetoed, verdicts: veto.verdicts.map((v) => `${v.criterionId}:${v.verdict}`),
        model: veto.model, promptVersion: veto.promptVersion, parserVersion: veto.parserVersion, latencyMs: veto.latencyMs,
        inputDigest: veto.inputDigest, resultDigest: veto.resultDigest, error: veto.error, reason: veto.vetoReason,
      });
      if (emode === "enforce" && veto.vetoed) {
        const reason = `entailment_veto (${veto.vetoReason})`;
        if (campaign.autonomy === "autopilot" && submission.status === "pending") {
          journalHeld(campaign, submission, reason, cid);
          void notifyFounderHeld(campaign, submission);
          return { action: "held", reason, correlationId: cid };
        }
        return { action: "skipped", reason, correlationId: cid };
      }
    }
  }

  // c'. Sybil dedup — never auto-pay a copy of an entry already paid on this
  // campaign (same evidence bytes or the same report text from a different
  // wallet). The vault already caps total loss; this stops one person farming
  // multiple seats. Pre-check only — the frozen brain is untouched.
  const dup = findDuplicate(
    { note: submission.note, contentSha256: decisionRow?.contentSha256 ?? null },
    listPaidSubmissionsForDedup(campaign.id, submissionId),
  );
  if (dup) {
    const reason = `possible duplicate — ${dup.reason}`;
    agentLog(cid, "dedup", { duplicate: true, reason: dup.reason });
    if (campaign.autonomy === "autopilot" && submission.status === "pending") {
      journalHeld(campaign, submission, reason, cid);
      return { action: "held", reason, correlationId: cid };
    }
    return { action: "skipped", reason, correlationId: cid };
  }

  // c''. Near-duplicate (P18) — the same report lightly reworded across wallets (paraphrase farming).
  // Scans ALL other submissions on the campaign, since a farm shows as a cluster of near-identical
  // PENDING reports, not just paid ones. HELD for human review, never auto-rejected: the threshold is
  // deliberately high, but a false "you copied" is worse than a miss, so a person makes the final call.
  const near = findNearDuplicate(
    { note: submission.note, contentSha256: decisionRow?.contentSha256 ?? null },
    listSubmissionsForDedup(campaign.id, submissionId),
  );
  if (near) {
    const reason = `possible duplicate account — ${near.reason}`;
    agentLog(cid, "near_dedup", { duplicate: true, similarity: near.similarity });
    if (campaign.autonomy === "autopilot" && submission.status === "pending") {
      journalHeld(campaign, submission, reason, cid);
      return { action: "held", reason, correlationId: cid };
    }
    return { action: "skipped", reason, correlationId: cid };
  }

  // c'''. Per-campaign per-wallet payout CAP (P18) — the most times ONE wallet can be paid across the
  // WHOLE campaign (default 1; a founder raises it for trusted multi-mission testers). The vault's
  // per-mission recipientCompleted already blocks same-mission replay; this bounds one wallet across
  // DIFFERENT missions. Counts paid+settling for this wallet; at/over cap → HELD (never a silent skip —
  // the founder can still release manually). Deterministic DB check, before any chain read or signing.
  const walletPaid = countPaidByWalletInCampaign(campaign.id, submission.wallet);
  if (walletPaid >= campaign.perWalletPayoutCap) {
    const reason = `wallet reached its per-campaign payout cap (${campaign.perWalletPayoutCap})`;
    agentLog(cid, "wallet_cap", { walletPaid, cap: campaign.perWalletPayoutCap });
    if (campaign.autonomy === "autopilot" && submission.status === "pending") {
      journalHeld(campaign, submission, reason, cid);
      return { action: "held", reason, correlationId: cid };
    }
    return { action: "skipped", reason, correlationId: cid };
  }

  // c0. PAYOUT ACTION REPLAY (Phase 4) — for an ACTION mission on a canary campaign, Sage RE-PERFORMS the exact
  // deterministic action in a FRESH guarded browser before settlement and compares it to the bound MissionProbeV1.
  // SUBTRACTIVE ONLY: a `reproduced` result merely lets the already-qualified decision continue (it never creates
  // a payout, raises confidence, or replaces missing evidence); any other result vetoes in canary (hold before
  // broadcast) or is journaled in shadow (settlement unchanged). Runs AFTER all evidence/judge qualification +
  // Sybil/cap, BEFORE preflight/CAS/settle. off (default) → skip → byte-identical existing behavior.
  if (payoutActionReplayMode() !== "off" && mission) {
    const replayDeps = deps.payoutReplay ?? {};
    const replay = await runPayoutActionReplay(campaign, mission.missionKey, { journal: dbReplayJournal, submissionId, ...replayDeps });
    agentLog(cid, "payout_replay", { mode: replay.mode, decision: replay.decision, code: replay.code, isAction: replay.isActionMission, probes: replay.probeResults });
    if (replay.decision === "hold") {
      const reason = `action_replay_veto:${replay.code}`;
      if (campaign.autonomy === "autopilot" && submission.status === "pending") {
        journalHeld(campaign, submission, reason, cid);
        return { action: "held", reason, correlationId: cid };
      }
      return { action: "skipped", reason, correlationId: cid };
    }
    // shadow → decision is always "allow" (journaled above, settlement unchanged); canary reproduced → continue.
  }

  // c. pre-flight — for V2 the DB↔chain agreement is enforced here BEFORE any
  // signing; for V1 the existing courtesy policy read. Strategy is chosen from the
  // campaign's persisted vault kind, never probed.
  const pf =
    campaign.vaultKind === "campaign_v2"
      ? await preflightV2(campaign, submission, deps)
      : await preflight(campaign, submission);
  agentLog(cid, "preflight", { ok: pf.ok, reason: pf.reason });
  if (!pf.ok) {
    journalHeld(campaign, submission, pf.reason, cid);
    return { action: "held", reason: pf.reason, correlationId: cid };
  }

  // f. CAS pending → settling BEFORE any chain write. If we lose, another runner
  // owns it — exit silently, no double-settle.
  const won = casSubmissionStatus(submissionId, "pending", "settling");
  agentLog(cid, "cas", { won });
  if (!won) {
    return { action: "skipped", reason: "another runner owns it", correlationId: cid };
  }

  // e. settle through the EXISTING settle-flow (intentHash idempotency). On a
  // founder vault where the recipient isn't approved this returns needsOwnerAdd
  // (it never signs the add). Any failure → hold; never retry-loop.
  try {
    const { outcome } = await settleApprovedSubmission(campaign, submission, deps);
    if (outcome.settled && outcome.txHash) {
      const conf = Math.round(brief.confidence * 100);
      // Idempotent by (kind, txHash): a re-fire that reconciles the same settled
      // payout never writes a second autopay_settled row.
      recordEventOnce({
        campaignId: campaign.id,
        submissionId,
        kind: "autopay_settled",
        detail: encodeDetail(
          `${short(outcome.recipient)} · ${conf}% · dec ${decisionRow?.id ?? "—"}`,
          { cid },
        ),
        txHash: outcome.txHash,
        amount: outcome.amountBase,
      });
      agentLog(cid, "settle", {
        action: "settled",
        tx: outcome.txHash,
        amountBase: outcome.amountBase,
      });
      void notifyTelegram(
        `✅ <b>Paid by Deputy</b>\n${campaign.title}\n${usd(outcome.amountBase / 1_000_000)} → ${short(outcome.recipient)} · ${conf}% confidence\n${appUrl()}/proof/${outcome.txHash}`,
      );
      return { action: "settled", reason: "paid", txHash: outcome.txHash, correlationId: cid };
    }

    // Not settled: reset to pending for human review, journal the honest reason.
    updateSubmission(submissionId, { status: "pending", decidedAt: null });
    const reason = outcome.needsOwnerAdd
      ? "awaiting owner allowlist signature"
      : (outcome.reason ?? "blocked on-chain");
    journalHeld(campaign, submission, reason, cid);
    agentLog(cid, "settle", { action: "held", reason });
    return { action: "held", reason, correlationId: cid };
  } catch (err) {
    console.error("[pipeline] settle failed:", err);
    updateSubmission(submissionId, { status: "pending", decidedAt: null });
    journalHeld(campaign, submission, "settlement error — needs review", cid);
    agentLog(cid, "settle", {
      action: "held",
      reason: "settlement error",
      error: err instanceof Error ? err.message : String(err),
    });
    return { action: "held", reason: "settlement error", correlationId: cid };
  }
}
