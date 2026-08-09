import { describe, expect, it } from "vitest";
import { allocateBudget, MIN_REWARD_BASE, type WeightedMission } from "./budget";
import type { MissionPriority } from "./schemas";

/**
 * The money invariant is load-bearing: Σ(rewardBase × maxCompletions) === budget,
 * EXACTLY, in integer base units, deterministically. These tests pin vectors and
 * fuzz thousands of random plans; a single base-unit drift fails the suite.
 */

/** Deterministic PRNG (mulberry32) so a fuzz failure reproduces exactly. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRIS: MissionPriority[] = ["high", "medium", "low"];

function randomMissions(r: () => number, n: number): WeightedMission[] {
  return Array.from({ length: n }, (_, i) => ({
    missionKey: `m-${i}`,
    weight: 1 + Math.floor(r() * 10),
    suggestedMaxCompletions: 1 + Math.floor(r() * 8),
    priority: PRIS[Math.floor(r() * 3)],
    effortMinutes: 5 + Math.floor(r() * 55),
  }));
}

const sum = (a: { rewardBase: bigint; maxCompletions: bigint }[]) =>
  a.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));

describe("allocateBudget — exact equality + no dust", () => {
  it("a simple 3-mission plan sums to the budget exactly", () => {
    const missions: WeightedMission[] = [
      { missionKey: "journey", weight: 9, suggestedMaxCompletions: 1, priority: "high", effortMinutes: 30 },
      { missionKey: "onboarding", weight: 5, suggestedMaxCompletions: 4, priority: "medium", effortMinutes: 15 },
      { missionKey: "mobile", weight: 4, suggestedMaxCompletions: 3, priority: "low", effortMinutes: 12 },
    ];
    const r = allocateBudget(missions, BigInt(5_000_000)); // $5.00
    expect(r.ok).toBe(true);
    expect(r.allocatedBase).toBe(BigInt(5_000_000));
    expect(sum(r.missions)).toBe(BigInt(5_000_000));
    for (const m of r.missions) expect(m.rewardBase).toBeGreaterThanOrEqual(MIN_REWARD_BASE);
  });

  it("FUZZ: 4000 random feasible plans all sum to the budget exactly, no dust", () => {
    const r = rng(1234567);
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const n = 1 + Math.floor(r() * 6);
      const missions = randomMissions(r, n);
      // a feasible budget: at least MIN per mission-completion, plus headroom.
      const minSpend = missions.reduce((s, m) => s + MIN_REWARD_BASE * BigInt(Math.max(1, m.suggestedMaxCompletions)), BigInt(0));
      const budget = minSpend + BigInt(Math.floor(r() * 20_000_000));
      const a = allocateBudget(missions, budget);
      if (!a.ok) continue; // an occasional dropped-scope plan is legitimate
      checked++;
      expect(sum(a.missions)).toBe(budget); // EXACT
      expect(a.allocatedBase).toBe(budget);
      for (const m of a.missions) {
        expect(m.rewardBase).toBeGreaterThanOrEqual(MIN_REWARD_BASE); // no dust
        expect(m.maxCompletions).toBeGreaterThanOrEqual(BigInt(1));
      }
    }
    expect(checked).toBeGreaterThan(3000); // the vast majority were fundable + exact
  });

  it("is deterministic — identical inputs produce an identical allocation", () => {
    const missions = randomMissions(rng(42), 5);
    const a = allocateBudget(missions, BigInt(3_333_333));
    const b = allocateBudget(missions, BigInt(3_333_333));
    expect(JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(
      JSON.stringify(b, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
  });

  it("higher weight earns a higher-or-equal per-completion reward", () => {
    const missions: WeightedMission[] = [
      { missionKey: "hi", weight: 10, suggestedMaxCompletions: 2, priority: "medium", effortMinutes: 20 },
      { missionKey: "lo", weight: 1, suggestedMaxCompletions: 2, priority: "medium", effortMinutes: 20 },
    ];
    const r = allocateBudget(missions, BigInt(4_000_000));
    expect(r.ok).toBe(true);
    const hi = r.missions.find((m) => m.missionKey === "hi")!;
    const lo = r.missions.find((m) => m.missionKey === "lo")!;
    expect(hi.rewardBase).toBeGreaterThanOrEqual(lo.rewardBase);
  });
});

describe("allocateBudget — infeasible + edge budgets", () => {
  it("a budget below the minimum reward is refused (ask for more)", () => {
    const missions: WeightedMission[] = [
      { missionKey: "a", weight: 5, suggestedMaxCompletions: 1, priority: "high", effortMinutes: 10 },
    ];
    const r = allocateBudget(missions, BigInt(50_000)); // $0.05 < $0.10 floor
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/budget too small|at least/i);
  });

  it("no missions → refused", () => {
    expect(allocateBudget([], BigInt(1_000_000)).ok).toBe(false);
  });

  it("a tight budget reduces scope rather than fabricating an over-budget plan", () => {
    const missions: WeightedMission[] = [
      { missionKey: "a", weight: 9, suggestedMaxCompletions: 1, priority: "high", effortMinutes: 30 },
      { missionKey: "b", weight: 5, suggestedMaxCompletions: 5, priority: "medium", effortMinutes: 15 },
      { missionKey: "c", weight: 4, suggestedMaxCompletions: 5, priority: "low", effortMinutes: 15 },
    ];
    // only enough for ~1 mission at the floor.
    const r = allocateBudget(missions, BigInt(150_000)); // $0.15
    expect(r.ok).toBe(true);
    expect(sum(r.missions)).toBe(BigInt(150_000)); // still exact
    expect(r.missions.length).toBeLessThan(missions.length); // scope reduced
    // the surviving mission is the highest-priority one.
    expect(r.missions[0].missionKey).toBe("a");
  });

  it("a single mission takes the whole budget in one completion", () => {
    const r = allocateBudget(
      [{ missionKey: "only", weight: 7, suggestedMaxCompletions: 3, priority: "high", effortMinutes: 25 }],
      BigInt(750_000),
    );
    expect(r.ok).toBe(true);
    expect(sum(r.missions)).toBe(BigInt(750_000));
  });
});

/**
 * THE TANGIBLE-REWARD PASS — the founder's sizing, verbatim: "instead of paying 1 usdc to 20
 * people, no one will do — but if one will get 5 usdc, they still think to do." Measured tester
 * supply (~11 lifetime submissions) says the same thing: slots for a crowd that does not exist.
 */
