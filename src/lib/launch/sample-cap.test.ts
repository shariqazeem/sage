import { describe, it, expect } from "vitest";
import { applySamplePolicy, PREFERRED_SAMPLE } from "./sample-policy";
import { MIN_REWARD_BASE } from "./budget";

/**
 * REGRESSION — three live runs on a $1.50 budget came back as **15 testers at $0.10 each**, the
 * smallest reward the system permits. The model had proposed ten completions for a qualitative
 * mission; the policy only ever raised counts toward the preferred sample, never lowered them, so
 * it stepped aside ("already_sampled") and the allocator spread the pot to the floor.
 *
 * Past a small independent sample, another tester buys no extra confidence — it only shrinks
 * everyone's share. So the preferred sample is a target in BOTH directions.
 */

const m = (over: Partial<{ maxCompletions: number; qualitative: boolean; rewardWeight: number }> = {}) => ({
  missionKey: "k",
  maxCompletions: 10,
  rewardWeight: 5,
  qualitative: true,
  ...over,
});
const opts = (goal: string, budget = BigInt(1_500_000)) => ({
  goal,
  totalBudgetBase: budget,
  minRewardBase: MIN_REWARD_BASE,
});

describe("the preferred sample is a ceiling too", () => {
  it("caps an over-proposed qualitative mission (the 15 × $0.10 run)", () => {
    const r = applySamplePolicy([m({ maxCompletions: 10 })], opts("make users walk in and talk to her"));
    expect(r.missions[0]!.maxCompletions).toBe(PREFERRED_SAMPLE);
    expect(r.adjusted).toBe(true);
    expect(r.reason).toBe("capped_to_sample");
  });

  it("caps even when the request was worded in the singular — it is about the reward, not the plural", () => {
    const r = applySamplePolicy([m({ maxCompletions: 12 })], opts("a tester should talk to her"));
    expect(r.missions[0]!.maxCompletions).toBe(PREFERRED_SAMPLE);
    expect(r.reason).toBe("capped_to_sample");
  });

  it("leaves a URL-verifiable mission alone — a deterministic check is cheap to repeat", () => {
    const r = applySamplePolicy(
      [m({ maxCompletions: 25, qualitative: false })],
      opts("make users sign up"),
    );
    expect(r.missions[0]!.maxCompletions).toBe(25);
  });

  it("still RAISES a thin sample for a plural request", () => {
    const r = applySamplePolicy([m({ maxCompletions: 1 })], opts("make users walk in"));
    expect(r.missions[0]!.maxCompletions).toBe(PREFERRED_SAMPLE);
    expect(r.reason).toBe("raised_to_sample");
  });

  it("a singular request with a thin sample is still left alone", () => {
    const r = applySamplePolicy([m({ maxCompletions: 1 })], opts("a tester should walk in"));
    expect(r.missions[0]!.maxCompletions).toBe(1);
    expect(r.reason).toBe("not_plural");
  });

  it("exactly the preferred sample is untouched", () => {
    const r = applySamplePolicy([m({ maxCompletions: PREFERRED_SAMPLE })], opts("make users walk in"));
    expect(r.missions[0]!.maxCompletions).toBe(PREFERRED_SAMPLE);
    expect(r.adjusted).toBe(false);
    expect(r.reason).toBe("already_sampled");
  });

  it("never mutates the caller's missions", () => {
    const input = [m({ maxCompletions: 10 })];
    applySamplePolicy(input, opts("make users walk in"));
    expect(input[0]!.maxCompletions).toBe(10);
  });

  it("the capped plan pays a meaningful reward instead of the floor", () => {
    // $1.50 across 3 → $0.50 each, five times the $0.10 floor the run actually produced
    const r = applySamplePolicy([m({ maxCompletions: 10 })], opts("make users walk in"));
    const each = BigInt(1_500_000) / BigInt(r.missions[0]!.maxCompletions);
    expect(each).toBe(BigInt(500_000));
    expect(each).toBeGreaterThan(MIN_REWARD_BASE);
  });
});
