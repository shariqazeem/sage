import "server-only";

/**
 * The founder-launch orchestration: a real HTTPS product URL (+ optional public repo)
 * → bounded safe inspection → deterministic ProductMapV1 → real LLM mission brain
 * (architect + critic) → deterministic quality gate → exact budget allocation →
 * canonical MissionPlanV1 (MissionSpecV1 + CampaignVaultV2 hashes). Every stage is
 * real; nothing is simulated. Returns a discriminated result the durable job + UI
 * render from. This module performs NO deployment, funding, or signing.
 */

import { inspectProduct, rankPrimaryLinks } from "./inspect";
import { fieldTestEnabled, runFieldTest } from "./field-test";
import { inspectRepo } from "./github";
import { buildProductMap, hasUsableInspection, scopeFromObservations } from "./product-map";
import { buildObservationCorpus } from "./validate-mission";
import { runMissionBrain, type MissionBrainResult } from "./mission-brain";
import { inspectionReplayMode, runReplayShadow } from "./inspection-replay";
import { missionGroundingMode } from "./mission-grounding-shadow";
import { canaryPlanCommitment, evaluateCanarySelection, type CanaryIdentity } from "./mission-canary";
import { compileVerificationPolicy, type VerificationPolicyV1 } from "./mission-probe";
import { allocateBudget } from "./budget";
import { compilePlan } from "./plan";
import { MISSION_PROMPT_VERSION } from "./mission-prompt";
import type { BudgetAllocation, FieldTestSummary, FounderLaunchInput, MissionPlanV1, ProductMapV1 } from "./schemas";

export type LaunchStage =
  | "fetching"
  | "field_test"
  | "mapping"
  | "analyzing"
  | "generating_missions"
  | "reviewing"
  | "ready"
  | "needs_input"
  | "failed";

export interface LaunchResult {
  stage: LaunchStage;
  reason: string | null;
  map: ProductMapV1 | null;
  brain: MissionBrainResult | null;
  allocation: BudgetAllocation | null;
  plan: MissionPlanV1 | null;
  /** honest questions for the founder when needs_input. */
  questions: string[];
  /** stage transitions observed (for durable progress + observability). */
  trail: { stage: LaunchStage; at: number }[];
  /** Phase 5 CANARY — the grounded-plan selection outcome for this launch (absent when the canary path never
   *  engaged). `selected` ⇒ `plan` is the grounded V2 plan committed by `planCommitment`; `blocked` ⇒ `plan` is
   *  null and legacy was preserved for comparison but NOT launched (manual handling required). */
  canary?: CanaryPipelineOutcome | null;
}

/** Bounded, leak-safe provenance for a SELECTED grounded plan — persisted on the job result so job + revision
 *  metadata reflect the grounded path, never the legacy brain.model. */
export interface GroundedSelectionProvenance {
  planSource: "grounded_v2";
  architectModel: string | null;
  architectProvider: string | null;
  architectContractVersion: string;
  criticModel: string | null;
  criticProvider: string | null;
  criticContractVersion: string;
  observationSetDigest: string;
  groundedPlanDigest: string;
  missionPlanDigest: string;
}

export interface CanaryPipelineOutcome {
  status: "disabled" | "unauthorized" | "blocked" | "selected";
  reason: string | null;
  /** which plan `LaunchResult.plan` carries when the run is ready ("grounded_v2" only on selected). */
  planSource: "legacy" | "grounded_v2" | "none";
  /** the deterministic grounded-plan digest (selected only). */
  groundedDigest?: string;
  /** the authoritative on-chain missionPlanDigest of the compiled plan that was selected (or, on block, the
   *  legacy comparison plan's digest). */
  planDigest?: string;
  /** a deterministic COMMITMENT over {planDigest, budget, revision} — provenance only, NOT authorization. The
   *  founder's SIWE approval of the revision remains the sole authorization. (selected only) */
  planCommitment?: string;
  /** the operator-allowlisted wallet the canary was authorized for (selected only). */
  wallet?: string;
  /** grounded provenance carried into job + revision metadata (selected only). */
  provenance?: GroundedSelectionProvenance;
  /** Phase 3 — the immutable VerificationPolicyV1 compiled for the selected grounded plan (one MissionProbeV1
   *  per compilable action mission). Persisted beside the plan + bound to the campaign at deploy. (selected only) */
  verificationPolicy?: VerificationPolicyV1 | null;
}

