import "server-only";

/**
 * Founder approval verification. Before an approval is durably recorded, the server
 * RECOMPUTES the whole canonical identity from the plan's own missions (public campaign
 * id → campaignIdHash, each missionIdHash + MissionSpecV1 digest, missionPlanDigest) and
 * confirms exact budget equality — trusting nothing stored. Only a plan that reproduces
 * its committed hashes and sums exactly to the budget can be approved. The result is a
 * canonical DeploymentReadyPlan, exactly compatible with the CampaignVaultV2 setup.
 */

import type { Hex } from "viem";
import { compilePlan } from "./plan";
import type { BudgetAllocation, CandidateMission, CompiledMission, MissionPlanV1 } from "./schemas";

export const APPROVAL_SCHEMA_VERSION = 1 as const;

export interface DeploymentReadyPlan {
  schemaVersion: number;
  publicCampaignId: string;
  campaignIdHash: Hex;
  missionPlanDigest: Hex;
  tokenDecimals: number;
  totalBudgetBase: string;
  missions: {
    missionKey: string;
    missionIdHash: Hex;
    specDigest: Hex;
    title: string;
    objective: string;
    instructions: string;
    targetSurface: string;
    criteria: string[];
    evidenceRequirements: string[];
    rewardBase: string;
    maxCompletions: string;
  }[];
}

function toCandidate(m: CompiledMission): CandidateMission {
  return {
    missionKey: m.missionKey, title: m.title, objective: m.objective, instructions: m.instructions,
    targetSurface: m.targetSurface, criteria: m.criteria, evidenceRequirements: m.evidenceRequirements,
    whyItMatters: m.whyItMatters, sources: m.sources, priority: m.priority, riskCategory: m.riskCategory,
    effortMinutes: m.effortMinutes, conditions: [], rewardWeight: 5, maxCompletions: Number(m.maxCompletions),
    verificationMethod: m.verificationMethod, confidence: 0.8, assumptions: [], disallowed: [],
  };
}

export type VerifyResult =
  | { ok: true; deploymentReadyPlan: DeploymentReadyPlan; approvalRecord: unknown }
  | { ok: false; error: string; mismatches?: string[] };

/**
 * Recompute + verify a plan for approval. `approver` + provenance go into the immutable
 * approval record. Fails if any recomputed hash differs from the stored plan, the budget
 * is not exact, or the identity self-check fails.
 */
export function verifyPlanForApproval(
  plan: MissionPlanV1,
  ctx: { approver: string; model: string | null; provider: string | null; promptVersion: string },
): VerifyResult {
  // rebuild the allocation from the plan's own economics.
  const allocation: BudgetAllocation = {
    ok: true,
    reason: null,
    totalBudgetBase: plan.totalBudgetBase,
    allocatedBase: plan.missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0)),
    missions: plan.missions.map((m) => ({ missionKey: m.missionKey, rewardBase: m.rewardBase, maxCompletions: m.maxCompletions, weight: 5, effortMinutes: m.effortMinutes })),
  };

  const recompiled = compilePlan({
    publicCampaignId: plan.publicCampaignId,
    productMapDigest: plan.productMapDigest,
    missions: plan.missions.map(toCandidate),
    allocation,
    tokenDecimals: plan.tokenDecimals,
    modelVersion: plan.modelVersion,
    promptVersion: ctx.promptVersion,
    revision: plan.revision,
  });
  if (!recompiled.ok) return { ok: false, error: recompiled.error, mismatches: recompiled.identityMismatches };

  // every recomputed hash must equal the stored plan's — trust nothing.
  const mismatches: string[] = [];
  const r = recompiled.plan;
  if (r.campaignIdHash !== plan.campaignIdHash) mismatches.push("campaignIdHash");
  if (r.missionPlanDigest !== plan.missionPlanDigest) mismatches.push("missionPlanDigest");
  if (r.allocatedBase !== plan.totalBudgetBase) mismatches.push("budget_not_exact");
  const byKey = new Map(plan.missions.map((m) => [m.missionKey, m]));
  for (const cm of r.missions) {
    const stored = byKey.get(cm.missionKey);
    if (!stored) { mismatches.push(`missing:${cm.missionKey}`); continue; }
    if (cm.missionIdHash !== stored.missionIdHash) mismatches.push(`missionIdHash:${cm.missionKey}`);
    if (cm.specDigest !== stored.specDigest) mismatches.push(`specDigest:${cm.missionKey}`);
  }
  if (mismatches.length) return { ok: false, error: "plan hashes do not reproduce — reload and try again", mismatches };

  const deploymentReadyPlan: DeploymentReadyPlan = {
    schemaVersion: APPROVAL_SCHEMA_VERSION,
    publicCampaignId: r.publicCampaignId,
    campaignIdHash: r.campaignIdHash,
    missionPlanDigest: r.missionPlanDigest,
    tokenDecimals: r.tokenDecimals,
    totalBudgetBase: r.totalBudgetBase.toString(),
    missions: r.missions.map((m) => ({
      missionKey: m.missionKey, missionIdHash: m.missionIdHash, specDigest: m.specDigest,
      title: m.title, objective: m.objective, instructions: m.instructions, targetSurface: m.targetSurface,
      criteria: m.criteria, evidenceRequirements: m.evidenceRequirements,
      rewardBase: m.rewardBase.toString(), maxCompletions: m.maxCompletions.toString(),
    })),
  };
  const approvalRecord = {
    schemaVersion: APPROVAL_SCHEMA_VERSION,
    approver: ctx.approver.toLowerCase(),
    revision: plan.revision,
    campaignIdHash: r.campaignIdHash,
    missionPlanDigest: r.missionPlanDigest,
    productMapDigest: r.productMapDigest,
    totalBudgetBase: r.totalBudgetBase.toString(),
    missionCount: r.missions.length,
    totalCompletions: r.missions.reduce((s, m) => s + Number(m.maxCompletions), 0),
    model: ctx.model,
    provider: ctx.provider,
  };
  return { ok: true, deploymentReadyPlan, approvalRecord };
}
