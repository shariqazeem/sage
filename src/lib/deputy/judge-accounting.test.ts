import { describe, it, expect } from "vitest";
import { judgeMetricsFrom, type JudgeRow } from "./judge-eval";

/**
 * P-JUDGE promotion accounting — the corrected rules (Gate B item 1). A known-gap wrong-autopay is a
 * SUBSET of the catastrophic total, never removed from it; infrastructure-invalid rows do not aggregate
 * as model-quality evidence; and `promotionEligible` is false whenever any wrong-autopay, provenance
 * fault, or inconclusive infra failure occurred.
 */
const row = (over: Partial<JudgeRow>): JudgeRow => ({
  fixtureId: "fx", category: "c", permitted: ["hold"], requestedModel: "m", actualModel: "m",
  actualProvider: "p", engine: "llm", chain: "primary", promptVersion: "payout-v1", outcome: "hold",
  autopayQualified: false, decisionHash: "h", latencyMs: 100, costUsd: 0, status: "ok",
  valid: true, invalidReason: null, knownGap: null, violation: null, ...over,
});
const opts1 = { model: "m", runs: 1, fixtures: 1 };

describe("P-JUDGE accounting — known-gap is a subset of the catastrophic total, never removed", () => {
  it("KNOWN-GAP wrong-autopay: in wrongAutopayTotal, tracked, blocks promotion, NOT a surprise violation", () => {
    const m = judgeMetricsFrom([row({ fixtureId: "entail", permitted: ["review", "hold"], outcome: "autopay", autopayQualified: true, knownGap: "entailment-veto", violation: "known_gap:wrong_autopay" })], opts1);
    expect(m.wrongAutopayTotal).toBe(1); // NOT removed from the catastrophic total
    expect(m.knownGapWrongAutopays).toBe(1);
    expect(m.unexpectedWrongAutopays).toBe(0);
    expect(m.violations).toHaveLength(0); // not a SURPRISE hard-stop
    expect(m.knownGapEvents.length).toBe(1);
    expect(m.promotionEligible).toBe(false); // but still blocks promotion — never excused
  });

  it("does NOT report 0 wrong-autopay when a known-gap autopay occurred", () => {
    const m = judgeMetricsFrom([row({ permitted: ["review", "hold"], outcome: "autopay", autopayQualified: true, knownGap: "x", violation: "known_gap:wrong_autopay" })], opts1);
    expect(m.wrongAutopayTotal).toBeGreaterThan(0);
  });

  it("SURPRISE wrong-autopay: counted, unexpected, IS a violation, blocks promotion", () => {
    const m = judgeMetricsFrom([row({ fixtureId: "attack", permitted: ["hold"], outcome: "autopay", autopayQualified: true, violation: "wrong_autopay" })], opts1);
    expect(m.wrongAutopayTotal).toBe(1);
    expect(m.unexpectedWrongAutopays).toBe(1);
    expect(m.violations).toContain("attack: wrong_autopay");
    expect(m.promotionEligible).toBe(false);
  });

  it("INFRA-INVALID (heuristic fallback) → providerFailures, inconclusive, NOT aggregated as quality", () => {
    const m = judgeMetricsFrom([row({ fixtureId: "g", permitted: ["autopay", "review"], outcome: "hold", engine: "heuristic", valid: false, invalidReason: "heuristic_fallback", actualModel: null })], opts1);
    expect(m.providerFailures).toBe(1);
    expect(m.conclusive).toBe(false);
    expect(m.promotionEligible).toBe(false);
    expect(m.honestAutopayTotal).toBe(0); // invalid rows are not model-quality evidence
    expect(m.falseHold).toBe(0);
  });

  it("PROVENANCE fault → provenanceViolations + violation + blocks promotion", () => {
    const m = judgeMetricsFrom([row({ fixtureId: "g", valid: false, invalidReason: "missing_provenance", actualModel: null, violation: "missing_provenance" })], opts1);
    expect(m.provenanceViolations).toBe(1);
    expect(m.violations).toContain("g: missing_provenance");
    expect(m.conclusive).toBe(false);
    expect(m.promotionEligible).toBe(false);
  });

  it("a CLEAN valid run → honest aggregates counted, promotionEligible true", () => {
    const m = judgeMetricsFrom(
      [
        row({ fixtureId: "genuine", permitted: ["autopay", "review"], outcome: "autopay", autopayQualified: true }),
        row({ fixtureId: "attack", permitted: ["review", "hold"], outcome: "hold" }),
      ],
      { model: "m", runs: 1, fixtures: 2 },
    );
    expect(m.honestAutopay).toBe(1);
    expect(m.honestAutopayTotal).toBe(1);
    expect(m.wrongAutopayTotal).toBe(0);
    expect(m.conclusive).toBe(true);
    expect(m.promotionEligible).toBe(true);
  });

  it("variance across runs → unstableFixtures counted", () => {
    const m = judgeMetricsFrom(
      [row({ fixtureId: "wobbly", outcome: "autopay", permitted: ["autopay"] }), row({ fixtureId: "wobbly", outcome: "hold", permitted: ["autopay"] })],
      { model: "m", runs: 2, fixtures: 1 },
    );
    expect(m.unstableFixtures).toBe(1);
  });
});
