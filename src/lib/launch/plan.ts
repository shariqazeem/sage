/**
 * The deterministic plan compiler. On founder approval, the accepted + validated
 * missions and the exact budget allocation are compiled into the SAME canonical
 * artifacts the CampaignVaultV2 pipeline already enforces — reusing the FROZEN
 * `campaignIdHash` / `missionIdHash` / `missionSpecDigest` / `computeCampaignPlan`.
 * The result is a `deployment_ready` MissionPlanV1 whose identity, spec digests, and
 * on-chain plan digest are internally consistent (it passes `verifyPublicIdentity`,
 * the same invariant that guards a live payout) and whose economics sum EXACTLY to the
 * budget. This module never deploys, funds, or signs — it only compiles + proves.
 */

import type { Hex } from "viem";

import { campaignIdHash, computeCampaignPlan, missionIdHash } from "@/lib/campaigns/mission-plan";
import { missionSpecDigest } from "@/lib/campaigns/mission-spec";
import { verifyPublicIdentity, type IdentityMission } from "@/lib/campaigns/public-identity";
import { classifyVerifiability } from "./validate-mission";
import type {
  BudgetAllocation,
  CandidateMission,
  CompiledMission,
  MissionPlanV1,
} from "./schemas";

export interface CompilePlanInput {
  /** the public campaign id (the DB primary key + slug); frozen on approval. */
  publicCampaignId: string;
  productMapDigest: Hex;
  /** the accepted, validated candidate missions (superset of the funded ones). */
  missions: CandidateMission[];
  /** the exact budget allocation; MUST be ok and its keys ⊆ `missions`. */
  allocation: BudgetAllocation;
  tokenDecimals: number;
  modelVersion: string;
  promptVersion: string;
  revision: number;
}

export type CompilePlanResult =
  | { ok: true; plan: MissionPlanV1 }
  | { ok: false; error: string; identityMismatches?: string[] };

/** Compile approved missions + allocation into a canonical, deployment-ready plan. */
export function compilePlan(input: CompilePlanInput): CompilePlanResult {
  if (!input.allocation.ok) return { ok: false, error: "budget allocation is not fundable" };
  if (input.allocation.missions.length === 0) return { ok: false, error: "no funded missions" };

  const byKey = new Map(input.missions.map((m) => [m.missionKey, m]));
  const funded = input.allocation.missions.map((a) => ({ alloc: a, mission: byKey.get(a.missionKey) }));
  if (funded.some((f) => !f.mission)) {
    return { ok: false, error: "budget allocation references a mission not in the accepted set" };
  }

  const cid = campaignIdHash(input.publicCampaignId);

  const compiled: CompiledMission[] = funded.map(({ alloc, mission }) => {
    const m = mission!;
    const mid = missionIdHash(input.publicCampaignId, m.missionKey);
    const specDigest = missionSpecDigest({
      campaignIdHash: cid,
      missionIdHash: mid,
      title: m.title,
      objective: m.objective,
      instructions: m.instructions,
      targetSurface: m.targetSurface,
      criteria: m.criteria,
      evidenceRequirements: m.evidenceRequirements,
      rewardBase: alloc.rewardBase,
      maxCompletions: alloc.maxCompletions,
    });
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
      riskCategory: m.riskCategory,
      priority: m.priority,
      effortMinutes: m.effortMinutes,
      rewardBase: alloc.rewardBase,
      maxCompletions: alloc.maxCompletions,
      verificationMethod: m.verificationMethod,
      anchors: m.anchors ?? [],
      verifiabilityClass: m.verifiabilityClass ?? classifyVerifiability(m),
      missionIdHash: mid,
      specDigest,
    };
  });

  // The on-chain mission-plan digest (IDs/rewards/caps) — the SAME function the vault
  // agreement + public-identity checks compute against.
  const plan = computeCampaignPlan(
    input.publicCampaignId,
    compiled.map((c) => ({ missionKey: c.missionKey, rewardBase: c.rewardBase, maxCompletions: c.maxCompletions })),
  );

  // Exact budget equality — never emit a plan that doesn't sum to the budget.
  const allocatedBase = compiled.reduce((s, c) => s + c.rewardBase * c.maxCompletions, BigInt(0));
  if (allocatedBase !== input.allocation.totalBudgetBase) {
    return { ok: false, error: "compiled economics do not equal the budget" };
  }

  // Self-check with the LIVE payout invariant: the public id must recompute to every
  // hash we just produced. If Sage's own plan can't pass verifyPublicIdentity, it can
  // never be paid — so refuse to mark it deployment-ready.
  const idMissions: IdentityMission[] = compiled.map((c) => ({
    missionKey: c.missionKey,
    missionIdHash: c.missionIdHash,
    specDigest: c.specDigest,
    title: c.title,
    objective: c.objective,
    instructions: c.instructions,
    targetSurface: c.targetSurface,
    criteria: c.criteria,
    evidenceList: c.evidenceRequirements,
    rewardBase: c.rewardBase,
    maxCompletions: c.maxCompletions,
  }));
  const identity = verifyPublicIdentity({
    publicCampaignId: input.publicCampaignId,
    storedCampaignIdHash: cid,
    storedMissionPlanDigest: plan.missionPlanDigest,
    missions: idMissions,
  });
  if (!identity.ok) {
    return { ok: false, error: "compiled plan failed the public-identity self-check", identityMismatches: identity.mismatches.map((x) => x.reason) };
  }

  // Plain-words verifiability disclosure — honesty about how each finding can be proven.
  const urlCount = compiled.filter((c) => c.verifiabilityClass === "url-verifiable").length;
  const obsCount = compiled.length - urlCount;
  const verifiabilityNote =
    obsCount === 0
      ? `All ${compiled.length} missions are verified from a public page: the tester submits a URL and Sage checks the quoted text.`
      : urlCount === 0
        ? `All ${compiled.length} missions are observation-based: this product's outcomes can't be proven from a public URL, so each tester submits a written account that Sage judges for specific, checkable detail.`
        : `${urlCount} of ${compiled.length} missions are verified from a public page (URL + quoted text); the other ${obsCount} are observation-based — the tester submits a written account Sage judges for specific detail.`;

  const out: MissionPlanV1 = {
    publicCampaignId: input.publicCampaignId,
    status: "deployment_ready",
    revision: input.revision,
    productMapDigest: input.productMapDigest,
    missions: compiled,
    totalBudgetBase: input.allocation.totalBudgetBase,
    allocatedBase,
    tokenDecimals: input.tokenDecimals,
    campaignIdHash: cid,
    missionPlanDigest: plan.missionPlanDigest,
    openQuestions: [],
    verifiabilityNote,
    modelVersion: input.modelVersion,
    promptVersion: input.promptVersion,
  };
  return { ok: true, plan: out };
}
