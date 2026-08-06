import { describe, expect, it } from "vitest";

import { allocateBudget, MAX_COMPLETIONS, MIN_REWARD_BASE, type WeightedMission } from "./budget";

/**
 * A BIG BUDGET MUST BUY MORE TESTERS, NOT ONE ENORMOUS REWARD.
 *
 * Exact equality is guaranteed by one mission — the "balancer" — absorbing whatever the others leave
 * over. It used to do that in a single completion, which is invisible at the budgets Sage has run so
 * far (a $10 plan pays its balancer $4.29 once) and indefensible at the ones it is being sold for.
 *
 * Measured before the fix, on a 3-mission plan of 5, 20 and 60-minute tasks:
 *
 *   $10,000 → balancer paid ONE tester $3,333.33 for the five-minute task
 *   $50,000 → balancer paid ONE tester $16,666.67 for the five-minute task
 *
 * while the other two missions correctly funded 50 testers each. The sample policy works hard to
 * hold rewards under $0.20 per estimated minute; the balancer was exceeding that by four orders of
 * magnitude, in the one plan a founder with real money would actually run.
 *
 * Exactness never depended on the count being 1. It depended on the reward being the remainder
 * divided by the count with nothing left over, which is what these tests hold onto.
 */

const m = (
  missionKey: string,
  effortMinutes: number,
  suggestedMaxCompletions = 50,
): WeightedMission => ({
  missionKey,
  weight: 5,
  suggestedMaxCompletions,
  priority: "medium",
  effortMinutes,
});

const PLAN = [m("easy", 5), m("medium", 20), m("hard", 60)];
const usd = (n: number) => BigInt(Math.round(n * 1e6));

describe("the sum is still exactly the budget", () => {
  it.each([10, 100, 1_000, 10_000, 50_000, 137_419])("$%i allocates to the base unit", (amount) => {
    const r = allocateBudget(PLAN, usd(amount));
    expect(r.ok).toBe(true);
    const sum = r.missions.reduce((s, x) => s + x.rewardBase * x.maxCompletions, BigInt(0));
    expect(sum).toBe(usd(amount));
  });

  it("holds for an awkward budget that divides evenly by nothing convenient", () => {
    // A prime-ish number of base units is the case where a divisor search could quietly fail.
    const odd = BigInt(7_777_777_777);
    const r = allocateBudget(PLAN, odd);
    expect(r.ok).toBe(true);
    expect(r.missions.reduce((s, x) => s + x.rewardBase * x.maxCompletions, BigInt(0))).toBe(odd);
  });
});

describe("a large budget spreads instead of concentrating", () => {
  it.each([10_000, 50_000])("$%i pays no single tester more than $1,000", (amount) => {
    const r = allocateBudget(PLAN, usd(amount));
    expect(r.ok).toBe(true);
    for (const x of r.missions) {
      const perTester = Number(x.rewardBase) / 1e6;
      expect(perTester, `${x.missionKey} pays one tester $${perTester}`).toBeLessThan(1_000);
    }
  });

  it("$50,000 funds many testers per mission, not one", () => {
    const r = allocateBudget(PLAN, usd(50_000));
    const total = r.missions.reduce((s, x) => s + Number(x.maxCompletions), 0);
    expect(total).toBeGreaterThanOrEqual(100);
    for (const x of r.missions) expect(Number(x.maxCompletions)).toBeGreaterThan(1);
  });

  it("never exceeds a mission's own completion cap", () => {
    const r = allocateBudget([m("solo", 5, 3), m("other", 20, 50)], usd(50_000));
    const solo = r.missions.find((x) => x.missionKey === "solo")!;
    expect(Number(solo.maxCompletions)).toBeLessThanOrEqual(3);
    for (const x of r.missions) expect(x.maxCompletions).toBeLessThanOrEqual(MAX_COMPLETIONS);
  });
});

describe("the small-budget behaviour it must not disturb", () => {
  it("a single mission still takes the whole budget in one completion", () => {
    const r = allocateBudget([m("only", 10, 1)], usd(5));
    expect(r.ok).toBe(true);
    expect(r.missions).toHaveLength(1);
    expect(r.missions[0]!.maxCompletions).toBe(BigInt(1));
    expect(r.missions[0]!.rewardBase).toBe(usd(5));
  });

  it("no reward ever falls below the meaningful floor", () => {
    for (const amount of [1, 5, 10, 100, 10_000]) {
      const r = allocateBudget(PLAN, usd(amount));
      if (!r.ok) continue;
      for (const x of r.missions) expect(x.rewardBase).toBeGreaterThanOrEqual(MIN_REWARD_BASE);
    }
  });
});
