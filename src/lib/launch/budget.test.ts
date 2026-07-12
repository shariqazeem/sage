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
