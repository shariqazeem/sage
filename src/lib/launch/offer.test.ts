import { describe, expect, it } from "vitest";
import { offerPlan } from "./offer";
import { compilePlan } from "./plan";
import { allocateBudget } from "./budget";
import { missionIdHash } from "@/lib/campaigns/mission-plan";
import { MISSION_PROMPT_VERSION } from "./mission-prompt";
import type { CandidateMission, MissionPlanV1, MissionPriority } from "./schemas";
import { offerOf, splitPlaces, usdToBase, baseToUsd, offerProblem } from "@/lib/test-page/offer-shape";

/**
 * THE OFFER CARD'S COMPILER. "N people, $E each" must become a plan where every place pays exactly E,
 * the places add up to N, and Σ(reward × places) is N × E to the base unit, for every combination a
 * builder can pick. No word of a mission may change on the way.
 */
const PUB = "acme-test";
const HOST = "app.acme.example";

function m(key: string, priority: MissionPriority, weight: number, places: number): CandidateMission {
  return {
    missionKey: key, title: `Try ${key}`, objective: `Find out whether ${key} works for a stranger`,
    instructions: `Open ${key}, follow the main path, and write what happened`,
    targetSurface: `https://${HOST}/${key}`,
    criteria: [`The ${key} flow was really tried`, `What happened is described`],
    evidenceRequirements: [`The heading you saw on ${key}`, `Where you got stuck, if you did`],
    whyItMatters: `${key} is where people start`,
    sources: [{ kind: "page", ref: `https://${HOST}/${key}`, observation: "observed" }],
    priority, riskCategory: "critical_journey", effortMinutes: 10, conditions: [],
    rewardWeight: weight, maxCompletions: places, verificationMethod: "the tester's written account", confidence: 0.85, assumptions: [], disallowed: [],
    anchors: [`${key} heading`], verifiabilityClass: "observation-based",
  };
}

function seed(missions: CandidateMission[], budget = BigInt(20_000_000)): MissionPlanV1 {
  const alloc = allocateBudget(missions.map((x) => ({ missionKey: x.missionKey, weight: x.rewardWeight, suggestedMaxCompletions: x.maxCompletions, priority: x.priority, effortMinutes: x.effortMinutes })), budget);
  const c = compilePlan({ publicCampaignId: PUB, productMapDigest: `0x${"1".repeat(64)}`, missions, allocation: alloc, tokenDecimals: 6, modelVersion: "m", promptVersion: MISSION_PROMPT_VERSION, revision: 1 });
  if (!c.ok) throw new Error(`seed failed: ${c.error}`);
  return c.plan;
}

const opts = { productMapDigest: `0x${"1".repeat(64)}` as `0x${string}`, model: "m", promptVersion: MISSION_PROMPT_VERSION, revision: 2 };
const sum = (p: MissionPlanV1) => p.missions.reduce((s, x) => s + x.rewardBase * x.maxCompletions, BigInt(0));
const places = (p: MissionPlanV1) => p.missions.reduce((s, x) => s + Number(x.maxCompletions), 0);

const ONE = [m("signup", "high", 8, 4)];
const THREE = [m("signup", "high", 8, 2), m("pricing", "medium", 4, 3), m("docs", "low", 2, 5)];
// same priority everywhere, and the model gave the LAST mission the most places
const FLAT = [m("alpha", "medium", 3, 1), m("beta", "medium", 9, 1), m("gamma", "medium", 1, 9)];

