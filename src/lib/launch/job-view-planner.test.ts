import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a job's public view says about its planner. P-GEN reads this to tell a grounded plan from a legacy
 * one and to check the grounded plan's coverage of the core mission; a view that hid it is how the missing
 * core went unseen. It carries the planner, the plan digest and the coverage statement: never the policy,
 * the commitment, the wallet or anything Sage observed.
 */
vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { createInspectionJob, getInspectionJob, updateInspectionJob } from "@/lib/db/inspection";
import { inspectionJobs } from "@/lib/db/schema";
import { jobToView } from "./job";

let n = 0;
function job(result: unknown) {
  const id = createInspectionJob({
    founderWallet: "0x5555555555555555555555555555555555555555",
    publicCampaignId: `launch-planner-view-${++n}`,
    productUrl: `https://planner${n}.example`,
    goal: "",
    targetUsers: "",
    totalBudgetBase: BigInt(20_000_000),
    tokenDecimals: 6,
    planningRequestId: `req-planner-view-${n}`,
  }).job.id;
  updateInspectionJob(id, "ready", { result });
  return jobToView(getInspectionJob(id)!);
}

beforeEach(() => db.delete(inspectionJobs).run());

describe("a job's view of its planner", () => {
  const plan = { missions: [], missionPlanDigest: "0xplan" };
  const coverage = { version: "grounded-coverage-v1", missionPlanDigest: "0xplan", core: { missionKey: "core-first-try", replayCovenant: "outside" }, missions: [] };

  it("a grounded plan shows its planner, its digest and its coverage, and nothing else of the selection", () => {
    const v = job({ plan, map: null, questions: [], canary: { status: "selected", planSource: "grounded_v2", planDigest: "0xplan", planCommitment: "c0ffee", wallet: "0xabc", coverage, verificationPolicy: { probes: [] } } });
    expect(v.planner).toEqual({ source: "grounded_v2", planDigest: "0xplan", coverage });
    expect(JSON.stringify(v)).not.toMatch(/c0ffee|0xabc|probes/);
  });

  it("a legacy plan says so, whatever the canary's status was", () => {
    expect(job({ plan, map: null, questions: [], canary: null }).planner).toEqual({ source: "legacy", planDigest: null, coverage: null });
    expect(job({ plan, map: null, questions: [], canary: { status: "blocked", reason: "signal:canonicalGatePassed", planSource: "legacy" } }).planner).toEqual({ source: "legacy", planDigest: null, coverage: null });
  });

  it("a job with no plan has no planner", () => {
    expect(job({ plan: null, map: null, questions: ["What should people try?"] }).planner).toBeNull();
  });
});
