import { describe, expect, it } from "vitest";

import { allocateBudget, MAX_COMPLETIONS, MIN_REWARD_BASE, type WeightedMission } from "./budget";
import { applySamplePolicy } from "./sample-policy";

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

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * MORE MONEY THAN WORK IS A QUESTION, NOT A BIGGER REWARD.
 *
 * A plan has a real capacity: every mission is bounded by MAX_SAMPLE testers at its own effort
 * ceiling. Past that, extra budget does not buy more testing — it just inflates each payment.
 * Measured on a live run: clawup.org at $401 produced one 5-minute mission and paid 50 testers
 * $8.02 each, eight times the $0.20-per-minute ceiling the policy exists to hold.
 */
const sm = (missionKey: string, effortMinutes: number | undefined, maxCompletions = 1) => ({
  missionKey, rewardWeight: 5, maxCompletions, qualitative: true, effortMinutes,
});
const policy = (budgetUsd: number, missions: ReturnType<typeof sm>[]) =>
  applySamplePolicy(missions as never, {
    goal: "have several users try it",
    totalBudgetBase: BigInt(Math.round(budgetUsd * 1e6)),
    minRewardBase: MIN_REWARD_BASE,
  } as never);

describe("over-funding is surfaced, not absorbed", () => {
  it("$401 on a single five-minute mission asks the founder", () => {
    const r = policy(401, [sm("logo", 5)]);
    expect(r.reason).toBe("over_funded");
    expect(r.note).toMatch(/larger than the plan can spend/i);
    // ADVISORY: a question would force needs_input and hand a well-funded founder no plan at all.
    expect(r.question).toBeNull();
    // It quotes the honest capacity: 50 testers x the $1.00 ceiling for five minutes.
    expect(Number(r.absorbableBase) / 1e6).toBeCloseTo(50, 0);
  });

  it("a budget that fits is not flagged", () => {
    // Two 20-minute missions at three testers each is a $24 capacity; $18 sits comfortably inside it.
    const r = policy(18, [sm("a", 20), sm("b", 20)]);
    expect(r.reason).not.toBe("over_funded");
    expect(r.note ?? null).toBeNull();
  });

  it("says nothing when effort is unknown, rather than guessing a rate", () => {
    // $1.50 across three testers is $0.50 each, which is fine. A fallback ceiling called that
    // over-funded — an unsubstantiated warning about a founder's money is worse than none.
    const r = policy(1.5, [sm("legacy", undefined)]);
    expect(r.reason).not.toBe("over_funded");
    expect(r.note ?? null).toBeNull();
    expect(r.absorbableBase ?? null).toBeNull();
  });

  it("one mission without effort data suppresses the judgement for the whole plan", () => {
    const r = policy(5_000, [sm("known", 5), sm("unknown", undefined)]);
    expect(r.reason).not.toBe("over_funded");
  });
});

describe("over-funding is checked on EVERY path, not just the happy one", () => {
  it("a singular goal is still checked", () => {
    // The first version put this at the bottom of the plural path, and a singular goal walked past
    // it. That is how a live clawup run paid $35.48 a head for five minutes and said nothing.
    const r = applySamplePolicy([sm("solo", 5)] as never, {
      goal: "check that a user can do the thing",
      totalBudgetBase: BigInt(403_000_000),
      minRewardBase: MIN_REWARD_BASE,
    } as never);
    expect(r.reason).toBe("over_funded");
    expect(r.note).toMatch(/larger than the plan can spend/i);
    // ADVISORY: a question would force needs_input and hand a well-funded founder no plan at all.
    expect(r.question).toBeNull();
  });

  it("an already-sampled plan is still checked", () => {
    const r = applySamplePolicy([sm("a", 5, 3), sm("b", 5, 3)] as never, {
      goal: "have a few users try it",
      totalBudgetBase: BigInt(5_000_000_000),
      minRewardBase: MIN_REWARD_BASE,
    } as never);
    expect(r.reason).toBe("over_funded");
  });

  it("never overwrites the more specific budget_limited question", () => {
    // A plan that cannot afford two fair rewards has a better thing to say than "too much money".
    const r = applySamplePolicy([sm("hard", 20)] as never, {
      goal: "have several users try it",
      totalBudgetBase: BigInt(1_500_000),
      minRewardBase: MIN_REWARD_BASE,
    } as never);
    expect(r.reason).toBe("budget_limited");
    expect(r.question).toMatch(/only funds one fair reward/i);
  });
});

describe("a generous budget must never cost a founder their plan", () => {
  it("over-funding sets a NOTE and leaves question null on every path", () => {
    // The pipeline turns any `question` into needs_input with no plan. Measured on the P-GEN
    // battery at ~$910: excalidraw, play2048 and tailwindcss all went from a working plan to zero
    // missions because this was written as a question. It is advice; the plan still ships.
    const cases: [string, number, ReturnType<typeof sm>[]][] = [
      ["singular goal", 403, [sm("solo", 5)]],
      ["plural goal", 5_000, [sm("a", 5, 3), sm("b", 5, 3)]],
      ["already sampled", 5_000, [sm("a", 5, 3), sm("b", 5, 3)]],
      ["founder scale", 50_000, [sm("a", 5), sm("b", 20), sm("c", 60)]],
    ];
    for (const [label, usdAmt, ms] of cases) {
      const r = applySamplePolicy(ms as never, {
        goal: label === "singular goal" ? "check the thing" : "have several users try it",
        totalBudgetBase: BigInt(Math.round(usdAmt * 1e6)),
        minRewardBase: MIN_REWARD_BASE,
      } as never);
      expect(r.question, `${label} must not block`).toBeNull();
      expect(r.missions.length, `${label} must still return missions`).toBeGreaterThan(0);
    }
  });

  it("a budget that genuinely cannot pay a sample DOES still block", () => {
    // The distinction that matters: too little money is a question, too much is a note.
    const r = applySamplePolicy([sm("hard", 20)] as never, {
      goal: "have several users try it",
      totalBudgetBase: BigInt(1_500_000),
      minRewardBase: MIN_REWARD_BASE,
    } as never);
    expect(r.question).toMatch(/only funds one fair reward/i);
  });
});
