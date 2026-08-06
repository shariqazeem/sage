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
import {
  buildProductMap,
  hasUsableInspection,
  scopeFromObservations,
} from "./product-map";
import { buildObservationCorpus } from "./validate-mission";
import { runMissionBrain, type MissionBrainResult } from "./mission-brain";
import { inspectionReplayMode, runReplayShadow } from "./inspection-replay";
import { missionGroundingMode } from "./mission-grounding-shadow";
import { mergeObservationSets, stateDigest } from "./observed-facts";
import {
  compileGoalJourney,
  evaluateJourney,
  bindJourneyToContext,
  buildJourneySteps,
  journeyGapQuestion,
  describeJourneyWall,
  type GoalJourneyV1,
} from "./goal-journey";
import { buildProductContext, derivePhases } from "./product-context";
import {
  canaryPlanCommitment,
  evaluateCanarySelection,
  type CanaryIdentity,
} from "./mission-canary";
import { compileVerificationPolicyV2 } from "./mission-probe-v2";
import { allocateBudget, MIN_REWARD_BASE } from "./budget";
import { applySamplePolicy, splitCompletionsForSample } from "./sample-policy";
import { compilePlan } from "./plan";
import { MISSION_PROMPT_VERSION } from "./mission-prompt";
import type {
  BudgetAllocation,
  FieldTestSummary,
  FounderLaunchInput,
  MissionPlanV1,
  ProductMapV1,
} from "./schemas";

/**
 * ZERO-INPUT LAUNCH — the goal Sage plans against when the founder gave none (or a generic
 * "test my site"). DELIBERATELY a fixed string with no observed product text: the goal line is
 * presented to the architect as TRUSTED founder context, so composing it from untrusted page
 * content would open an injection channel. It names no producing verb, so a content site keeps
 * its crawl (and its url-verifiable mission) while a real app still classifies interactive from
 * its own signals. The founder's actual words, when specific, always win.
 */
export const DEFAULT_FIRST_VISIT_GOAL =
  "Verify a first-time visitor understands what this product is and can experience its primary flow, reporting specifically what they saw and did.";

/** A goal too thin/generic to plan against — Sage infers instead of asking. */
const GENERIC_GOAL_RE =
  /^(please\s+)?(test|check|try|validate|review|explore|inspect|evaluate)(\s+out)?(\s+(the|my|our|this))?(\s+(product|app|site|website|page|it|this))?\s*[.!]*$/i;