import { applyTangibleCaps, tangibleSlotTarget, tangiblePerRewardUsd, TANGIBLE_SLOT_USD, TANGIBLE_MAX_REWARD_USD } from "./budget";

const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));
const wm = (key: string, cap: number, priority: "high" | "medium" | "low" = "medium", weight = 5) => ({
  missionKey: key, suggestedMaxCompletions: cap, weight, effortMinutes: 10, priority,
});

describe("the monotone tangible curve — both numbers grow with budget", () => {
  // The founder's second correction, verbatim: "with more budget it should be slight more slots
  // but per person payout should be more too — why would 4$ of payout with that much budget?"
  // The first pass had a $600 cliff where a $1,000 campaign paid LESS per person than a $500 one.
  it("per-person pay grows as sqrt(budget), anchored at $20 -> $5, capped at $50", () => {
    expect(TANGIBLE_SLOT_USD).toBe(5);
    expect(tangiblePerRewardUsd(usdc(20))).toBeCloseTo(5, 1);
    expect(tangiblePerRewardUsd(usdc(100))).toBeCloseTo(11.18, 1);
    expect(tangiblePerRewardUsd(usdc(500))).toBeCloseTo(25, 1);
    expect(tangiblePerRewardUsd(usdc(1000))).toBeCloseTo(35.36, 1);
    expect(tangiblePerRewardUsd(usdc(50_000))).toBe(TANGIBLE_MAX_REWARD_USD); // whale cap
  });

  it("slots ALSO grow with budget — never fewer people for more money", () => {
    expect(tangibleSlotTarget(usdc(20))).toBe(4);
    expect(tangibleSlotTarget(usdc(100))).toBe(8);
    expect(tangibleSlotTarget(usdc(500))).toBe(20);
    expect(tangibleSlotTarget(usdc(1000))).toBe(28);
    expect(tangibleSlotTarget(usdc(10))).toBe(3); // floor: never a single data point
  });

  it("per-person pay is MONOTONE — a bigger budget never pays each person less", () => {
    let prev = 0;
    for (const b of [10, 20, 50, 100, 250, 500, 600, 601, 750, 1000, 5000, 50_000]) {
      const per = tangiblePerRewardUsd(usdc(b));
      expect(per, `$${b} pays $${per}/person, below $${prev} at a smaller budget`).toBeGreaterThanOrEqual(prev);
      prev = per;
    }
  });
});

describe("applyTangibleCaps", () => {
  it("turns $1 x 20 into concentrated rewards on a $20 budget", () => {
    const out = applyTangibleCaps([wm("a", 20, "high")], usdc(20));
    expect(out[0].suggestedMaxCompletions).toBe(4); // $20 / 4 = $5 per person
  });

  it("trims the LOWEST-priority mission first and keeps original order", () => {
    const out = applyTangibleCaps(
      [wm("low1", 10, "low"), wm("hi", 10, "high")],
      usdc(20), // target 4
    );
    expect(out.map((m) => m.missionKey)).toEqual(["low1", "hi"]); // order untouched
    const low = out[0].suggestedMaxCompletions;
    const hi = out[1].suggestedMaxCompletions;
    expect(low + hi).toBe(4);
    expect(hi).toBeGreaterThanOrEqual(low); // the founder's ask keeps more of its slots
  });

  it("never drops a mission and never goes below 1 each, even when count exceeds the target", () => {
    const five = ["a", "b", "c", "d", "e"].map((k) => wm(k, 6));
    const out = applyTangibleCaps(five, usdc(20)); // target 4 < 5 missions
    expect(out).toHaveLength(5);
    for (const m of out) expect(m.suggestedMaxCompletions).toBe(1);
  });

  it("a whale budget buys the full crowd at the $50 cap, not inflated rewards", () => {
    // $50,000 at $50/person targets 1000 slots; two missions at 50 each are already inside it.
    const big = applyTangibleCaps([wm("a", 50), wm("b", 50)], usdc(50_000));
    expect(big.map((m) => m.suggestedMaxCompletions)).toEqual([50, 50]); // untouched
  });

  it("is a no-op when the plan is already concentrated", () => {
    const out = applyTangibleCaps([wm("a", 2), wm("b", 2)], usdc(20));
    expect(out.map((m) => m.suggestedMaxCompletions)).toEqual([2, 2]);
  });

  it("keeps the exactness invariant end to end through allocateBudget", () => {
    const alloc = allocateBudget(
      [wm("hero", 20, "high", 8), wm("side", 10, "low", 3)],
      usdc(20),
    );
    expect(alloc.ok).toBe(true);
    const total = alloc.missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));
    expect(total).toBe(usdc(20)); // Σ(reward × slots) === budget, exactly
    const slots = alloc.missions.reduce((s, m) => s + Number(m.maxCompletions), 0);
    expect(slots).toBeLessThanOrEqual(4);
    for (const m of alloc.missions) {
      expect(m.rewardBase).toBeGreaterThanOrEqual(usdc(1)); // nothing pays cents anymore
    }
  });
});
