import "server-only";

import type { Hex } from "viem";
import { allocateBudget, TANGIBLE_MIN_REWARD_BASE } from "./budget";
import { compilePlan } from "./plan";
import type { CandidateMission, CompiledMission, MissionPlanV1, MissionPriority } from "./schemas";
import { offerProblem, placesFor } from "@/lib/test-page/offer-shape";

/**
 * THE OFFER, COMPILED (relaunch, 20 Nov 2026): "10 people, $2.00 each" turned into a plan revision.
 *
 * No model is asked and no word of a mission changes. Only two numbers move, the places and the
 * reward, and the plan goes through the SAME allocator and compiler every plan goes through:
 *
 *   - every mission gets the same weight and the places are split evenly, the most important mission
 *     first, so the allocator's own arithmetic gives every place exactly `eachBase`;
 *   - the total is `people × eachBase` in whole base units; the allocator asserts
 *     Σ(reward × places) === total before it answers, and `compilePlan` asserts it again;
 *   - then this file checks the answer is what was asked (every reward equal to `eachBase`, the places
 *     adding up to `people`) and refuses otherwise. A plan nobody asked for is never saved.
 *
 * What a mission says, how it is verified and what Sage saw are carried over untouched, so the spec a
 * tester reads is the one Sage wrote.
 */
export interface OfferInput {
  people: number;
  eachBase: bigint;
  /** "unlisted" = only people the builder invites; "listed" = anyone. Absent keeps the plan's own. */
  visibility?: "listed" | "unlisted";
}

export type OfferResult = { ok: true; plan: MissionPlanV1 } | { ok: false; error: string };

const RANK: Record<MissionPriority, number> = { high: 0, medium: 1, low: 2 };

/** The allocator's own order when every weight is equal: priority, then key. */
function inCompilerOrder(missions: readonly CompiledMission[]): CompiledMission[] {
  return [...missions].sort((a, b) => RANK[a.priority] - RANK[b.priority] || (a.missionKey < b.missionKey ? -1 : a.missionKey > b.missionKey ? 1 : 0));
}

/** A compiled mission as the compiler's input again, with nothing about the work changed. */
function asCandidate(m: CompiledMission, places: number): CandidateMission {
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
    rewardWeight: 1,
    maxCompletions: places,
    verificationMethod: m.verificationMethod,
    confidence: 0.8,
    assumptions: [],
    disallowed: [],
    ...(m.anchors ? { anchors: m.anchors } : {}),
    ...(m.verifiabilityClass ? { verifiabilityClass: m.verifiabilityClass } : {}),
    ...(m.verificationContract ? { verificationContract: m.verificationContract } : {}),
  };
}

export function offerPlan(
  current: MissionPlanV1,
  offer: OfferInput,
  opts: { productMapDigest: Hex; model?: string | null; promptVersion: string; revision: number },
): OfferResult {
  // a grant's tranches and a gig's price are the founder's own figures: this door never re-cuts them
  if (current.campaignKind && current.campaignKind !== "testing") return { ok: false, error: "Only a test's people and reward can be changed here." };
  const problem = offerProblem(offer.people, Number(offer.eachBase), current.missions.length);
  if (problem) return { ok: false, error: problem };

  const order = inCompilerOrder(current.missions);
  const places = placesFor(offer.people, order.map((m) => m.missionKey));
  const candidates = order.map((m, i) => asCandidate(m, places[i]));
  const total = BigInt(offer.people) * offer.eachBase;

  const allocation = allocateBudget(
    candidates.map((c) => ({ missionKey: c.missionKey, weight: 1, suggestedMaxCompletions: c.maxCompletions, priority: c.priority, effortMinutes: c.effortMinutes })),
    total,
    { minRewardBase: TANGIBLE_MIN_REWARD_BASE },
  );
  if (!allocation.ok) return { ok: false, error: allocation.reason ?? "That offer could not be compiled." };

  // the answer must be the question: every place pays `eachBase`, and the places add up to `people`
  const asked =
    allocation.missions.length === candidates.length &&
    allocation.missions.every((m) => m.rewardBase === offer.eachBase) &&
    allocation.missions.reduce((s, m) => s + m.maxCompletions, BigInt(0)) === BigInt(offer.people) &&
    allocation.allocatedBase === total;
  if (!asked) return { ok: false, error: "That offer doesn't divide evenly across this test's missions. Try another number of people." };

  const compiled = compilePlan({
    publicCampaignId: current.publicCampaignId,
    productMapDigest: opts.productMapDigest,
    missions: candidates,
    allocation,
    tokenDecimals: current.tokenDecimals,
    modelVersion: opts.model ?? current.modelVersion,
    promptVersion: opts.promptVersion,
    revision: opts.revision,
  });
  if (!compiled.ok) return { ok: false, error: compiled.error };

  const visibility = offer.visibility ?? current.visibility;
  return {
    ok: true,
    plan: {
      ...compiled.plan,
      // what the compiler does not know about and the plan must keep
      ...(current.campaignKind ? { campaignKind: current.campaignKind } : {}),
      ...(current.allowlist ? { allowlist: current.allowlist } : {}),
      ...(visibility ? { visibility } : {}),
    },
  };
}
