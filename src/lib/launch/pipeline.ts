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
import { buildProductMap, scopeFromObservations } from "./product-map";
import { buildObservationCorpus } from "./validate-mission";
import { runMissionBrain, type MissionBrainResult } from "./mission-brain";
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
  opts: { inspectionId?: string } = {},
): Promise<LaunchResult> {
  const trail: { stage: LaunchStage; at: number }[] = [];
  const stamp = (stage: LaunchStage) => {
    trail.push({ stage, at: now > 0 ? now : Math.floor(Date.now() / 1000) });
    onStage(stage);
  };
  const out = (stage: LaunchStage, reason: string | null, partial: Partial<LaunchResult> = {}): LaunchResult => ({
    stage, reason, map: null, brain: null, allocation: null, plan: null, questions: [], trail, ...partial,
  });

  // 1. inspect the real product (bounded + SSRF-guarded).
  stamp("fetching");
  const inspection = await inspectProduct(input.productUrl, {}, now);

  // 1b. FIELD TEST (flag-gated): actually browse the product in a real headless browser and
  //     capture what a real visit reveals. FULLY failure-isolated — any error/timeout degrades
  //     to an honest limitation and the pipeline proceeds exactly as an HTML-only run would. It
  //     needs an inspectionId to name its screenshot artifacts (only the durable job supplies one).
  let fieldTest: FieldTestSummary | null = null;
  if (fieldTestEnabled() && opts.inspectionId && inspection.observations.length > 0) {
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
  // fold the inspector + repo limitations into the map's honest limitations.
  map.limitations = [...new Set([...map.limitations, ...inspection.limitations, ...(repo.reason ? [`Repository: ${repo.reason}`] : [])])];

  if (map.pagesInspected === 0) {
    return out("needs_input", "no_inspected_pages", { map, questions: map.openQuestions });
  }

  // 4. real LLM mission brain (architect → critic → deterministic gate).
  stamp("generating_missions");
  const scope = scopeFromObservations(inspection.observations, repo.artifacts);
  // the observation corpus is every string Sage actually observed — the anchor gate matches each
  // mission's claimed anchors against it, so nothing can be invented from scraps.
  const corpus = buildObservationCorpus(inspection.observations, map.fieldTest);
  const brain = await runMissionBrain(map, input, scope, corpus);
  stamp("reviewing");
  if (!brain.ok) {
    // a provider/parse/config failure is a RETRYABLE failure; exhausting the deterministic gate after a
    // corrective round, OR too-thin observation, is a needs_input (Sage asks rather than confabulates).
    const NEEDS_INPUT = new Set(["no_missions_passed_validation", "insufficient_observation"]);
    const stage: LaunchStage = brain.reason && NEEDS_INPUT.has(brain.reason) ? "needs_input" : "failed";
    return out(stage, brain.reason, { map, brain, questions: brain.needsInputQuestions });
  }

  // 5. exact budget allocation over the accepted missions.
  const allocation = allocateBudget(
    brain.accepted.map((m) => ({
      missionKey: m.missionKey,
      weight: m.rewardWeight,
      suggestedMaxCompletions: m.maxCompletions,
      priority: m.priority,
      effortMinutes: m.effortMinutes,
    })),
    input.totalBudgetBase,
  );
  if (!allocation.ok) {
    return out("needs_input", allocation.reason, { map, brain, allocation, questions: [allocation.reason ?? "Increase the budget to fund a meaningful plan."] });
  }

  // 6. compile to canonical MissionSpecV1 + CampaignVaultV2 hashes.
  const compiled = compilePlan({
    publicCampaignId,
    productMapDigest: map.digest,
    missions: brain.accepted,
    allocation,
    tokenDecimals: input.tokenDecimals,
    modelVersion: brain.model,
    promptVersion: MISSION_PROMPT_VERSION,
    revision: 1,
  });
  if (!compiled.ok) {
    return out("failed", compiled.error, { map, brain, allocation });
  }

  stamp("ready");
  return out("ready", null, { map, brain, allocation, plan: compiled.plan, questions: brain.needsInputQuestions });
}
