import { describe, expect, it } from "vitest";
import { allocateBudget, TANGIBLE_MIN_REWARD_BASE, type WeightedMission } from "./budget";
import { spreadOverpaidMissions } from "./fair-spread";
import { effortCeilingBase } from "./sample-policy";

const usd = (b: bigint) => Number(b) / 1_000_000;
const sum = (a: { missions: { rewardBase: bigint; maxCompletions: bigint }[] }) =>
  a.missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));

/** Plausible, 2 Sep P-GEN: capacity $212.80 sized at 50 × ceiling, allocated onto the model's counts. */
const PLAUSIBLE: WeightedMission[] = [
  { missionKey: "signup", weight: 8, suggestedMaxCompletions: 2, priority: "high", effortMinutes: 12 },
  { missionKey: "demo", weight: 3, suggestedMaxCompletions: 4, priority: "high", effortMinutes: 8 },
  { missionKey: "feature", weight: 3, suggestedMaxCompletions: 14, priority: "medium", effortMinutes: 8 },
  { missionKey: "docs", weight: 3, suggestedMaxCompletions: 4, priority: "medium", effortMinutes: 8 },
];
const CAPACITY = BigInt(212_800_000);

describe("spreadOverpaidMissions — the capped path pays the fair rate to more people", () => {
  it("the $76 signup becomes many completions near its fair rate, and the sum stays exact", () => {
    const first = allocateBudget(PLAUSIBLE, CAPACITY, { minRewardBase: TANGIBLE_MIN_REWARD_BASE });
    expect(first.ok).toBe(true);
    const before = first.missions.find((m) => m.missionKey === "signup")!;
    expect(usd(before.rewardBase)).toBeGreaterThan(20); // the measured defect reproduces
    const after = spreadOverpaidMissions(PLAUSIBLE, first, CAPACITY, { minRewardBase: TANGIBLE_MIN_REWARD_BASE });
    expect(after.ok).toBe(true);
    expect(sum(after)).toBe(CAPACITY);
    for (const m of after.missions) {
      const src = PLAUSIBLE.find((x) => x.missionKey === m.missionKey)!;
      const fair = Math.max(usd(effortCeilingBase(src.effortMinutes, TANGIBLE_MIN_REWARD_BASE)!), 3);
      expect(usd(m.rewardBase), `${m.missionKey} pays ${usd(m.rewardBase)} vs fair ${fair}`).toBeLessThanOrEqual(fair * 2 + 0.01);
    }
    const signup = after.missions.find((m) => m.missionKey === "signup")!;
    expect(Number(signup.maxCompletions)).toBeGreaterThan(10);
  });

  it("a plan already at fair rates is returned untouched", () => {
    const fair: WeightedMission[] = [
      { missionKey: "a", weight: 5, suggestedMaxCompletions: 10, priority: "high", effortMinutes: 10 },
      { missionKey: "b", weight: 5, suggestedMaxCompletions: 10, priority: "medium", effortMinutes: 10 },
    ];
    const budget = BigInt(60_000_000); // $3 × 20
    const first = allocateBudget(fair, budget, { minRewardBase: TANGIBLE_MIN_REWARD_BASE });
    const after = spreadOverpaidMissions(fair, first, budget, { minRewardBase: TANGIBLE_MIN_REWARD_BASE });
    expect(after).toBe(first);
  });

  it("Tailwind, 2 Sep: $55.74 × 3 for a 30-minute task beside $5.81 × 27", () => {
    const tw: WeightedMission[] = [
      { missionKey: "dark", weight: 9, suggestedMaxCompletions: 3, priority: "medium", effortMinutes: 30 },
      { missionKey: "responsive", weight: 4, suggestedMaxCompletions: 27, priority: "medium", effortMinutes: 30 },
    ];
    const capacity = BigInt(324_090_000);
    const first = allocateBudget(tw, capacity, { minRewardBase: TANGIBLE_MIN_REWARD_BASE });
    const after = spreadOverpaidMissions(tw, first, capacity, { minRewardBase: TANGIBLE_MIN_REWARD_BASE });
    expect(sum(after)).toBe(capacity);
    for (const m of after.missions) expect(usd(m.rewardBase)).toBeLessThanOrEqual(6 * 2 + 0.01); // fair for 30m = $6
  });
});