export function isThinGoal(goal: string | null | undefined): boolean {
  const g = (goal ?? "").replace(/\s+/g, " ").trim();
  return g.length < 12 || GENERIC_GOAL_RE.test(g);
}

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
  /** the immutable VerificationPolicyV2 compiled for the selected grounded plan (selected only). */
  verificationPolicy?: unknown | null;
  verificationPolicyDigest?: string | null;
  /** true when the plan has ≥1 action criterion → autonomous payout requires complete replay coverage. */
  verificationPolicyRequired?: boolean;
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
  opts: {
    inspectionId?: string;
    replayDeps?: {
      allowLoopback?: ReadonlySet<string>;
      egressAllowedPorts?: ReadonlySet<number>;
    };
    canaryIdentity?: CanaryIdentity | null;
    /** What EARLIER runs of this same job already observed. Unioned into this run's set, so a retry
     *  or a founder's clarification can only ever widen the evidence, never narrow it. */
    priorObservations?: import("./observed-facts").ObservationSetV1 | null;
  } = {},
): Promise<LaunchResult> {
  // ONE INTENT, ZERO FORMS AFTER IT — and zero MANDATORY forms before it either. A founder who gave
  // only a URL + budget still gets a real plan: Sage plans for the first visit and says so on the map.
  const goalInferred = isThinGoal(input.goal);
  if (goalInferred) input = { ...input, goal: DEFAULT_FIRST_VISIT_GOAL };

  const trail: { stage: LaunchStage; at: number }[] = [];
  const stamp = (stage: LaunchStage) => {
    trail.push({ stage, at: now > 0 ? now : Math.floor(Date.now() / 1000) });
    onStage(stage);
  };
  const out = (
    stage: LaunchStage,
    reason: string | null,
    partial: Partial<LaunchResult> = {},
  ): LaunchResult => ({
    stage,
    reason,
    map: null,
    brain: null,
    allocation: null,
    plan: null,
    questions: [],
    trail,
    canary: null,
    ...partial,
  });

  // 1. inspect the real product (bounded + SSRF-guarded).
  stamp("fetching");
  const inspection = await inspectProduct(input.productUrl, {}, now);

  // 1b. FIELD TEST (flag-gated): actually browse the product in a real headless browser and
  //     capture what a real visit reveals. FULLY failure-isolated — any error/timeout degrades
  //     to an honest limitation and the pipeline proceeds exactly as an HTML-only run would. It
  //     needs an inspectionId to name its screenshot artifacts (only the durable job supplies one).
  let fieldTest: FieldTestSummary | null = null;
  let goalJourney: GoalJourneyV1 | null = null;
  let goalJourneyQuestion: string | null = null;
  // Run the browser when static HTML yielded observations, OR when the site RESPONDED but every page
  // was blocked/challenged/empty. Client-rendered SPAs and bot-walled products (commercial stores,
  // news, anything behind a WAF) return ZERO static observations to our read-only UA — the real
  // headless browser is exactly the tool that can see them. A genuinely-dead URL (DNS failure, hard
  // 404) just makes the failure-isolated field test return null, so the needs_input path is unchanged.
  const reachedButThin =
    inspection.observations.length === 0 && inspection.blocked.length > 0;
  if (
    fieldTestEnabled() &&
    opts.inspectionId &&
    (inspection.observations.length > 0 || reachedButThin)
  ) {
    // A REAL stage — emitted only when the browser phase actually runs (no fake timers). Off-path
    // this stamp never fires, so the stage sequence stays identical to today.
    stamp("field_test");
    // ORDERED FOUNDER GOAL — compile the request into required checkpoints BEFORE browsing, so the
    // controller pursues the next UNMET one (never an entity merely named during onboarding). A null
    // journey (model unconfigured / unusable output) degrades to the previous behavior exactly.
    try {
      goalJourney = await compileGoalJourney(
        typeof input.goal === "string" ? input.goal : "",
      );
    } catch {
      goalJourney = null;
    }
    try {
      fieldTest = await runFieldTest({
        inspectionId: opts.inspectionId,
        startUrl: inspection.startUrl,
        host: inspection.host,
        candidateLinks: rankPrimaryLinks(
          inspection.observations,
          inspection.host,
          inspection.startUrl,
          5,
        ),
        // the founder's exact goal drives the goal-directed browser controller (reach the goal, not decorations).
        goal: typeof input.goal === "string" ? input.goal : undefined,
        journey: goalJourney,
      });
    } catch {
      fieldTest = null;
    }
  }

  // 2. optional repository (honest degradation).
  let repo = {
    artifacts: [] as Awaited<ReturnType<typeof inspectRepo>>["artifacts"],
    reason: null as string | null,
  };
  if (input.repoUrl) {
    stamp("analyzing");
    repo = await inspectRepo(input.repoUrl);
  }

  // 3. deterministic product map (+ field-test evidence when present).
  stamp("mapping");
  const map = buildProductMap(
    inspection.observations,
    repo.artifacts,
    input,
    fieldTest,
  );
  // CARRY WHAT EARLIER LOOKS ALREADY SAW. Re-running is a lottery — measured across production, the
  // same url and goal yielded anywhere from 0 to 36 states and 0 to 301 facts on different runs — so
  // replacing the set on every run means a founder who answers Sage's clarifying question can be
  // handed a thinner plan than the one that prompted the question. Ids are content-derived, so this
  // union is idempotent and can only widen the evidence.
  if (opts.priorObservations) {
    const merged = mergeObservationSets(opts.priorObservations, map.observations ?? null);
    if (merged && (merged.facts.length > 0 || merged.transitions.length > 0)) map.observations = merged;
  }
  // EVALUATE the founder's ordered journey against what was ACTUALLY observed — deterministic and
  // evidence-cited (fact/transition ids), so a checkpoint can never be completed by text similarity.
  // Attached post-digest like `observations`, so hashes and old artifacts are unchanged.
  if (goalJourney && fieldTest?.states?.length) {
    const obs = map.observations ?? null;
    const stateIds = fieldTest.states.map((s) => stateDigest(s));
    // PRODUCT CONTEXT — which phase each state belongs to, and every entity OCCURRENCE with its own id.
    const productContext = buildProductContext(fieldTest.states, stateIds);
    const phases = derivePhases(fieldTest.states);
    // BIND the journey to that context: the phase each requirement must hold in + the specific occurrence
    // it refers to, so an onboarding mention can never satisfy an in-world requirement.
    const bound = bindJourneyToContext(goalJourney, productContext);
    goalJourneyQuestion = bound.question;
    const steps = buildJourneySteps(
      fieldTest.states,
      obs?.facts ?? [],
      obs?.transitions ?? [],
      stateIds,
    ).map((st, i) => ({
      ...st,
      phase: phases[i],
      actedEntityId:
        productContext.entities.find(
          (e) =>
            e.stateIndex === i &&
            e.label.toLowerCase() === (st.actedLabel ?? "").toLowerCase(),
        )?.entityId ?? null,
    }));
    goalJourney = evaluateJourney(bound.journey, steps);
    map.goalJourney = goalJourney;
    map.productContext = productContext;
  }
  // fold the inspector + repo limitations into the map's honest limitations — CONDITION-AWARE: when
  // the Field Test actually explored the live product, the "server-rendered HTML only" caveat is no
  // longer true (a client-side flow WAS observed), so drop it and describe the real boundary instead.
  const explored = !!(
    fieldTest?.ran &&
    (fieldTest.pages.length > 0 || fieldTest.states.length > 0)
  );
  const inspectorLimitations = explored
    ? inspection.limitations.filter(
        (l) => !/server-rendered HTML only/i.test(l),
      )
    : inspection.limitations;
  const explorationNote = explored
    ? [
        "Sage explored the live product in a real browser; anything behind a login, or a specific interaction Sage didn't perform, may still be under-observed.",
      ]
    : [];
  map.limitations = [
    ...new Set([
      ...map.limitations,
      ...inspectorLimitations,
      ...explorationNote,
      ...(goalInferred
        ? ["No specific goal was given, so Sage planned for a first-time visitor's primary flow — state a goal to steer the missions."]
        : []),
      ...(repo.reason ? [`Repository: ${repo.reason}`] : []),
    ]),
  ];

  // Only ask "we couldn't inspect anything" when NEITHER the static crawl NOR the real browser saw a
  // thing. A bot-walled or client-rendered product yields 0 static pages but a rich field test — that
  // is a READY product, not a needs_input (the mission corpus below is built from the field test).
  // `hasUsableInspection` is the shared predicate the mission brain gate uses too, so they can't drift.
  if (!hasUsableInspection(map)) {
    return out("needs_input", "no_inspected_pages", {
      map,
      questions: map.openQuestions,
    });
  }

  // 3b. Eyes V2 — OPTIONAL shadow replay of a safe observed transition (INSPECTION_REPLAY_MODE=shadow;
  // default off → this whole block is a no-op and the artifact is byte-identical). Re-performs an action
  // Sage already saw, through the C4 guarded egress boundary, and attaches leak-safe result codes to the
  // inspection artifact. It NEVER affects payout or mission acceptance; a replay failure never fails the
  // inspection (best-effort, fully caught).
  if (map.observations && inspectionReplayMode() === "shadow") {
    try {
      const replay = await runReplayShadow(
        map.observations,
        opts.inspectionId ?? "inspection",
        { maxProbes: 2, ...opts.replayDeps },
      );
      if (replay.ran)
        map.replayShadow = {
          version: "replay-shadow-v1",
          mode: "shadow",
          probes: replay.probes,
          byClassification: replay.byClassification,
          results: replay.records,
        };
    } catch {
      /* replay is best-effort telemetry; it can never fail the inspection */
    }
  }

  // 4. real LLM mission brain (architect → critic → deterministic gate).
  stamp("generating_missions");
  // The scope includes the FIELD TEST's really-visited pages/states, so a bot-walled or client-rendered
  // product (0 static observations, rich browser exploration) still has a non-empty validation scope —
  // without it, every mission on such a product failed `target_out_of_scope` before anyone saw it.
  const scope = scopeFromObservations(inspection.observations, repo.artifacts, map.fieldTest);
  // the observation corpus is every string Sage actually observed — the anchor gate matches each
  // mission's claimed anchors against it, so nothing can be invented from scraps.
  const corpus = buildObservationCorpus(inspection.observations, map.fieldTest);
  const brain = await runMissionBrain(map, input, scope, corpus);
  stamp("reviewing");
  // compile a candidate mission set → exact allocation → canonical MissionPlanV1 (MissionSpecV1 + vault hashes).
  // Used identically for the legacy plan and (under canary) the grounded plan, so both traverse the SAME
  // deterministic allocator + compiler. No model computes money; allocateBudget owns the base-unit amounts.
  const compileMissions = (
    missions: typeof brain.accepted,
    modelVersion: string,
  ) => {
    const allocation = allocateBudget(
      missions.map((m) => ({
        missionKey: m.missionKey,
        weight: m.rewardWeight,
        suggestedMaxCompletions: m.maxCompletions,
        priority: m.priority,
        effortMinutes: m.effortMinutes,
      })),
      input.totalBudgetBase,
    );
    if (!allocation.ok) return { ok: false as const, allocation, plan: null };
    // TESTER SAMPLE — a plural, qualitative request buys independent completions rather than one big
    // payout. The allocator's exactness strategy hands the balancer a single completion worth the whole
    // remainder; this re-expresses that same pot as N testers (rewardBase × maxCompletions unchanged,
    // never below the meaningful floor, never a rounding change), so the exact-allocation invariant holds.
    const sample = applySamplePolicy(
      missions.map((m) => ({
        missionKey: m.missionKey,
        maxCompletions: m.maxCompletions,
        rewardWeight: m.rewardWeight,
        qualitative: m.verifiabilityClass !== "url-verifiable",
        effortMinutes: m.effortMinutes, // arms the effort-anchored reward ceiling
      })),
      {
        goal: input.goal,
        totalBudgetBase: input.totalBudgetBase,
        minRewardBase: MIN_REWARD_BASE,
      },
    );
    allocation.missions = splitCompletionsForSample(
      allocation.missions,
      new Map(sample.missions.map((m) => [m.missionKey, m.maxCompletions])),
      MIN_REWARD_BASE,
    );
    const compiled = compilePlan({
      publicCampaignId,
      productMapDigest: map.digest,
      missions,
      allocation,
      tokenDecimals: input.tokenDecimals,
      modelVersion,
      promptVersion: MISSION_PROMPT_VERSION,
      revision: 1,
    });
    if (!compiled.ok)
      return {
        ok: false as const,
        allocation,
        plan: null,
        error: compiled.error,
      };
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
    const g = compileMissions(
      canaryDecision.plan.missions,
      canaryDecision.plan.architectModel ?? brain.model,
    );
    if (!g.ok || !g.plan)
      return out(
        "failed",
        `canary_compile_failed:${(g as { error?: string }).error ?? g.allocation.reason ?? "unknown"}`,
        {
          map,
          brain,
          allocation: g.allocation,
          canary: {
            status: "blocked",
            reason: "compile_failed",
            planSource: "none",
          },
        },
      );
    if (g.plan.allocatedBase !== input.totalBudgetBase)
      return out("failed", "canary_budget_not_exact", {
        map,
        brain,
        allocation: g.allocation,
        canary: {
          status: "blocked",
          reason: "budget_not_exact",
          planSource: "none",
        },
      });
    const commitment = canaryPlanCommitment({
      planDigest: g.plan.missionPlanDigest,
      budgetText: `${input.totalBudgetBase} base units @ ${input.tokenDecimals}dp`,
      budgetBase: g.plan.totalBudgetBase.toString(),
      revision: g.plan.revision,
    });
    const gp = canaryDecision.plan;
    const provenance: GroundedSelectionProvenance = {
      planSource: "grounded_v2",
      architectModel: gp.architectModel,
      architectProvider: gp.architectProvider,
      architectContractVersion: gp.architectContractVersion,
      criticModel: gp.criticModel,
      criticProvider: gp.criticProvider,
      criticContractVersion: gp.criticContractVersion,
      observationSetDigest: gp.observationSetDigest,
      groundedPlanDigest: canaryDecision.groundedDigest,
      missionPlanDigest: g.plan.missionPlanDigest,
    };
    // compile the VerificationPolicyV2 for the selected grounded plan. `policyRequired` = the plan has ≥1
    // action criterion (autonomous payout then needs COMPLETE replay coverage). An incomplete required policy
    // BLOCKS autonomous selection: the grounded plan may be shown, but a self-canary plan is never selectable
    // for autonomous payout unless coverage is exact (defect #3).
    const replayReproduced = new Set(
      (map.replayShadow?.results ?? [])
        .filter((r) => r.classification === "reproduced")
        .map((r) => r.transitionId),
    );
    const compiled = map.observations
      ? compileVerificationPolicyV2({
          missionPlanDigest: g.plan.missionPlanDigest,
          productMapDigest: map.digest,
          set: map.observations,
          missions: canaryDecision.plan.missions,
          replayReproduced,
          scope,
        })
      : null;
    const policyRequired =
      !!compiled && compiled.policy.actionCriteria.length > 0;
    if (policyRequired && compiled && !compiled.complete) {
      return out("failed", "canary_blocked:incomplete_action_policy", {
        map,
        brain,
        allocation: g.allocation,
        canary: {
          status: "blocked",
          reason: "incomplete_action_policy",
          planSource: "none",
          planDigest: g.plan.missionPlanDigest,
        },
      });
    }
    stamp("ready");
    return out("ready", null, {
      map,
      brain,
      allocation: g.allocation,
      plan: g.plan,
      questions: brain.needsInputQuestions,
      canary: {
        status: "selected",
        reason: null,
        planSource: "grounded_v2",
        groundedDigest: canaryDecision.groundedDigest,
        planDigest: g.plan.missionPlanDigest,
        planCommitment: commitment.commitment,
        wallet: canaryDecision.wallet,
        provenance,
        // ATTACH A POLICY ONLY WHEN IT GOVERNS SOMETHING. `verifyReplayPermit` treats "a policy
        // exists while required=false" as an inconsistent covenant and FAILS CLOSED — correctly, since
        // it cannot tell a deliberate state from a corrupted one. But a plan with zero action criteria
        // compiles a VACUOUS policy (actionCriteria: [], probes: []) that proves nothing and gates
        // nothing, and attaching it froze the campaign's payouts permanently.
        //
        // Measured on `launch-yara-garden-cerk8k`: a real tester's account PASSED the observation bar
        // (5 of 9 distinct sources) and was still held, every sweep, on
        // `action_replay_permit_denied:inconsistent:policy_without_required`. A client-side product has
        // no safe GET transitions, so it compiles exactly this empty policy — meaning the whole class
        // of observation-only campaigns could never pay anyone.
        //
        // The invariant the permit relies on is now maintained at the source: a policy is stored if and
        // only if it is required. Nothing about the covenant is loosened — a policy that DOES carry
        // action criteria is attached and required exactly as before.
        verificationPolicy: policyRequired ? (compiled?.policy ?? null) : null,
        verificationPolicyDigest: policyRequired ? (compiled?.policy.policyDigest ?? null) : null,
        verificationPolicyRequired: policyRequired,
      },
    });
  }

  // canary not selected → the LEGACY plan governs. A legacy generation failure is retryable (provider/parse)
  // or a needs_input (gate exhausted / too thin). The canary status is carried for observability.
  if (!brain.ok) {
    const NEEDS_INPUT = new Set([
      "no_missions_passed_validation",
      "insufficient_observation",
    ]);
    const stage: LaunchStage =
      brain.reason && NEEDS_INPUT.has(brain.reason) ? "needs_input" : "failed";
    return out(stage, brain.reason, {
      map,
      brain,
      questions: brain.needsInputQuestions,
      canary: {
        status: canaryDecision.status,
        reason: canaryDecision.reason,
        planSource: "none",
      },
    });
  }

  // 6. LEGACY compile (also the comparison artifact when an authorized canary is blocked).
  const legacy = compileMissions(brain.accepted, brain.model);
  if (!legacy.ok) {
    if ((legacy as { error?: string }).error)
      return out("failed", (legacy as { error?: string }).error!, {
        map,
        brain,
        allocation: legacy.allocation,
      });
    return out("needs_input", legacy.allocation.reason, {
      map,
      brain,
      allocation: legacy.allocation,
      questions: [
        legacy.allocation.reason ??
          "Increase the budget to fund a meaningful plan.",
      ],
    });
  }

  // ORDERED FOUNDER GOAL — when the browser did not complete the founder's journey (or the plan covers
  // only prerequisites), the honest answer is that MORE INSPECTION is needed, not an onboarding mission
  // presented as the answer to what they actually asked for. Reported with the bounded rejection codes.
  // The founder asked about multiple users but the budget cannot pay a meaningful sample → ASK, rather
  // than silently selecting a single tester.
  const sampleQuestion =
    brain.groundingShadow?.sampleQuestion ??
    brain.groundingShadow?.goalCompilerQuestion;
  if (sampleQuestion) {
    return out("needs_input", "sample_budget_insufficient", {
      map,
      brain,
      allocation: legacy.allocation,
      questions: [sampleQuestion],
    });
  }

  const journeyGap = brain.groundingShadow as
    | { journeyCoverageOk?: boolean; journeyRejectionCodes?: string[] }
    | undefined;
  if (
    goalJourney &&
    journeyGap &&
    journeyGap.journeyCoverageOk === false &&
    canaryDecision.status === "blocked"
  ) {
    const codes = [...new Set(journeyGap.journeyRejectionCodes ?? [])];
    const missing = goalJourney.checkpoints.filter(
      (c) => c.status !== "observed",
    );
    const observed = goalJourney.checkpoints.filter(
      (c) => c.status === "observed",
    );

    // PLAN WHAT SAGE COULD SEE. A wall Sage cannot cross — a wallet, a login, a payment — is a
    // statement about SAGE, not about whether the work is worth testing. A human tester connects
    // their own wallet trivially; Sage just cannot witness it. Sending the founder away empty
    // because the last mile was gated wastes the part it DID verify, and asking them to restate a
    // goal they already gave is the least useful thing an agent can do.
    //
    // So when Sage genuinely observed part of the founder's journey and has a validated plan for
    // it, that plan is offered — with the boundary named, never hidden. Nothing about the covenant
    // moves: this plan is the legacy one, marked as such, and the grounded canary stays BLOCKED, so
    // an ungrounded plan is still never dressed up as a grounded one.
    // Two different walls, one answer. ACCESS — Sage never found the thing, because it sits behind a
    // wallet, a login, a payment. EFFORT — Sage FOUND it and could not finish it inside one short
    // visit. Only the first is a limit on what is knowable; the second is a limit on Sage's hands and
    // its clock. Neither says the work isn't worth testing, and a human tester walks through both.
    //
    // Treating the effort wall as a dead end was the bug: Sage would browse a product thoroughly,
    // learn exactly how it works, and then refuse to plan because it couldn't personally complete the
    // last step — then ask the founder to restate a goal they had already stated plainly.
    if (observed.length > 0 && legacy.plan.missions.length > 0) {
      const { boundary, unreachable } = describeJourneyWall(missing);
      map.limitations = [
        ...new Set([
          ...map.limitations,
          `Sage explored the product but did not complete every part of the goal itself: ${boundary}. These missions cover what it verified first-hand.`,
        ]),
      ];
      stamp("ready");
      return out("ready", null, {
        map,
        brain,
        allocation: legacy.allocation,
        plan: legacy.plan,
        questions: [
          `These missions cover what Sage verified itself. It did not finish ${unreachable.length === 1 ? "this part" : "these parts"} of your request — ${unreachable.join("; ")} — because ${boundary}. A human tester can still do it; Sage just can't witness it, so that part holds for your approval instead of paying out automatically.`,
        ],
        canary: {
          status: "blocked",
          reason: `founder_goal_partial:${codes.join(",") || "uncovered"}`,
          planSource: "legacy",
          planDigest: legacy.plan.missionPlanDigest,
        },
      });
    }

    return out("needs_input", "founder_goal_incomplete", {
      map,
      brain,
      allocation: legacy.allocation,
      questions: [
        ...(goalJourneyQuestion ? [goalJourneyQuestion] : []),
        // An ACCESS gap and an EFFORT gap need different questions — see `journeyGapQuestion`.
        ...missing.slice(0, 4).map(journeyGapQuestion),
        ...(missing.length === 0
          ? [
              "Sage observed your whole journey but could not design a mission that proves the outcome you asked for. Can you describe what a successful result looks like?",
            ]
          : []),
      ],
      canary: {
        status: "blocked",
        reason: `founder_goal_incomplete:${codes.join(",") || "uncovered"}`,
        planSource: "none",
        planDigest: legacy.plan.missionPlanDigest,
      },
    });
  }

  if (canaryDecision.status === "blocked") {
    // An AUTHORIZED canary founder whose grounded plan failed a strict condition. The covenant holds —
    // an ungrounded plan is NEVER presented as fundable. But a DEAD END is not the covenant, it is just
    // a dead end: the founder waited minutes and got "couldn't finish", with nothing to do about it.
    // This was 5 of the 8 hard failures in a week. So it asks instead, naming what Sage could not
    // establish, and the answer re-plans through the normal clarify path.
    return out("needs_input", `canary_blocked:${canaryDecision.reason}`, {
      map,
      brain,
      allocation: legacy.allocation,
      questions: [
        "Sage explored your product but couldn't tie a mission to something it saw happen, so it won't hand you a plan it can't stand behind.",
        `What should a tester DO in your product, and what should be on screen once they've done it? Name the screen or the result Sage should look for${map.productName && map.productName !== "the product" ? ` in ${map.productName}` : ""}.`,
        ...(map.openQuestions ?? []).slice(0, 1),
      ],
      canary: {
        status: "blocked",
        reason: canaryDecision.reason,
        planSource: "none",
        planDigest: legacy.plan.missionPlanDigest,
      },
    });
  }

  // disabled | unauthorized → legacy proceeds exactly as before.
  stamp("ready");
  return out("ready", null, {
    map,
    brain,
    allocation: legacy.allocation,
    plan: legacy.plan,
    // A READY plan carries the map's ADVISORY open questions, never the brain's needs-input ones.
    // Those are written for a run that could NOT design missions ("Sage couldn't get far enough into
    // your product…") and handing them to a founder alongside a working plan contradicts the plan
    // itself — the fastest way to make a correct answer look untrustworthy.
    questions: map.openQuestions,
    canary: {
      status: canaryDecision.status,
      reason: canaryDecision.reason,
      planSource: "legacy",
    },
  });
}