/**
 * Run the whole pipeline for a single inspection. `onStage` is invoked as each REAL
 * stage begins (so a durable job persists true progress — never a timer). `now` lets a
 * deterministic caller stamp times; production passes 0 to use the wall clock.
 */
export async function inspectAndPlan(
  input: FounderLaunchInput,
  publicCampaignId: string,
  onStage: (stage: LaunchStage) => void = () => {},
  now = 0,
  opts: { inspectionId?: string; replayDeps?: { allowLoopback?: ReadonlySet<string>; egressAllowedPorts?: ReadonlySet<number> }; canaryIdentity?: CanaryIdentity | null } = {},
): Promise<LaunchResult> {
  const trail: { stage: LaunchStage; at: number }[] = [];
  const stamp = (stage: LaunchStage) => {
    trail.push({ stage, at: now > 0 ? now : Math.floor(Date.now() / 1000) });
    onStage(stage);
  };
  const out = (stage: LaunchStage, reason: string | null, partial: Partial<LaunchResult> = {}): LaunchResult => ({
    stage, reason, map: null, brain: null, allocation: null, plan: null, questions: [], trail, canary: null, ...partial,
  });

  // 1. inspect the real product (bounded + SSRF-guarded).
  stamp("fetching");
  const inspection = await inspectProduct(input.productUrl, {}, now);

  // 1b. FIELD TEST (flag-gated): actually browse the product in a real headless browser and
  //     capture what a real visit reveals. FULLY failure-isolated — any error/timeout degrades
  //     to an honest limitation and the pipeline proceeds exactly as an HTML-only run would. It
  //     needs an inspectionId to name its screenshot artifacts (only the durable job supplies one).
  let fieldTest: FieldTestSummary | null = null;
  // Run the browser when static HTML yielded observations, OR when the site RESPONDED but every page
  // was blocked/challenged/empty. Client-rendered SPAs and bot-walled products (commercial stores,
  // news, anything behind a WAF) return ZERO static observations to our read-only UA — the real
  // headless browser is exactly the tool that can see them. A genuinely-dead URL (DNS failure, hard
  // 404) just makes the failure-isolated field test return null, so the needs_input path is unchanged.
  const reachedButThin = inspection.observations.length === 0 && inspection.blocked.length > 0;
  if (fieldTestEnabled() && opts.inspectionId && (inspection.observations.length > 0 || reachedButThin)) {
    // A REAL stage — emitted only when the browser phase actually runs (no fake timers). Off-path
    // this stamp never fires, so the stage sequence stays identical to today.
    stamp("field_test");
    try {
      fieldTest = await runFieldTest({
        inspectionId: opts.inspectionId,
        startUrl: inspection.startUrl,
        host: inspection.host,
        candidateLinks: rankPrimaryLinks(inspection.observations, inspection.host, inspection.startUrl, 5),
      });
    } catch {
      fieldTest = null;
    }
  }

  // 2. optional repository (honest degradation).
  let repo = { artifacts: [] as Awaited<ReturnType<typeof inspectRepo>>["artifacts"], reason: null as string | null };
  if (input.repoUrl) {
    stamp("analyzing");
    repo = await inspectRepo(input.repoUrl);
  }

  // 3. deterministic product map (+ field-test evidence when present).
  stamp("mapping");
  const map = buildProductMap(inspection.observations, repo.artifacts, input, fieldTest);
  // fold the inspector + repo limitations into the map's honest limitations — CONDITION-AWARE: when
  // the Field Test actually explored the live product, the "server-rendered HTML only" caveat is no
  // longer true (a client-side flow WAS observed), so drop it and describe the real boundary instead.
  const explored = !!(fieldTest?.ran && (fieldTest.pages.length > 0 || fieldTest.states.length > 0));
  const inspectorLimitations = explored
    ? inspection.limitations.filter((l) => !/server-rendered HTML only/i.test(l))
    : inspection.limitations;
  const explorationNote = explored
    ? ["Sage explored the live product in a real browser; anything behind a login, or a specific interaction Sage didn't perform, may still be under-observed."]
    : [];
  map.limitations = [...new Set([...map.limitations, ...inspectorLimitations, ...explorationNote, ...(repo.reason ? [`Repository: ${repo.reason}`] : [])])];

  // Only ask "we couldn't inspect anything" when NEITHER the static crawl NOR the real browser saw a
  // thing. A bot-walled or client-rendered product yields 0 static pages but a rich field test — that
  // is a READY product, not a needs_input (the mission corpus below is built from the field test).
  // `hasUsableInspection` is the shared predicate the mission brain gate uses too, so they can't drift.
  if (!hasUsableInspection(map)) {
    return out("needs_input", "no_inspected_pages", { map, questions: map.openQuestions });
  }

  // 3b. Eyes V2 — OPTIONAL shadow replay of a safe observed transition (INSPECTION_REPLAY_MODE=shadow;
  // default off → this whole block is a no-op and the artifact is byte-identical). Re-performs an action
  // Sage already saw, through the C4 guarded egress boundary, and attaches leak-safe result codes to the
  // inspection artifact. It NEVER affects payout or mission acceptance; a replay failure never fails the
  // inspection (best-effort, fully caught).
  if (map.observations && inspectionReplayMode() === "shadow") {
    try {
      const replay = await runReplayShadow(map.observations, opts.inspectionId ?? "inspection", { maxProbes: 2, ...opts.replayDeps });
      if (replay.ran) map.replayShadow = { version: "replay-shadow-v1", mode: "shadow", probes: replay.probes, byClassification: replay.byClassification, results: replay.records };
    } catch {
      /* replay is best-effort telemetry; it can never fail the inspection */
    }
  }

  // 4. real LLM mission brain (architect → critic → deterministic gate).
  stamp("generating_missions");
  const scope = scopeFromObservations(inspection.observations, repo.artifacts);
  // the observation corpus is every string Sage actually observed — the anchor gate matches each
  // mission's claimed anchors against it, so nothing can be invented from scraps.
  const corpus = buildObservationCorpus(inspection.observations, map.fieldTest);
  const brain = await runMissionBrain(map, input, scope, corpus);
  stamp("reviewing");
  // compile a candidate mission set → exact allocation → canonical MissionPlanV1 (MissionSpecV1 + vault hashes).
  // Used identically for the legacy plan and (under canary) the grounded plan, so both traverse the SAME
  // deterministic allocator + compiler. No model computes money; allocateBudget owns the base-unit amounts.
  const compileMissions = (missions: typeof brain.accepted, modelVersion: string) => {
    const allocation = allocateBudget(
      missions.map((m) => ({ missionKey: m.missionKey, weight: m.rewardWeight, suggestedMaxCompletions: m.maxCompletions, priority: m.priority, effortMinutes: m.effortMinutes })),
      input.totalBudgetBase,
    );
    if (!allocation.ok) return { ok: false as const, allocation, plan: null };
    const compiled = compilePlan({
      publicCampaignId, productMapDigest: map.digest, missions, allocation,
      tokenDecimals: input.tokenDecimals, modelVersion, promptVersion: MISSION_PROMPT_VERSION, revision: 1,
    });
    if (!compiled.ok) return { ok: false as const, allocation, plan: null, error: compiled.error };
    return { ok: true as const, allocation, plan: compiled.plan };
  };

  // 5. CANARY DECISION — may the grounded V2 plan REPLACE legacy for this launch? Authority comes ONLY from the
  //    process mode + the server-verified identity + the operator allowlist (never from founder/model/product
  //    text). Default off ⇒ `disabled` ⇒ legacy proceeds byte-identically to before. Evaluated BEFORE the legacy
  //    `!brain.ok` early-return: a grounded canary is independently gated (its own strict signals + gate + exact
  //    allocation) and must NOT depend on the legacy plan also passing validation.
  const canaryDecision = evaluateCanarySelection({
    mode: missionGroundingMode(),
    identity: opts.canaryIdentity ?? null,
    plan: brain.groundingShadow?.groundedCandidatePlan,
  });

  if (canaryDecision.status === "selected") {
    // compile the GROUNDED missions through the identical allocator+compiler, using the GROUNDED architect model
    // as the plan's modelVersion; exact base-unit equality is mandatory; commit the plan (provenance, not auth).
    const g = compileMissions(canaryDecision.plan.missions, canaryDecision.plan.architectModel ?? brain.model);
    if (!g.ok || !g.plan) return out("failed", `canary_compile_failed:${(g as { error?: string }).error ?? g.allocation.reason ?? "unknown"}`, { map, brain, allocation: g.allocation, canary: { status: "blocked", reason: "compile_failed", planSource: "none" } });
    if (g.plan.allocatedBase !== input.totalBudgetBase) return out("failed", "canary_budget_not_exact", { map, brain, allocation: g.allocation, canary: { status: "blocked", reason: "budget_not_exact", planSource: "none" } });
    const commitment = canaryPlanCommitment({ planDigest: g.plan.missionPlanDigest, budgetText: `${input.totalBudgetBase} base units @ ${input.tokenDecimals}dp`, budgetBase: g.plan.totalBudgetBase.toString(), revision: g.plan.revision });
    const gp = canaryDecision.plan;
    const provenance: GroundedSelectionProvenance = {
      planSource: "grounded_v2", architectModel: gp.architectModel, architectProvider: gp.architectProvider, architectContractVersion: gp.architectContractVersion,
      criticModel: gp.criticModel, criticProvider: gp.criticProvider, criticContractVersion: gp.criticContractVersion,
      observationSetDigest: gp.observationSetDigest, groundedPlanDigest: canaryDecision.groundedDigest, missionPlanDigest: g.plan.missionPlanDigest,
    };
    // Phase 3 — compile the immutable VerificationPolicyV1 for the selected grounded plan: one MissionProbeV1
    // per compilable action mission, bound to this plan's digests + the reproduced replay set. Deterministic;
    // the deputy loads it by campaign+mission and it can only SUBTRACT settlement eligibility (Phase 4).
    const replayReproduced = new Set((map.replayShadow?.results ?? []).filter((r) => r.classification === "reproduced").map((r) => r.transitionId));
    const verificationPolicy = map.observations
      ? compileVerificationPolicy({ missionPlanDigest: g.plan.missionPlanDigest, productMapDigest: map.digest, set: map.observations, missions: canaryDecision.plan.missions, replayReproduced, scope }).policy
      : null;
    stamp("ready");
    return out("ready", null, { map, brain, allocation: g.allocation, plan: g.plan, questions: brain.needsInputQuestions,
      canary: { status: "selected", reason: null, planSource: "grounded_v2", groundedDigest: canaryDecision.groundedDigest, planDigest: g.plan.missionPlanDigest, planCommitment: commitment.commitment, wallet: canaryDecision.wallet, provenance, verificationPolicy } });
  }

  // canary not selected → the LEGACY plan governs. A legacy generation failure is retryable (provider/parse)
  // or a needs_input (gate exhausted / too thin). The canary status is carried for observability.
  if (!brain.ok) {
    const NEEDS_INPUT = new Set(["no_missions_passed_validation", "insufficient_observation"]);
    const stage: LaunchStage = brain.reason && NEEDS_INPUT.has(brain.reason) ? "needs_input" : "failed";
    return out(stage, brain.reason, { map, brain, questions: brain.needsInputQuestions,
      canary: { status: canaryDecision.status, reason: canaryDecision.reason, planSource: "none" } });
  }

  // 6. LEGACY compile (also the comparison artifact when an authorized canary is blocked).
  const legacy = compileMissions(brain.accepted, brain.model);
  if (!legacy.ok) {
    if ((legacy as { error?: string }).error) return out("failed", (legacy as { error?: string }).error!, { map, brain, allocation: legacy.allocation });
    return out("needs_input", legacy.allocation.reason, { map, brain, allocation: legacy.allocation, questions: [legacy.allocation.reason ?? "Increase the budget to fund a meaningful plan."] });
  }

  if (canaryDecision.status === "blocked") {
    // An AUTHORIZED canary founder whose grounded plan failed a strict condition. Per policy: preserve legacy
    // for comparison, mark canary blocked, and do NOT silently launch legacy — require explicit manual handling.
    return out("failed", `canary_blocked:${canaryDecision.reason}`, { map, brain, allocation: legacy.allocation,
      canary: { status: "blocked", reason: canaryDecision.reason, planSource: "none", planDigest: legacy.plan.missionPlanDigest } });
  }

  // disabled | unauthorized → legacy proceeds exactly as before.
  stamp("ready");
  return out("ready", null, { map, brain, allocation: legacy.allocation, plan: legacy.plan, questions: brain.needsInputQuestions,
    canary: { status: canaryDecision.status, reason: canaryDecision.reason, planSource: "legacy" } });
}
