import { describe, expect, it } from "vitest";
import {
  campaignIdHash,
  computeCampaignPlan,
  missionIdHash,
  missionPlanBudget,
  validateMissionPlan,
  type MissionInput,
} from "./mission-plan";

const plan = (): MissionInput[] => [
  { missionKey: "load", rewardBase: BigInt(500_000), maxCompletions: BigInt(4) },
  { missionKey: "signup", rewardBase: BigInt(1_000_000), maxCompletions: BigInt(2) },
];

describe("validateMissionPlan — mirrors the on-chain constructor rules", () => {
  it("accepts a valid plan", () => {
    expect(validateMissionPlan(plan())).toBeNull();
  });
  it("rejects empty / too-many / duplicate / zero-reward / zero-cap", () => {
    expect(validateMissionPlan([])).toBe("no_missions");
    const many = Array.from({ length: 33 }, (_, i) => ({
      missionKey: `m${i}`,
      rewardBase: BigInt(1),
      maxCompletions: BigInt(1),
    }));
    expect(validateMissionPlan(many)).toBe("too_many_missions");
    expect(
      validateMissionPlan([
        { missionKey: "x", rewardBase: BigInt(1), maxCompletions: BigInt(1) },
        { missionKey: "x", rewardBase: BigInt(1), maxCompletions: BigInt(1) },
      ]),
    ).toBe("duplicate_mission_key");
    expect(
      validateMissionPlan([{ missionKey: "x", rewardBase: BigInt(0), maxCompletions: BigInt(1) }]),
    ).toBe("zero_reward");
    expect(
      validateMissionPlan([{ missionKey: "x", rewardBase: BigInt(1), maxCompletions: BigInt(0) }]),
    ).toBe("zero_max_completions");
  });
});

describe("budget + plan derivation", () => {
  it("budget is Σ (reward × maxCompletions)", () => {
    expect(missionPlanBudget(plan())).toBe(BigInt(500_000 * 4 + 1_000_000 * 2)); // 4_000_000
  });
  it("computeCampaignPlan is deterministic + nonzero identity", () => {
    const a = computeCampaignPlan("camp-1", plan());
    const b = computeCampaignPlan("camp-1", plan());
    expect(a.campaignIdHash).toBe(b.campaignIdHash);
    expect(a.missionPlanDigest).toBe(b.missionPlanDigest);
    expect(a.budgetBase).toBe(BigInt(4_000_000));
    expect(a.campaignIdHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.specs).toHaveLength(2);
  });
  it("different campaigns / missions get distinct hashes", () => {
    expect(campaignIdHash("a")).not.toBe(campaignIdHash("b"));
    expect(missionIdHash("c", "m1")).not.toBe(missionIdHash("c", "m2"));
    expect(missionIdHash("c", "m1")).not.toBe(missionIdHash("d", "m1"));
  });
});
