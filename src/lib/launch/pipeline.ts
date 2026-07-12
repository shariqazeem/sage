import "server-only";

/**
 * The founder-launch orchestration: a real HTTPS product URL (+ optional public repo)
 * → bounded safe inspection → deterministic ProductMapV1 → real LLM mission brain
 * (architect + critic) → deterministic quality gate → exact budget allocation →
 * canonical MissionPlanV1 (MissionSpecV1 + CampaignVaultV2 hashes). Every stage is
 * real; nothing is simulated. Returns a discriminated result the durable job + UI
 * render from. This module performs NO deployment, funding, or signing.
 */

import { inspectProduct } from "./inspect";
import { inspectRepo } from "./github";
import { buildProductMap, scopeFromObservations } from "./product-map";
import { runMissionBrain, type MissionBrainResult } from "./mission-brain";
import { allocateBudget } from "./budget";
import { compilePlan } from "./plan";
import { MISSION_PROMPT_VERSION } from "./mission-prompt";
import type { BudgetAllocation, FounderLaunchInput, MissionPlanV1, ProductMapV1 } from "./schemas";

export type LaunchStage =
  | "fetching"
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

  // 2. optional repository (honest degradation).
  let repo = { artifacts: [] as Awaited<ReturnType<typeof inspectRepo>>["artifacts"], reason: null as string | null };
  if (input.repoUrl) {
    stamp("analyzing");
    repo = await inspectRepo(input.repoUrl);
  }

  // 3. deterministic product map.
  stamp("mapping");
  const map = buildProductMap(inspection.observations, repo.artifacts, input);
  // fold the inspector + repo limitations into the map's honest limitations.
  map.limitations = [...new Set([...map.limitations, ...inspection.limitations, ...(repo.reason ? [`Repository: ${repo.reason}`] : [])])];

  if (map.pagesInspected === 0) {
    return out("needs_input", "no_inspected_pages", { map, questions: map.openQuestions });
  }

  // 4. real LLM mission brain (architect → critic → deterministic gate).
  stamp("generating_missions");
  const scope = scopeFromObservations(inspection.observations, repo.artifacts);
  const brain = await runMissionBrain(map, input, scope);
  stamp("reviewing");
  if (!brain.ok) {
    const stage: LaunchStage = brain.reason === "llm_not_configured" || brain.reason === "architect_failed" ? "failed" : "needs_input";
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
