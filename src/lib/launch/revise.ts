import "server-only";

/**
 * Plan revision: apply founder edits to a mission plan, RE-VALIDATE deterministically,
 * RE-ALLOCATE the budget exactly, and RE-COMPILE the canonical hashes. Every edit thus
 * stays safe (the same quality gate), stays exactly on budget, and recomputes its
 * MissionSpecV1 digest — the founder can never save an unsafe, out-of-scope, or
 * over/under-budget mission. Pure server logic; the durable revision row is written by
 * the caller.
 */

import type { Hex } from "viem";
import { allocateBudget } from "./budget";
import { compilePlan } from "./plan";
import { validatePlanMissions, type ValidationScope } from "./validate-mission";
import { MIN_REWARD_BASE } from "./budget";
import type { CandidateMission, CompiledMission, MissionPlanV1, MissionValidationReport } from "./schemas";

export interface MissionEdit {
  missionKey: string;
  title?: string;
  objective?: string;
  instructions?: string;
  targetSurface?: string;
  criteria?: string[];
  evidenceRequirements?: string[];
  /** cap edit (the deterministic allocator owns per-completion rewards to stay exact). */
  maxCompletions?: number;
  /** remove this mission entirely. */
  remove?: boolean;
}

/** Rebuild a CandidateMission from a compiled one (+ a weight proxy for rebalancing). */
function toCandidate(m: CompiledMission): CandidateMission & { rewardWeight: number } {
  const weight = Math.max(1, Math.min(10, Math.round(Number(m.rewardBase) / Number(MIN_REWARD_BASE))));
  return {
    missionKey: m.missionKey,
    title: m.title,
    objective: m.objective,
    instructions: m.instructions,
    targetSurface: m.targetSurface,
    criteria: m.criteria,
    evidenceRequirements: m.evidenceRequirements,
    whyItMatters: m.whyItMatters,
    sources: m.sources,
    priority: m.priority,
    riskCategory: m.riskCategory,
    effortMinutes: m.effortMinutes,
    conditions: [],
    rewardWeight: weight,
    maxCompletions: Number(m.maxCompletions),
    verificationMethod: m.verificationMethod,
    confidence: 0.8,
    assumptions: [],
    disallowed: [],
  };
}

export type ReviseResult =
  | { ok: true; plan: MissionPlanV1 }
  | { ok: false; issues: MissionValidationReport[]; error?: string };

/**
 * Apply `edits` to `current`, revalidate + reallocate + recompile. `newBudgetBase`
 * overrides the total budget (a founder budget change). The result is always EXACTLY on
 * budget (the deterministic allocator) and passes the same identity self-check the live
 * payout uses. Returns per-mission validation reports when an edit is unsafe/out of scope.
 */
export function revisePlan(
  current: MissionPlanV1,
  edits: MissionEdit[],
  opts: {
    scope: ValidationScope;
    productMapDigest: Hex;
    model?: string | null;
    provider?: string | null;
    promptVersion: string;
    revision: number;
    newBudgetBase?: bigint;
  },
): ReviseResult {
  const editByKey = new Map(edits.map((e) => [e.missionKey, e]));

  // apply edits (or removal) to the current missions.
  const next: (CandidateMission & { rewardWeight: number })[] = [];
  for (const cm of current.missions) {
    const e = editByKey.get(cm.missionKey);
    if (e?.remove) continue;
    const c = toCandidate(cm);
    if (e) {
      if (e.title !== undefined) c.title = e.title;
      if (e.objective !== undefined) c.objective = e.objective;
      if (e.instructions !== undefined) c.instructions = e.instructions;
      if (e.targetSurface !== undefined) c.targetSurface = e.targetSurface;
      if (e.criteria !== undefined) c.criteria = e.criteria;
      if (e.evidenceRequirements !== undefined) c.evidenceRequirements = e.evidenceRequirements;
      if (e.maxCompletions !== undefined) c.maxCompletions = Math.max(1, Math.min(50, Math.floor(e.maxCompletions)));
    }
    next.push(c);
  }
  if (next.length === 0) return { ok: false, issues: [], error: "a plan must keep at least one mission" };

  // deterministic gate — an edited mission must pass exactly the rules a generated one does.
  const reports = validatePlanMissions(next, opts.scope);
  if (reports.some((r) => !r.ok)) return { ok: false, issues: reports.filter((r) => !r.ok) };

  // reallocate EXACTLY over the (possibly new) budget; rewards follow the weight proxy.
  const budget = opts.newBudgetBase ?? current.totalBudgetBase;
  const allocation = allocateBudget(
    next.map((m) => ({ missionKey: m.missionKey, weight: m.rewardWeight, suggestedMaxCompletions: m.maxCompletions, priority: m.priority, effortMinutes: m.effortMinutes })),
    budget,
  );
  if (!allocation.ok) return { ok: false, issues: [], error: allocation.reason ?? "budget could not be reallocated" };

  const compiled = compilePlan({
    publicCampaignId: current.publicCampaignId,
    productMapDigest: opts.productMapDigest,
    missions: next,
    allocation,
    tokenDecimals: current.tokenDecimals,
    modelVersion: opts.model ?? current.modelVersion,
    promptVersion: opts.promptVersion,
    revision: opts.revision,
  });
  if (!compiled.ok) return { ok: false, issues: [], error: compiled.error };
  return { ok: true, plan: compiled.plan };
}
