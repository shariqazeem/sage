import { describe, expect, it } from "vitest";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import { MAX_PLACES_PER_MISSION, placesFor, splitPlaces } from "@/lib/test-page/offer-shape";
import { allocateBudget } from "./budget";
import { MISSION_PROMPT_VERSION } from "./mission-prompt";
import { offerPlan } from "./offer";
import { compilePlan } from "./plan";
import type { CandidateMission, MissionPlanV1, MissionPriority } from "./schemas";

/**
 * THE CORE MISSION HOLDS MOST OF THE PEOPLE. "6 of 10 understood it" is only worth reading when
 * most of a test's people answered it, and a person takes one place per test. So the offer gives the
 * core mission half the places, and the money is still exact: every place pays the same, to the unit.
 */
const m = (key: string, priority: MissionPriority): CandidateMission => ({
  missionKey: key, title: `Try ${key}`, objective: `Find out whether ${key} works for a stranger`,
  instructions: `Open ${key}, follow the main path, and write what happened`, targetSurface: `https://app.acme.example/${key}`,
  criteria: [`The ${key} flow was really tried`, `What happened is described`], evidenceRequirements: [`The heading you saw on ${key}`, `Where you got stuck, if you did`],
  whyItMatters: `${key} matters`, sources: [{ kind: "page", ref: `https://app.acme.example/${key}`, observation: "observed" }],
  priority, riskCategory: "critical_journey", effortMinutes: 8, conditions: [], rewardWeight: 5, maxCompletions: 3,
  verificationMethod: "the tester's written account", confidence: 0.85, assumptions: [], disallowed: [], anchors: [`${key} heading`], verifiabilityClass: "observation-based",
});

function seed(missions: CandidateMission[]): MissionPlanV1 {
  const alloc = allocateBudget(missions.map((x) => ({ missionKey: x.missionKey, weight: x.rewardWeight, suggestedMaxCompletions: x.maxCompletions, priority: x.priority, effortMinutes: x.effortMinutes })), BigInt(20_000_000));
  const c = compilePlan({ publicCampaignId: "acme-core", productMapDigest: `0x${"1".repeat(64)}`, missions, allocation: alloc, tokenDecimals: 6, modelVersion: "m", promptVersion: MISSION_PROMPT_VERSION, revision: 1 });
  if (!c.ok) throw new Error(c.error);
  return c.plan;
}
const opts = { productMapDigest: `0x${"1".repeat(64)}` as `0x${string}`, model: "m", promptVersion: MISSION_PROMPT_VERSION, revision: 2 };

describe("placesFor", () => {
  it("gives the core mission half the places, wherever it sits, and every other mission at least one", () => {
    expect(placesFor(10, [CORE_MISSION_KEY, "a", "b", "c"])).toEqual([5, 2, 2, 1]);
    expect(placesFor(10, ["a", CORE_MISSION_KEY, "b"])).toEqual([3, 5, 2]);
    expect(placesFor(5, [CORE_MISSION_KEY, "a", "b"])).toEqual([3, 1, 1]);
    expect(placesFor(20, [CORE_MISSION_KEY, "a", "b", "c", "d", "e"])).toEqual([10, 2, 2, 2, 2, 2]);
    // just enough people for one each
    expect(placesFor(4, [CORE_MISSION_KEY, "a", "b", "c"])).toEqual([1, 1, 1, 1]);
    // two missions: the core never takes less than an even share
    expect(placesFor(7, [CORE_MISSION_KEY, "a"])).toEqual([4, 3]);
  });

  it("is the plain even split with no core mission, or with one mission", () => {
    expect(placesFor(10, ["a", "b", "c"])).toEqual(splitPlaces(10, 3));
    expect(placesFor(10, [CORE_MISSION_KEY])).toEqual([10]);
  });

  it("always adds up, never empties a mission and never overfills one", () => {
    for (let n = 1; n <= 7; n++) {
      const keys = [CORE_MISSION_KEY, ...Array.from({ length: n - 1 }, (_, i) => `m${i}`)];
      for (let people = n; people <= n * MAX_PLACES_PER_MISSION; people += people < 40 ? 1 : 13) {
        const p = placesFor(people, keys);
        expect(p.reduce((s, x) => s + x, 0)).toBe(people);
        expect(Math.min(...p)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...p)).toBeLessThanOrEqual(MAX_PLACES_PER_MISSION);
        if (n > 1) expect(p[0]).toBeGreaterThanOrEqual(Math.max(...p.slice(1)));
      }
    }
  });
});

describe("offerPlan with a core mission", () => {
  const plan = seed([m(CORE_MISSION_KEY, "high"), m("signup", "high"), m("pricing", "medium"), m("docs", "low")]);

  it("the default test: 10 people at $2.00, five of them on the core mission, every place $2.00", () => {
    const r = offerPlan(plan, { people: 10, eachBase: BigInt(2_000_000) }, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const places = Object.fromEntries(r.plan.missions.map((x) => [x.missionKey, Number(x.maxCompletions)]));
    expect(places[CORE_MISSION_KEY]).toBe(5);
    expect(Object.values(places).reduce((s, x) => s + x, 0)).toBe(10);
    expect(r.plan.missions.every((x) => x.rewardBase === BigInt(2_000_000))).toBe(true);
    expect(r.plan.allocatedBase).toBe(BigInt(20_000_000));
  });

  it("is exact for every number of people and a sweep of rewards", () => {
    for (let people = 4; people <= 60; people++) {
      for (const cents of [50, 100, 133, 200, 499, 1234]) {
        const eachBase = BigInt(cents * 10_000);
        const r = offerPlan(plan, { people, eachBase }, opts);
        expect(r.ok, `${people} people at ${cents}c: ${r.ok ? "" : r.error}`).toBe(true);
        if (!r.ok) continue;
        expect(r.plan.missions.reduce((s, x) => s + x.rewardBase * x.maxCompletions, BigInt(0))).toBe(BigInt(people) * eachBase);
        expect(r.plan.missions.every((x) => x.rewardBase === eachBase)).toBe(true);
        expect(r.plan.missions).toHaveLength(4);
      }
    }
  });

  it("no word of the core mission changes on the way", () => {
    const r = offerPlan(plan, { people: 20, eachBase: BigInt(1_000_000) }, opts);
    if (!r.ok) throw new Error(r.error);
    const before = plan.missions.find((x) => x.missionKey === CORE_MISSION_KEY)!;
    const after = r.plan.missions.find((x) => x.missionKey === CORE_MISSION_KEY)!;
    expect({ t: after.title, o: after.objective, i: after.instructions, c: after.criteria, e: after.evidenceRequirements }).toEqual({ t: before.title, o: before.objective, i: before.instructions, c: before.criteria, e: before.evidenceRequirements });
  });
});