describe("offerPlan: people × each, exactly", () => {
  it("the default test: 10 people at $2.00 is $20.00, every place $2.00", () => {
    const r = offerPlan(seed(THREE), { people: 10, eachBase: BigInt(2_000_000) }, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sum(r.plan)).toBe(BigInt(20_000_000));
    expect(r.plan.totalBudgetBase).toBe(BigInt(20_000_000));
    expect(r.plan.allocatedBase).toBe(BigInt(20_000_000));
    expect(places(r.plan)).toBe(10);
    expect(r.plan.missions.every((x) => x.rewardBase === BigInt(2_000_000))).toBe(true);
    // 4 / 3 / 3, the most important mission holding the extra place
    expect(r.plan.missions.find((x) => x.missionKey === "signup")!.maxCompletions).toBe(BigInt(4));
  });

  it("holds for every preset and a sweep of custom numbers, on one, three and same-priority missions", () => {
    const eachCents = [50, 75, 100, 133, 200, 250, 499, 500, 777, 1234, 5000];
    for (const base of [ONE, THREE, FLAT]) {
      const plan = seed(base);
      for (let people = base.length; people <= Math.min(50 * base.length, 60); people++) {
        for (const cents of eachCents) {
          const eachBase = BigInt(cents * 10_000);
          const r = offerPlan(plan, { people, eachBase }, opts);
          expect(r.ok, `${base.length} missions, ${people} people, ${cents}c: ${r.ok ? "" : r.error}`).toBe(true);
          if (!r.ok) continue;
          expect(sum(r.plan)).toBe(BigInt(people) * eachBase);
          expect(r.plan.totalBudgetBase).toBe(BigInt(people) * eachBase);
          expect(places(r.plan)).toBe(people);
          expect(r.plan.missions.every((x) => x.rewardBase === eachBase)).toBe(true);
          expect(r.plan.missions).toHaveLength(base.length);
        }
      }
    }
  });

  it("changes no word of a mission, keeps what Sage saw, and keeps each mission's identity", () => {
    const plan = seed(THREE);
    const r = offerPlan(plan, { people: 5, eachBase: BigInt(1_000_000) }, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const before of plan.missions) {
      const after = r.plan.missions.find((x) => x.missionKey === before.missionKey)!;
      for (const k of ["title", "objective", "instructions", "targetSurface", "criteria", "evidenceRequirements", "whyItMatters", "sources", "priority", "verificationMethod", "anchors", "verifiabilityClass"] as const) {
        expect(after[k]).toEqual(before[k]);
      }
      expect(after.missionIdHash).toBe(missionIdHash(PUB, before.missionKey));
    }
    expect(r.plan.campaignIdHash).toBe(plan.campaignIdHash);
    expect(r.plan.missionPlanDigest).not.toBe(plan.missionPlanDigest); // the money changed, so the digest did
    expect(r.plan.revision).toBe(2);
  });

  it("is deterministic: the same offer compiles to the same plan", () => {
    const plan = seed(THREE);
    const a = offerPlan(plan, { people: 20, eachBase: BigInt(5_000_000) }, opts);
    const b = offerPlan(plan, { people: 20, eachBase: BigInt(5_000_000) }, opts);
    expect(a.ok && b.ok && a.plan.missionPlanDigest === b.plan.missionPlanDigest).toBe(true);
  });

  it("carries invite-only, and switching it back", () => {
    const plan = seed(ONE);
    const invited = offerPlan(plan, { people: 5, eachBase: BigInt(2_000_000), visibility: "unlisted" }, opts);
    expect(invited.ok && invited.plan.visibility).toBe("unlisted");
    if (!invited.ok) return;
    const kept = offerPlan(invited.plan, { people: 10, eachBase: BigInt(2_000_000) }, opts);
    expect(kept.ok && kept.plan.visibility).toBe("unlisted");
    const open = offerPlan(invited.plan, { people: 10, eachBase: BigInt(2_000_000), visibility: "listed" }, opts);
    expect(open.ok && open.plan.visibility).toBe("listed");
  });

  it("refuses what could not be a test, and never a grant or a gig", () => {
    const plan = seed(THREE);
    expect(offerPlan(plan, { people: 2, eachBase: BigInt(2_000_000) }, opts).ok).toBe(false); // fewer people than missions
    expect(offerPlan(plan, { people: 10, eachBase: BigInt(400_000) }, opts).ok).toBe(false); // under the floor
    expect(offerPlan(plan, { people: 10, eachBase: BigInt(51_000_000) }, opts).ok).toBe(false); // over the ceiling
    expect(offerPlan(plan, { people: 10, eachBase: BigInt(2_000_001) }, opts).ok).toBe(false); // not whole cents
    expect(offerPlan(plan, { people: 151, eachBase: BigInt(2_000_000) }, opts).ok).toBe(false);
    expect(offerPlan(plan, { people: 2.5, eachBase: BigInt(2_000_000) }, opts).ok).toBe(false);
    expect(offerPlan({ ...plan, campaignKind: "grant" }, { people: 10, eachBase: BigInt(2_000_000) }, opts).ok).toBe(false);
  });
});

describe("the offer's numbers", () => {
  it("reads people, each and the total from a plan", () => {
    const r = offerPlan(seed(THREE), { people: 10, eachBase: BigInt(2_000_000) }, opts);
    if (!r.ok) throw new Error(r.error);
    expect(offerOf(r.plan.missions)).toEqual({ people: 10, eachBase: 2_000_000, minEachBase: 2_000_000, maxEachBase: 2_000_000, totalBase: 20_000_000, missions: 3 });
    expect(offerOf(seed(THREE).missions).eachBase).toBeNull(); // Sage's own plan pays missions differently
  });

  it("splits places evenly, the first missions holding the extras", () => {
    expect(splitPlaces(10, 3)).toEqual([4, 3, 3]);
    expect(splitPlaces(5, 1)).toEqual([5]);
    expect(splitPlaces(3, 3)).toEqual([1, 1, 1]);
    expect(splitPlaces(20, 3)).toEqual([7, 7, 6]);
  });

  it("reads typed dollars without a float", () => {
    expect(usdToBase("2")).toBe(2_000_000);
    expect(usdToBase("$2.50")).toBe(2_500_000);
    expect(usdToBase("0.1")).toBe(100_000);
    expect(usdToBase("19.99")).toBe(19_990_000);
    expect(usdToBase("2.505")).toBeNull();
    expect(usdToBase("two")).toBeNull();
    expect(baseToUsd(20_000_000)).toBe("$20.00");
    expect(baseToUsd(BigInt(1_230_000))).toBe("$1.23");
    expect(offerProblem(10, 2_000_000, 3)).toBeNull();
  });
});
