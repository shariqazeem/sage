import { describe, expect, it } from "vitest";
import { firstUnmetStrictCondition } from "./mission-canary";
import { COMPILER_AUTHOR_ID, COMPILER_AUTHOR_PROVIDER } from "./mission-grounding-shadow";
import type { GroundedCandidatePlan } from "./mission-grounding-shadow";

/**
 * A model that was never CONSULTED has no provenance to report, and that must not read as
 * provenance MISSING.
 *
 * MEASURED on useagora: Sage's deterministic compiler authored the mission from observed facts, so
 * the architect model was never called and every architect metadata field was null. The plan —
 * grounded, allocated exactly, 8 of 9 signals true — was rejected as `provenance_missing` at the
 * precise moment its provenance was STRONGEST: no model asserted anything, so there was no model
 * assertion to attribute. What shipped instead was the legacy plan, which records no grounding.
 */
const allSignals = {
  architectStrictValid: true, compilerProducedMissions: true, everyCriterionCriticSupported: true,
  allDecisiveGrounded: true, noInferredOnlyDecisive: true, safeTransitionsEstablished: true,
  canonicalGatePassed: true, allocationExactEqual: true, provenancePresent: true,
};
const plan = (over: Partial<GroundedCandidatePlan> = {}): GroundedCandidatePlan =>
  ({
    missions: [{ missionKey: "m1" }],
    suppliedBudgetBase: "1000000",
    allocatedBudgetBase: "1000000",
    architectModel: COMPILER_AUTHOR_ID,
    architectProvider: COMPILER_AUTHOR_PROVIDER,
    criticModel: "MiniMax-M3",
    criticProvider: "api.minimax.io",
    observationSetDigest: "d",
    signals: allSignals,
    strictSelectable: true,
    ...over,
  }) as unknown as GroundedCandidatePlan;

describe("compiler-authored provenance", () => {
  it("accepts a plan Sage's own compiler authored", () => {
    expect(firstUnmetStrictCondition(plan())).toBeNull();
  });

  it("names the real author rather than a stand-in model", () => {
    expect(COMPILER_AUTHOR_ID).toContain("compiler");
    expect(COMPILER_AUTHOR_PROVIDER).toBe("sage");
  });

  /** The relaxation must be narrow: genuinely ABSENT provenance is still rejected. */
  it("still rejects a plan with NO authorship recorded at all", () => {
    expect(firstUnmetStrictCondition(plan({ architectModel: null }))).toBe("provenance_missing");
    expect(firstUnmetStrictCondition(plan({ criticProvider: null }))).toBe("provenance_missing");
  });

  it("still rejects on any unmet signal, authorship notwithstanding", () => {
    const blocked = plan({ signals: { ...allSignals, safeTransitionsEstablished: false } });
    expect(firstUnmetStrictCondition(blocked)).toBe("signal:safeTransitionsEstablished");
  });

  it("still rejects a budget that does not balance exactly", () => {
    expect(firstUnmetStrictCondition(plan({ allocatedBudgetBase: "999999" }))).toBe("budget_not_exact_equal");
  });
});
