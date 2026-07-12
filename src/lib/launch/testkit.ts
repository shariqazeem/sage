import "server-only";

/**
 * E2E test kit — seeds a REAL approved plan (a job + an approved plan revision) using the
 * production plan compiler, so the injected-wallet browser E2E can drive the ACTUAL
 * deployment routes + state machine end-to-end without an LLM or a chain. Gated by
 * SAGE_E2E === "1"; it is never reachable in a normal run (the route 404s otherwise).
 */

import { randomBytes } from "node:crypto";

import { createInspectionJob, updateInspectionJob } from "@/lib/db/inspection";
import { createRevision, approveRevision } from "@/lib/db/plan-revisions";
import { compilePlan } from "./plan";
import { verifyPlanForApproval } from "./approve";
import { MISSION_PROMPT_VERSION } from "./mission-prompt";
import type { BudgetAllocation, CandidateMission } from "./schemas";

export function e2eEnabled(): boolean {
  return process.env.SAGE_E2E === "1";
}

function mission(key: string, weight: number): CandidateMission {
  return {
    missionKey: key,
    title: `Complete the ${key.replace(/-/g, " ")} flow`,
    objective: `Confirm a new tester can complete the ${key} flow end to end.`,
    instructions: `Open the product, complete the ${key} flow, and capture what you saw.`,
    targetSurface: "https://demo.example/app",
    criteria: ["The flow completes without an error", "The result is visible to the tester"],
    evidenceRequirements: ["A screenshot of the completed flow", "The URL where it completed"],
    whyItMatters: `The ${key} flow is the first thing a new user hits.`,
    sources: [{ kind: "page", ref: "https://demo.example/app", observation: "the app entry point" }],
    priority: "high",
    riskCategory: "onboarding",
    effortMinutes: 10,
    conditions: [],
    rewardWeight: weight,
    maxCompletions: 1,
    verificationMethod: "Sage checks the screenshot + URL against the criteria.",
    confidence: 0.9,
    assumptions: [],
    disallowed: ["Do not sign any transaction", "Do not enter real funds"],
  };
}

/**
 * Seed a fresh, approved, deployment-ready plan owned by "anonymous" (to be claimed by the
 * test wallet). Returns the job id + public campaign id. The budget sums EXACTLY to the
 * mission economics so approval + deployment succeed.
 */
export function seedApprovedPlan(): { jobId: string; publicCampaignId: string } {
  const totalBudgetBase = BigInt(1_000_000); // 1 USDC (6dp) — one mission, one completion.
  const missions = [mission("onboarding", 5)];
  const allocation: BudgetAllocation = {
    ok: true,
    reason: null,
    totalBudgetBase,
    allocatedBase: totalBudgetBase,
    missions: [{ missionKey: "onboarding", rewardBase: totalBudgetBase, maxCompletions: BigInt(1), weight: 5, effortMinutes: 10 }],
  };
  // A stable productMapDigest — compilePlan + verifyPlanForApproval use the SAME value, so
  // the exact bytes don't matter for the seed (this is not a real inspection).
  const mapDigest = `0x${"e2e5eed".padEnd(64, "0")}` as `0x${string}`;

  // compilePlan needs the public id; create the job first to use its id as the public id.
  // A unique product URL per seed keeps the idempotency key distinct (parallel E2E tests
  // must each get their OWN job, never dedupe onto a shared one).
  const productUrl = `https://demo.example/app?e2e=${randomBytes(8).toString("hex")}`;
  const { job } = createInspectionJob({
    founderWallet: "anonymous",
    publicCampaignId: "pending",
    productUrl,
    goal: "Confirm onboarding works for a new tester.",
    targetUsers: "testers",
    totalBudgetBase,
    tokenDecimals: 6,
  });

  const finalCompiled = compilePlan({
    publicCampaignId: job.id,
    productMapDigest: mapDigest,
    missions,
    allocation,
    tokenDecimals: 6,
    modelVersion: "e2e-seed",
    promptVersion: MISSION_PROMPT_VERSION,
    revision: 1,
  });
  if (!finalCompiled.ok) throw new Error("e2e seed: compilePlan failed");

  updateInspectionJob(job.id, "ready", {
    result: { map: { productName: "Demo", category: "webapp", valueProp: "A demo product.", founderTargetUsers: "testers", routes: [{ value: "https://demo.example/app" }], primaryJourney: [{ value: "open the app" }], limitations: [], openQuestions: [], pagesInspected: 1, repoFilesInspected: 0 }, questions: [], reason: null },
    productMapDigest: mapDigest,
    revision: 1,
  });

  createRevision({
    jobId: job.id,
    authorWallet: "anonymous",
    reason: "generated",
    plan: finalCompiled.plan,
    budgetBase: totalBudgetBase,
    validationOk: true,
    model: "e2e-seed",
    provider: "e2e",
  });

  const verified = verifyPlanForApproval(finalCompiled.plan, { approver: "anonymous", model: "e2e-seed", provider: "e2e", promptVersion: MISSION_PROMPT_VERSION });
  if (!verified.ok) throw new Error(`e2e seed: plan does not self-verify (${verified.error})`);
  const approved = approveRevision(job.id, 1, "anonymous", verified.approvalRecord);
  if (!approved.ok) throw new Error(`e2e seed: approval failed (${approved.reason})`);

  return { jobId: job.id, publicCampaignId: job.id };
}
