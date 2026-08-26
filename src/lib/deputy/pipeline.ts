import "server-only";

import { getAddress } from "viem";
import { short, usd } from "@/lib/format";
import { decodeDetail, encodeDetail } from "@/lib/campaigns/journal";
import type { Campaign, Submission } from "@/lib/db/schema";
import {
  casSubmissionStatus,
  countPaidByWalletInCampaign,
  countPaidForMission,
  getCampaign,
  getDecisionBySubmission,
  getLatestSubmissionEvent,
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
import { OBS_MAX_ATTEMPTS, OBS_BAR_POLICY_VERSION, deriveCriterionEvidence, verdictStillApplies, type PrivateKey } from "./observation-verify";
import { observationRetryLine, reasonSentence } from "./reason-copy";
import { getVaultState, isVendorApproved } from "@/lib/deputy/chain";
import { freshnessHoldReason, readChainFreshness } from "@/lib/deputy/chain-freshness";
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
import { parseWorkProofContract } from "./work-proof";
import { gateFromBrief } from "./autopilot";
import { payoutActionReplayMode, runPayoutActionReplay } from "./payout-replay";
import { dbReplayJournal } from "@/lib/db/payout-replay-journal";
import { payoutReplaySchemaReady } from "./canary-preflight";
import { judgeIdentityGate, MODEL_POLICY_VERSION } from "./model-policy";
import { entailmentMode, entailmentInputFromBrief, runEntailmentVeto } from "./entailment";
import { notifyFounderHeld, notifyRecipientPaid } from "@/lib/telegram/founder-notify";
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

  const fresh = await readChainFreshness(campaign.chainId);
  if (!fresh.fresh) return { ok: false, reason: freshnessHoldReason(fresh) };

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
  /**
   * NEVER SIGN AGAINST A CHAIN WE CANNOT SHOW IS CURRENT.
   *
   * Every check below reads the vault, and a settlement's nonce comes from the node's account state.
   * A node ten hours behind (measured 2026-08-15) answers all of it instantly and wrongly: the vault
   * looks unfunded, completions look unused, and the nonce is long spent. Holding costs a few minutes;
   * broadcasting real USDC on stale state is how a payout gets stuck, replaced, or sent twice.
   */
  const fresh = await readChainFreshness(campaign.chainId);
  if (!fresh.fresh) return { ok: false, reason: freshnessHoldReason(fresh) };

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
    return { ok: false, reason: TERMINAL_REASON.missionFull };
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

/**
 * A HOLD IS A STATE, NOT AN EVENT.
 *
 * This wrote a journal row AND pushed a Telegram message every time it ran, and the sweep runs the
 * whole pipeline over every pending submission every ~5 minutes forever. Measured on the first
 * funded campaign (clawup, 2026-08-14): **239 identical `autopay_held` rows for FOUR submissions**
 * in five hours, each one also a push — the founder's phone buzzing every five minutes to repeat
 * something that had not changed since 7am, on a campaign that was already fully paid out. Same
 * family as the sweep re-judging stuck submissions forever ([[llm-cost-leak]]): a repeating
 * evaluation must compare against what it already recorded before it records again.
 *
 * So: journal + notify only when this hold is NEW, or its REASON CHANGED (cap → review → retry are
 * genuinely different things the founder wants to know about). A hold that is still the same hold
 * is silent, and the existing event keeps its original timestamp — which also stops the activity
 * feed from resurfacing five-hour-old holds as "just now".
 */
/**
 * Reasons a submission can NEVER be paid, whatever happens next — the vault enforces both on-chain.
 * Worded for the person who did the work: what happened, and that it is not about their work.
 */
const TERMINAL_REASON = {
  missionFull:
    "this mission filled up before your submission could be released \u2014 every slot has been paid to earlier submissions. This is not a judgement on your work",
  walletCap: (cap: number) =>
    `this campaign pays each wallet ${cap === 1 ? "once" : `${cap} times`}, and this wallet has already been paid \u2014 not a judgement on your work`,
} as const;

function journalHeld(
  campaign: Campaign,
  submission: Submission,
  reason: string,
  cid?: string,
): void {
  const line = `${short(submission.wallet)} · ${reason}`;
  const last = getLatestSubmissionEvent(submission.id, "autopay_held");
  // `detail` is TEXT holding an encodeDetail envelope — decode it, never read `.t` off the string.
  if (decodeDetail(last?.detail ?? null).text === line) return;
  recordEvent({
    campaignId: campaign.id,
    submissionId: submission.id,
    kind: "autopay_held",
    detail: encodeDetail(line, { cid }),
  });
  void notifyTelegram(
    `⏸️ <b>Held by Sage</b>\n${campaign.title}\n${usd(campaign.rewardAmount / 1_000_000)} → ${short(submission.wallet)}\n${reason}\n${appUrl()}/app`,
  );
}

/**
 * A HOLD THAT CAN NEVER BE RELEASED IS NOT A HOLD — it is an unpaid person waiting forever.
 *
 * Measured on the first funded campaign (clawup, 2026-08-14): the $20 budget was fully paid, both
 * missions hit their completion caps, and FOUR submissions sat `pending` afterwards — re-evaluated
 * by the sweep every five minutes, held again, notified again, with no possible outcome. The vault
 * enforces `maxCompletions` and the per-wallet cap on-chain, so no top-up and no founder review can
 * ever release them: the slots are gone. Leaving them "pending" tells a real person their work is
 * still being considered when it is not.
 *
 * Same shape as the stranded testers a stopped campaign left behind: when the PARENT reaches a
 * terminal state, its dependent rows must be resolved with an honest reason — and the reason must
 * never read as a verdict on the work, because it isn't one. They lost a race, not a judgement.
 */
function resolveTerminal(
  campaign: Campaign,
  submission: Submission,
  reason: string,
  cid?: string,
): void {
  if (!casSubmissionStatus(submission.id, "pending", "rejected")) return;
  updateSubmission(submission.id, { rejectReason: reason });
  recordEvent({
    campaignId: campaign.id,
    submissionId: submission.id,
    kind: "autopay_held",
    detail: encodeDetail(`${short(submission.wallet)} · ${reason}`, { cid }),
  });
  void notifyTelegram(
    `\u23f9\ufe0f <b>Closed by Sage</b>\n${campaign.title}\n${short(submission.wallet)}\n${reason}\n${appUrl()}/app`,
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

  /**
   * IS THERE STILL A SLOT? Asked FIRST, before any judging.
   *
   * The mission-full check used to live in the settlement preflight, which is the last step — so
   * every hold that short-circuits earlier (a retry, a review, a near-dup) kept its submission
   * `pending` on a mission that had no slot left to give it. Measured on clawup: three people were
   * still "waiting for Sage to decide" on missions whose every slot had been paid hours before, one
   * of them being invited to spend a third attempt refining work that could never be paid.
   *
   * `maxCompletions` is enforced by the vault and never rises, so this answer cannot change. Asking
   * it first also means no judge, no corpus match and no LLM call is spent on an unpayable slot.
   */
  if (mission && countPaidForMission(mission.missionIdHash) >= mission.maxCompletions) {
    agentLog(cid, "mission_full", { missionKey: mission.missionKey });
    if (submission.status === "pending") {
      resolveTerminal(campaign, submission, TERMINAL_REASON.missionFull, cid);
    }
    return { action: "held", reason: TERMINAL_REASON.missionFull, correlationId: cid };
  }

  // WORK PROOF — an explicit operator contract outranks the inferred class: a direct grant/gig
  // mission is decided by the deterministic verifier + the url-lane gate (see decisions.ts), never
  // by the corpus judge (a direct campaign HAS no corpus — routing it there would freeze it).
  const isObservation =
    mission?.verifiabilityClass === "observation-based" &&
    !parseWorkProofContract(mission?.verificationContract ?? null);
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

    // A VERDICT THAT CANNOT HAVE CHANGED IS NOT RE-BOUGHT. The sweep re-runs this pipeline over every
    // pending submission on every tick (~5 min), and the judge below is an LLM call. Nothing it reads
    // moves between ticks — the tester's account text and the pinned corpus are both immutable — so
    // each re-judge returned the identical verdict and was billed for it.
    //
    // Measured over one week: 3,766 judge calls costing $8.65 against ~11 submissions — 81% of all LLM
    // spend. The trigger was submissions STUCK pending (frozen by the vacuous-policy covenant defect),
    // which the sweep then re-judged 288 times a day, forever. One bug froze the work; the other
    // charged for noticing it was still frozen.
    //
    // This check MUST precede the call — deciding afterwards only discards the answer, having already
    // paid for it.
    const attemptNow = submission.attempt ?? 1;
    const priorShadow =
      (getDecisionBySubmission(submissionId)?.observationShadow as
        | { barPass?: boolean; barReasons?: string[]; injectionDetected?: boolean; distinctSources?: number; corpusDigest?: string; attempt?: number; barPolicy?: string }
        | null
        | undefined) ?? null;
    const reusable = verdictStillApplies(priorShadow, attemptNow, key.digest);

    const criterionContract = (() => {
      if (mission.criterionEvidence) return { evidence: mission.criterionEvidence, derived: false };
      const derived = deriveCriterionEvidence(key, mission.criteria ?? [], mission.evidenceList ?? []);
      return derived.some((c) => c.keySources.length > 0)
        ? { evidence: derived, derived: true }
        : { evidence: null, derived: false };
    })();

    const decision = reusable ? null : await runObservationDecision({
      account: submission.note,
      key,
      // CAUSAL priors (2b): only submissions that existed BEFORE this one, so a later copy can never
      // retroactively flag this genuine account as a near-dup on a re-sweep.
      priors: listEarlierSubmissionsForDedup(campaign.id, submissionId, submission.createdAt),
      missionObjective: mission.objective,
      criteria: mission.criteria,
      publicStrings,
      hasHighFraud,
      // The mission's OWN contract: the compiler-pinned one when it exists, else a contract DERIVED
      // deterministically from the pinned key + the mission's criteria (universal contracts). Every
      // observation mission is now judged per-criterion — "did they evidence each thing the mission
      // asked for" — instead of by the flat count alone; per-criterion coaching fires everywhere; and
      // the criteria-complete pass applies uniformly. Derivation is pure and stable given (key,
      // criteria), so verdict reuse stays sound; an empty derivation degrades to the flat bar.
      criterionEvidence: criterionContract.evidence,
      // A DERIVED contract may help (arm the criteria-complete pass, drive coaching) but must never
      // block: the derivation is lexical, so a tester quoting the product's own dialogue can back a
      // criterion whose wording shares no tokens with it. Measured on the live yara mission —
      // `state:28`/`state:29` (Yara's actual words, the best evidence in the corpus) back NEITHER
      // criterion. A compiler-authored contract is authoritative and blocks exactly as before.
      criterionEvidenceDerived: criterionContract.derived,
      // The corroboration recall path needs a STRONG judge to bridge the vision↔experience vocabulary
      // gap (a weak model finds only the near-lexical matches — measured). OBS_JUDGE_MODEL routes just the
      // observation judge to it; unset → falls back to the default judge model (weaker recall → genuine
      // work holds for the founder, the SAFE degradation, never a wrong pay).
      model: process.env.OBS_JUDGE_MODEL || undefined,
    }).catch(() => null);

    // The reused numbers are the same numbers a fresh call would have produced, and the settlement
    // gate below still runs in full on them — nothing is weakened, only not re-purchased.
    const barPass = decision ? decision.bar.pass : reusable ? priorShadow!.barPass! : false;
    const barReasons = decision ? decision.bar.reasons : reusable ? (priorShadow!.barReasons ?? []) : ["no_decision"];
    const injectionDetected = decision ? decision.injectionDetected : reusable ? (priorShadow!.injectionDetected ?? false) : false;
    const distinctSources = decision ? decision.publicView.distinctSources : reusable ? (priorShadow!.distinctSources ?? 0) : 0;
    const haveVerdict = !!decision || reusable;

    const autopay = haveVerdict && observationAutopayEnabled() && barPass;
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
      shadow.attempt = attemptNow; // lets a later sweep prove the verdict still applies
      shadow.barPolicy = OBS_BAR_POLICY_VERSION; // a bar-policy change invalidates stored verdicts
      setObservationShadow(submissionId, shadow);
    }
    agentLog(cid, "observation", {
      barPass,
      distinct: distinctSources,
      reasons: barReasons,
      autopay,
      reusedVerdict: !decision && reusable,
    });
    if (!autopay) {
      // P20 — a hold is RETRYABLE only when the work FELL SHORT of the bar but looks honest and the tester
      // has attempts left: thin, not dishonest, so we coach + let them resubmit (leak-safe, no founder DM —
      // that would be noise on every thin first try). Everything else is a FINAL hold that DOES notify the
      // founder: a submission that PASSED the bar (ready to pay — autopay is just off/mainnet), a fraud
      // signal (an attack shouldn't get retries), a null decision (fail-safe), or exhausted attempts.
      const attempt = submission.attempt ?? 1;
      const fraudFlagged = injectionDetected || barReasons.includes("high_fraud");
      const barPassed = barPass;
      const retryable = haveVerdict && !barPassed && !fraudFlagged && attempt < OBS_MAX_ATTEMPTS;
      // A bar-PASS held only because autopay is unarmed is VERIFIED work awaiting release — it must
      // never be journaled as "needs your judgment", which reads as a verdict on the tester.
      const reasonCode = retryable
        ? "observation_retry"
        : barPassed
          ? "observation_verified"
          : "observation_review";
      if (campaign.autonomy === "autopilot" && submission.status === "pending") {
        journalHeld(
          campaign,
          submission,
          retryable
            ? observationRetryLine(attempt, OBS_MAX_ATTEMPTS)
            : reasonSentence(barPassed ? "observation_verified" : "observation_review"),
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
  // url-lane: scans ALL other submissions on the campaign, since a farm shows as a cluster of
  // near-identical PENDING reports, not just paid ones. HELD for human review, never auto-rejected.
  //
  // OBSERVATION lane: CAUSAL priors only (earlier submissions), matching the decision the bar already
  // made with the same causal rule (2b). Scanning ALL here re-introduced the exact bug that rule
  // fixed: a LATER copycat (or the same tester's own later refinement) retroactively flagged an
  // EARLIER genuine account as a near-dup at settle time, holding work the bar had passed. The
  // copycat itself still gets caught — from ITS side, the genuine account is an earlier submission.
  const near = findNearDuplicate(
    { note: submission.note, contentSha256: decisionRow?.contentSha256 ?? null },
    isObservation
      ? listEarlierSubmissionsForDedup(campaign.id, submissionId, submission.createdAt)
      : listSubmissionsForDedup(campaign.id, submissionId),
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
    const reason = TERMINAL_REASON.walletCap(campaign.perWalletPayoutCap);
    agentLog(cid, "wallet_cap", { walletPaid, cap: campaign.perWalletPayoutCap });
    // TERMINAL: this wallet has been paid its maximum for this campaign and the count never
    // decreases, so no sweep, top-up or manual release can change the answer. Close it honestly.
    if (campaign.autonomy === "autopilot" && submission.status === "pending") {
      resolveTerminal(campaign, submission, reason, cid);
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
    // A FULL MISSION IS TERMINAL. `maxCompletions` is enforced by the vault and never rises, so a
    // submission that arrives after the last slot is paid can never be released — holding it just
    // makes someone wait forever for an answer that already exists.
    if (pf.reason === TERMINAL_REASON.missionFull) {
      resolveTerminal(campaign, submission, pf.reason, cid);
    } else {
      journalHeld(campaign, submission, pf.reason, cid);
    }
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
      // WALLETLESS RECIPIENT: if this payout landed in a chat-bound wallet, tell the PERSON —
      // best-effort, never blocks or affects the settlement.
      void notifyRecipientPaid(campaign, submission, { recipient: outcome.recipient, amountBase: outcome.amountBase, txHash: outcome.txHash });
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
