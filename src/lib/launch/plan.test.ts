import { describe, expect, it } from "vitest";
import { compilePlan } from "./plan";
import { allocateBudget } from "./budget";
import { campaignIdHash, computeCampaignPlan, missionIdHash } from "@/lib/campaigns/mission-plan";
import { missionSpecDigest } from "@/lib/campaigns/mission-spec";
import { verifyPublicIdentity } from "@/lib/campaigns/public-identity";
import { productMapDigest } from "./schemas";
import type { CandidateMission } from "./schemas";

/**
 * The compiler must produce the SAME canonical artifacts the CampaignVaultV2 pipeline
 * enforces — recomputed independently here — and the plan must pass the live-payout
 * public-identity invariant, with economics summing exactly to the budget.
 */

const PUB = "acme-launch-2026";

function mission(key: string, over: Partial<CandidateMission> = {}): CandidateMission {
  return {
    missionKey: key,
    title: `Mission ${key}`,
    objective: `Confirm the ${key} flow behaves as the product claims`,
    instructions: `Open the ${key} surface, follow the primary path, and record the outcome`,
    targetSurface: `https://app.acme.example/${key}`,
    criteria: [`The ${key} flow completes`, `No error is shown on the happy path`],
    evidenceRequirements: [`A screen recording of the ${key} flow`, `The final URL reached`],
    whyItMatters: `The ${key} surface is on the primary conversion journey`,
    sources: [{ kind: "page", ref: `https://app.acme.example/${key}`, observation: "observed" }],
    priority: "high",
    riskCategory: "critical_journey",
    effortMinutes: 20,
    conditions: ["desktop browser"],
    rewardWeight: 6,
    maxCompletions: 3,
    verificationMethod: "re-fetch and compare",
    confidence: 0.85,
    assumptions: [],
    disallowed: ["no purchases"],
    ...over,
  };
}

describe("compilePlan — canonical hashes + exact economics + identity self-check", () => {
  it("produces a deployment-ready plan whose hashes recompute and budget is exact", () => {
    const missions = [
      mission("onboarding", { priority: "high", rewardWeight: 9 }),
      mission("pricing", { priority: "medium", rewardWeight: 5, maxCompletions: 4 }),
      mission("docs", { priority: "low", rewardWeight: 3, maxCompletions: 2 }),
    ];
    const alloc = allocateBudget(
      missions.map((m) => ({ missionKey: m.missionKey, weight: m.rewardWeight, suggestedMaxCompletions: m.maxCompletions, priority: m.priority, effortMinutes: m.effortMinutes })),
      BigInt(6_000_000),
    );
    expect(alloc.ok).toBe(true);

    const mapDigest = productMapDigest({
      productName: "Acme", category: "saas", valueProp: "ship faster", founderTargetUsers: "devs",
      targetUserHypotheses: [], primaryJourney: [], routes: [], interactiveSurfaces: [], trustSurfaces: [],
      claimRisks: [], observedStates: [], repoOnlyCapabilities: [], browserConfirmed: [],
      limitations: [], openQuestions: [], pagesInspected: 6, repoFilesInspected: 0,
    });

    const r = compilePlan({
      publicCampaignId: PUB,
      productMapDigest: mapDigest,
      missions,
      allocation: alloc,
      tokenDecimals: 6,
      modelVersion: "gemini-x",
      promptVersion: "mb-1",
      revision: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const plan = r.plan;

    expect(plan.status).toBe("deployment_ready");
    expect(plan.campaignIdHash).toBe(campaignIdHash(PUB));

    // exact economics
    const summed = plan.missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));
    expect(summed).toBe(BigInt(6_000_000));
    expect(plan.allocatedBase).toBe(BigInt(6_000_000));

    // every canonical hash recomputes independently
    for (const cm of plan.missions) {
      expect(cm.missionIdHash).toBe(missionIdHash(PUB, cm.missionKey));
      expect(cm.specDigest).toBe(
        missionSpecDigest({
          campaignIdHash: campaignIdHash(PUB),
          missionIdHash: missionIdHash(PUB, cm.missionKey),
          title: cm.title, objective: cm.objective, instructions: cm.instructions,
          targetSurface: cm.targetSurface, criteria: cm.criteria, evidenceRequirements: cm.evidenceRequirements,
          rewardBase: cm.rewardBase, maxCompletions: cm.maxCompletions,
        }),
      );
    }
    const planDigest = computeCampaignPlan(
      PUB,
      plan.missions.map((m) => ({ missionKey: m.missionKey, rewardBase: m.rewardBase, maxCompletions: m.maxCompletions })),
    ).missionPlanDigest;
    expect(plan.missionPlanDigest).toBe(planDigest);

    // and it passes the SAME identity invariant that guards a live payout
    const identity = verifyPublicIdentity({
      publicCampaignId: plan.publicCampaignId,
      storedCampaignIdHash: plan.campaignIdHash,
      storedMissionPlanDigest: plan.missionPlanDigest,
      missions: plan.missions.map((m) => ({
        missionKey: m.missionKey, missionIdHash: m.missionIdHash, specDigest: m.specDigest,
        title: m.title, objective: m.objective, instructions: m.instructions, targetSurface: m.targetSurface,
        criteria: m.criteria, evidenceList: m.evidenceRequirements, rewardBase: m.rewardBase, maxCompletions: m.maxCompletions,
      })),
    });
    expect(identity.ok).toBe(true);
  });

  it("refuses when the allocation is not fundable", () => {
    const r = compilePlan({
      publicCampaignId: PUB,
      productMapDigest: `0x${"0".repeat(64)}`,
      missions: [mission("x")],
      allocation: { ok: false, reason: "too small", missions: [], totalBudgetBase: BigInt(1), allocatedBase: BigInt(0) },
      tokenDecimals: 6,
      modelVersion: "m",
      promptVersion: "p",
      revision: 1,
    });
    expect(r.ok).toBe(false);
  });
});
