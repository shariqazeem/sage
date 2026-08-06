import { describe, expect, it } from "vitest";

import { allocateBudget, MIN_REWARD_BASE, type WeightedMission } from "./budget";
import { splitCompletionsForSample } from "./sample-policy";

/**
 * THE FOUNDER'S ACTUAL REQUEST MUST NOT GET THE LEFTOVERS.
 *
 * Rewards have always tracked difficulty — reward is proportional to weight, so a hard mission pays
 * more per tester than an easy one. What nothing checked is how the budget SPLITS between missions,
 * because a mission's share is reward × count and the model picks the count.
 *
 * Measured on a real run: clawup.org, $120, goal "testers launch an agent, which needs topping up
 * credits and paying for compute first". The model proposed 3 testers for that 25-minute paid
 * mission and 17 for a five-minute "quote the Terms of Service effective date". The compiler
 * executed both faithfully and the founder's actual request took $20.80 while the legal-docs check
 * took $44.20 — two thirds of the money to read back the same fixed string seventeen times.
 *
 * These are the numbers from that run.
 */

const GATED: WeightedMission = {
  missionKey: "gated-payment",
  weight: 8,
  suggestedMaxCompletions: 3,
  priority: "high",
  effortMinutes: 25,
};
const TERMS: WeightedMission = {
  missionKey: "terms-and-privacy-transparency",
  weight: 3,
  suggestedMaxCompletions: 17,
  priority: "high",
  effortMinutes: 5,
};

const usd = (n: number) => BigInt(Math.round(n * 1e6));
const spend = (a: ReturnType<typeof allocateBudget>, key: string) => {
  const m = a.missions.find((x) => x.missionKey === key)!;
  return m.rewardBase * m.maxCompletions;
};

describe("budget share follows the plan's top mission", () => {
  it("stops a cheap mission from out-spending the one the founder asked about", () => {
    const a = allocateBudget([GATED, TERMS], usd(65));
    expect(a.ok).toBe(true);
    // The measured failure: $20.80 to the paid mission, $44.20 to the legal check.
    expect(spend(a, "gated-payment")).toBeGreaterThanOrEqual(spend(a, "terms-and-privacy-transparency"));
  });

  it("keeps the exact-allocation invariant while trimming", () => {
    const a = allocateBudget([GATED, TERMS], usd(65));
    const summed = a.missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));
    expect(summed).toBe(usd(65));
    expect(a.allocatedBase).toBe(usd(65));
  });

  it("trims only the count, so reward still tracks difficulty", () => {
    const a = allocateBudget([GATED, TERMS], usd(65));
    const gated = a.missions.find((m) => m.missionKey === "gated-payment")!;
    const terms = a.missions.find((m) => m.missionKey === "terms-and-privacy-transparency")!;
    expect(gated.rewardBase).toBeGreaterThan(terms.rewardBase); // weight 8 vs 3
    // never raised above what the model asked for, and never trimmed out of existence
    expect(terms.maxCompletions).toBeLessThanOrEqual(BigInt(17));
    expect(terms.maxCompletions).toBeGreaterThanOrEqual(BigInt(1));
  });

  it("leaves a plan that already respects the rule untouched", () => {
    // the top mission already out-spends the other — nothing to trim
    const before = allocateBudget(
      [GATED, { ...TERMS, suggestedMaxCompletions: 2 }],
      usd(65),
    );
    const terms = before.missions.find((m) => m.missionKey === "terms-and-privacy-transparency")!;
    expect(terms.maxCompletions).toBe(BigInt(2));
    expect(spend(before, "gated-payment")).toBeGreaterThanOrEqual(
      spend(before, "terms-and-privacy-transparency"),
    );
  });

  it("reverses by itself when breadth IS the point", () => {
    // Give the broad mission the higher priority and it becomes the balancer — then IT is the one
    // guaranteed the larger share, and the rule reads the same way round.
    const a = allocateBudget(
      [{ ...GATED, priority: "medium" }, { ...TERMS, priority: "high" }],
      usd(65),
    );
    expect(a.ok).toBe(true);
    expect(spend(a, "terms-and-privacy-transparency")).toBeGreaterThanOrEqual(
      spend(a, "gated-payment"),
    );
  });

  /**
   * The pipeline does not ship `allocateBudget`'s output directly — `splitCompletionsForSample` runs
   * after it and can RAISE a mission's completion count toward the sampled target. It holds the pot
   * bit for bit while doing so, which is exactly why it cannot undo a share trim: this rule is about
   * money, and the split only ever redistributes money already inside one mission. Worth pinning,
   * because a later change to the split that touched the pot would silently reopen the defect.
   */
  it("survives the sample split that runs after it", () => {
    const a = allocateBudget([GATED, TERMS], usd(65));
    const target = new Map([
      ["terms-and-privacy-transparency", 17], // the model's original ask, back again
      ["gated-payment", 3],
    ]);
    const after = splitCompletionsForSample(a.missions, target, MIN_REWARD_BASE);
    const spendOf = (key: string) => {
      const m = after.find((x) => x.missionKey === key)!;
      return m.rewardBase * m.maxCompletions;
    };
    expect(spendOf("gated-payment")).toBeGreaterThanOrEqual(
      spendOf("terms-and-privacy-transparency"),
    );
    expect(after.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0))).toBe(usd(65));
  });

  it("holds across budgets, and never strands a unit", () => {
    for (const b of [5, 20, 65, 120, 500, 5_000, 50_000]) {
      const a = allocateBudget([GATED, TERMS], usd(b));
      if (!a.ok) continue;
      const summed = a.missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));
      expect(summed, `budget $${b} must allocate exactly`).toBe(usd(b));
      if (a.missions.length === 2) {
        expect(spend(a, "gated-payment"), `budget $${b} share`).toBeGreaterThanOrEqual(
          spend(a, "terms-and-privacy-transparency"),
        );
      }
    }
  });
});
