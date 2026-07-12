import { describe, expect, it } from "vitest";
import { revisePlan } from "./revise";
import { compilePlan } from "./plan";
import { allocateBudget } from "./budget";
import { missionIdHash } from "@/lib/campaigns/mission-plan";
import { MISSION_PROMPT_VERSION } from "./mission-prompt";
import type { CandidateMission, MissionPlanV1 } from "./schemas";
import type { ValidationScope } from "./validate-mission";

/**
 * Editing a plan must ALWAYS stay safe (the same quality gate), exactly on budget (the
 * deterministic allocator), and recompute its canonical hashes. An unsafe or out-of-scope
 * edit is rejected with issues; a budget change rebalances exactly; removal keeps exact.
 */

const PUB = "acme-launch";
const HOST = "app.acme.example";
const scope: ValidationScope = {
  hosts: new Set([HOST]),
  knownUrls: new Set([`https://${HOST}/`, `https://${HOST}/onboarding`, `https://${HOST}/pricing`, `https://${HOST}/docs`]),
  repoPaths: new Set(),
};

function m(key: string, path: string): CandidateMission {
  return {
    missionKey: key, title: `Test ${key}`, objective: `Confirm the ${key} flow works as claimed`,
    instructions: `Open the ${key} surface, follow the primary path, and record what happens`,
    targetSurface: `https://${HOST}/${path}`,
    criteria: [`The ${key} flow completes on the happy path`, `No blocking error appears`],
    evidenceRequirements: [`A screen recording of the ${key} flow`, `The final URL reached`],
    whyItMatters: `${key} is on the primary conversion journey`,
    sources: [{ kind: "page", ref: `https://${HOST}/${path}`, observation: "observed" }],
    priority: "high", riskCategory: "critical_journey", effortMinutes: 20, conditions: [],
    rewardWeight: 6, maxCompletions: 3, verificationMethod: "re-fetch + compare", confidence: 0.85, assumptions: [], disallowed: [],
  };
}

function seedPlan(budget = BigInt(6_000_000)): MissionPlanV1 {
  const missions = [m("onboarding", "onboarding"), m("pricing", "pricing"), m("docs", "docs")];
  const alloc = allocateBudget(missions.map((x) => ({ missionKey: x.missionKey, weight: x.rewardWeight, suggestedMaxCompletions: x.maxCompletions, priority: x.priority, effortMinutes: x.effortMinutes })), budget);
  const c = compilePlan({ publicCampaignId: PUB, productMapDigest: `0x${"1".repeat(64)}`, missions, allocation: alloc, tokenDecimals: 6, modelVersion: "m", promptVersion: MISSION_PROMPT_VERSION, revision: 1 });
  if (!c.ok) throw new Error("seed failed");
  return c.plan;
}

const opts = { scope, productMapDigest: `0x${"1".repeat(64)}` as `0x${string}`, model: "m", provider: "p", promptVersion: MISSION_PROMPT_VERSION, revision: 2 };
const sum = (p: MissionPlanV1) => p.missions.reduce((s, x) => s + x.rewardBase * x.maxCompletions, BigInt(0));

describe("revisePlan — safe, exact, canonical after every edit", () => {
  it("a prose edit keeps the budget exact and recomputes the mission's spec digest", () => {
    const plan = seedPlan();
    const before = plan.missions.find((x) => x.missionKey === "onboarding")!.specDigest;
    const r = revisePlan(plan, [{ missionKey: "onboarding", title: "A clearer onboarding title" }], opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sum(r.plan)).toBe(plan.totalBudgetBase); // still exact
    const after = r.plan.missions.find((x) => x.missionKey === "onboarding")!;
    expect(after.title).toBe("A clearer onboarding title");
    expect(after.specDigest).not.toBe(before); // digest recomputed on prose change
    expect(after.missionIdHash).toBe(missionIdHash(PUB, "onboarding")); // identity stable
  });

  it("an out-of-scope target is rejected with a stable issue (never saved)", () => {
    const r = revisePlan(seedPlan(), [{ missionKey: "pricing", targetSurface: "https://evil.example.net/x" }], opts);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.flatMap((i) => i.issues.map((x) => x.code))).toContain("target_out_of_scope");
  });

  it("a destructive instruction edit is rejected", () => {
    const r = revisePlan(seedPlan(), [{ missionKey: "docs", instructions: "Delete your account and all data to test cleanup." }], opts);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.flatMap((i) => i.issues.map((x) => x.code))).toContain("destructive_instruction");
  });

  it("a budget change rebalances to the NEW total exactly", () => {
    const r = revisePlan(seedPlan(), [], { ...opts, newBudgetBase: BigInt(10_000_000) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sum(r.plan)).toBe(BigInt(10_000_000));
    expect(r.plan.totalBudgetBase).toBe(BigInt(10_000_000));
  });

  it("removing a mission keeps the plan exact with one fewer mission", () => {
    const plan = seedPlan();
    const r = revisePlan(plan, [{ missionKey: "docs", remove: true }], opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.missions.length).toBe(plan.missions.length - 1);
    expect(sum(r.plan)).toBe(plan.totalBudgetBase); // still exact
    expect(r.plan.missions.some((x) => x.missionKey === "docs")).toBe(false);
  });
});
