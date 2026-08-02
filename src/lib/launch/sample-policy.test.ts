import { describe, it, expect } from "vitest";
import {
  applySamplePolicy,
  effortCeilingBase,
  PER_MINUTE_RATE_BASE,
  PREFERRED_SAMPLE,
  type SampleMission,
} from "./sample-policy";

/**
 * REGRESSION — the founder's $10 became ONE mission × TWO testers × $5.00, for work Sage itself
 * estimated at five minutes. A dollar a minute, two data points from a budget that honestly buys ten,
 * and a standing invitation to farm.
 *
 * The policy reasoned only about sample SIZE (prefer 3) and the $0.10 floor. It never asked what a
 * completion is WORTH, so when $10 did not divide by 3 the exact-split fallback landed on 2 × $5.
 *
 * THIS MODULE HAD NO TESTS. That is how 2 × $5.00 shipped. The money property that must never break:
 * a derived sample can never be so large that a reward falls under the meaningful floor — guaranteed
 * by clamping the ceiling to `minRewardBase`, asserted below.
 */

const MIN = BigInt(100_000); // $0.10 in 6dp base units
const USD = (n: number) => BigInt(Math.round(n * 1_000_000));

const mission = (over: Partial<SampleMission> = {}): SampleMission => ({
  missionKey: "m1",
  maxCompletions: 2,
  rewardWeight: 1,
  qualitative: true,
  ...over,
});

const run = (missions: SampleMission[], budget: number, goal = "test my product") =>
  applySamplePolicy(missions, {
    goal,
    totalBudgetBase: USD(budget),
    minRewardBase: MIN,
  });

describe("the founder's exact case", () => {
  it("turns $10 for 5-minute work into ten testers, not two at $5", () => {
    const r = run([mission({ effortMinutes: 5, maxCompletions: 2 })], 10);
    expect(r.missions[0]!.maxCompletions).toBe(10);
    // $10 / 10 = $1.00 each — at the $0.20/minute ceiling for 5 minutes.
    expect(USD(10) / BigInt(r.missions[0]!.maxCompletions)).toBe(USD(1));
  });

  it("was 2 under the old behaviour, which is the bug", () => {
    // Same mission with no effort estimate keeps the pre-effort path.
    const r = run([mission({ effortMinutes: undefined, maxCompletions: 2 })], 10);
    expect(r.missions[0]!.maxCompletions).toBe(2);
  });
});

describe("THE MONEY PROPERTY — a reward can never fall under the floor", () => {
  it.each([
    [1, 1],
    [2, 5],
    [5, 10],
    [10, 30],
    [3, 100],
    [45, 2],
    [1, 1000],
  ])("effort %i min on a $%i budget still pays at least the floor", (effortMinutes, budget) => {
    const r = run([mission({ effortMinutes, maxCompletions: 1 })], budget);
    const n = BigInt(r.missions[0]!.maxCompletions);
    expect(USD(budget) / n).toBeGreaterThanOrEqual(MIN);
  });

  it("holds because the ceiling is clamped to the floor, never below it", () => {
    // A sub-floor effort ceiling (1 minute = $0.20 > floor; 0.1 minute would be $0.02 < floor).
    expect(effortCeilingBase(0.1, MIN)).toBe(MIN);
    expect(effortCeilingBase(1, MIN)).toBe(PER_MINUTE_RATE_BASE);
  });

  it("never derives a sample from a missing or nonsense effort value", () => {
    for (const bad of [undefined, 0, -5, NaN, Infinity]) {
      expect(effortCeilingBase(bad as number, MIN)).toBeNull();
    }
  });
});

describe("bounds", () => {
  it("never goes below the preferred sample", () => {
    const r = run([mission({ effortMinutes: 60, maxCompletions: 1 })], 1);
    expect(r.missions[0]!.maxCompletions).toBeGreaterThanOrEqual(1);
    expect(r.missions[0]!.maxCompletions).toBeLessThanOrEqual(PREFERRED_SAMPLE);
  });

  it("caps a huge budget at 50 rather than exploding the sample", () => {
    const r = run([mission({ effortMinutes: 1, maxCompletions: 1 })], 100_000);
    expect(r.missions[0]!.maxCompletions).toBeLessThanOrEqual(50);
  });

  it("leaves a url-verifiable mission alone — this is a qualitative-pay rule", () => {
    const r = run(
      [mission({ qualitative: false, effortMinutes: 5, maxCompletions: 2 })],
      10,
    );
    expect(r.missions[0]!.maxCompletions).toBe(2);
  });
});

describe("the overpay rule applies whether or not the goal is plural", () => {
  it("fires on a singular goal", () => {
    const r = run([mission({ effortMinutes: 5, maxCompletions: 2 })], 10, "check the signup works");
    expect(r.missions[0]!.maxCompletions).toBe(10);
    expect(r.adjusted).toBe(true);
  });

  it("fires on a plural goal too", () => {
    const r = run(
      [mission({ effortMinutes: 5, maxCompletions: 2 })],
      10,
      "I want several users to try the signup",
    );
    expect(r.missions[0]!.maxCompletions).toBe(10);
  });
});

describe("a mission's share is what pays its sample, not the whole budget", () => {
  it("splits the target by reward weight", () => {
    const r = run(
      [
        mission({ missionKey: "a", rewardWeight: 1, effortMinutes: 5, maxCompletions: 1 }),
        mission({ missionKey: "b", rewardWeight: 1, effortMinutes: 5, maxCompletions: 1 }),
      ],
      10,
    );
    // $5 each ÷ ($0.20 × 5) = 5 testers per mission, not 10.
    for (const m of r.missions) expect(m.maxCompletions).toBe(5);
  });
});
