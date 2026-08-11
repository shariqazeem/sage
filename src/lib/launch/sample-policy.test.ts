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

describe("the founder's exact case — OVERRULED 2026-08-10, and the overrule is the spec now", () => {
  // This block once demanded $10 → 10 testers at $1.00, and called 2 × $5 "the bug". The founder
  // reversed it verbatim: "instead of paying 1 usdc to 20 people, no one will do — but if one will
  // get 5 usdc, they still think to do." Measured tester supply (~11 lifetime submissions) sides
  // with them: $1 rewards sat unfilled. Inside the tangible regime a reward is never sliced below
  // one worth taking; the ceiling half of the old rule (never $5/minute absurdity) lives on below.
  it("turns $10 for 5-minute work into three testers above the $3 floor, not ten at $1", () => {
    // THIRD revision of this pin, each by the founder: crowd ($1x10) -> curve ($5x2) -> now the
    // ARCHITECT's counts bounded only by the $3 tangible floor (2026-08-12: "let a model decide,
    // not hardcoded"). $10 at the floor funds 3.
    const r = run([mission({ effortMinutes: 5, maxCompletions: 2 })], 10);
    expect(r.missions[0]!.maxCompletions).toBe(3);
  });

  it("no effort estimate keeps the pre-effort path exactly", () => {
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
  it("still bounds the count on a singular goal — at the $3 floor, not the $1 ceiling", () => {
    const r = run([mission({ effortMinutes: 5, maxCompletions: 2 })], 10, "check the signup works");
    expect(r.missions[0]!.maxCompletions).toBe(3); // $10 / $3 floor — never ten $1 slots
  });

  it("a plural goal still buys its 3-person sample — the one case that outranks concentration", () => {
    // The founder asked for PEOPLE, plural, and one or two accounts of a subjective flow is an
    // anecdote. Three at $3.33 each stays well above cents while honoring the sample the goal
    // itself requested; the min-3 floor in tangibleSlotTarget encodes the same judgement.
    const r = run(
      [mission({ effortMinutes: 5, maxCompletions: 2 })],
      10,
      "I want several users to try the signup",
    );
    expect(r.missions[0]!.maxCompletions).toBe(3);
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
    // $5 share each ÷ one TANGIBLE reward ($5) = 1 tester per mission — the share rule still holds
    // (neither mission raids the other's pot), each tester simply earns something worth taking.
    for (const m of r.missions) expect(m.maxCompletions).toBe(1);
  });
});
