import { describe, expect, it } from "vitest";
import { effortWeights, hourlyFairness } from "./effort-weight";

/**
 * The measured inversion this exists to fix: a fifteen-minute core action paid ~$7.40/hr while a
 * five-minute homepage read paid ~$37.80/hr, because the model's confidence — not the work — set
 * the price.
 */
const m = (key: string, effortMinutes: number, priority: "high" | "medium" | "low", rewardWeight: number) =>
  ({ missionKey: key, effortMinutes, priority, rewardWeight });

describe("reward weight follows the work", () => {
  it("FIXES the measured inversion: the long mission no longer pays less per hour than the short one", () => {
    const plan = [m("core-action", 15, "high", 3), m("homepage-read", 5, "low", 8)];
    const before = hourlyFairness(plan, plan.map((x) => x.rewardWeight));
    const w = effortWeights(plan);
    const after = hourlyFairness(plan, plan.map((x) => w.get(x.missionKey)!));
    expect(before).toBeLessThan(0.2); // 3/15 vs 8/5 — the short read paid 8x the hourly rate
    expect(after).toBeGreaterThan(before);
    expect(w.get("core-action")!).toBeGreaterThan(w.get("homepage-read")!);
  });

  it("keeps a premium for a critical journey over a trivial one of the same length", () => {
    const w = effortWeights([m("critical", 10, "high", 5), m("trivial", 10, "low", 5)]);
    expect(w.get("critical")!).toBeGreaterThan(w.get("trivial")!);
  });

  it("defers to the model when effort cannot discriminate — equal estimates are not evidence", () => {
    const w = effortWeights([m("a", 10, "medium", 7), m("b", 10, "medium", 2)]);
    expect(w.get("a")).toBe(7);
    expect(w.get("b")).toBe(2);
  });

  it("defers when there is no usable estimate at all", () => {
    const w = effortWeights([m("a", 0, "medium", 6), m("b", 0, "high", 3)]);
    expect(w.get("a")).toBe(6);
    expect(w.get("b")).toBe(3);
  });

  it("never leaves the 1..10 range the budget compiler clamps to", () => {
    const w = effortWeights([m("tiny", 1, "low", 1), m("huge", 240, "high", 10), m("mid", 30, "medium", 5)]);
    for (const v of w.values()) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("one unusable estimate falls back to its own weight instead of pricing it at the floor", () => {
    const w = effortWeights([m("known", 20, "medium", 5), m("unknown", 0, "high", 9)]);
    expect(w.get("unknown")).toBe(9);
  });
});
