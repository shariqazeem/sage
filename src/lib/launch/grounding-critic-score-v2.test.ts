import { describe, it, expect } from "vitest";
import { CRITIC_CORPUS_V2, buildBatchedV3Input, corpusV2Digest, BATCH_GOAL_V2 } from "./grounding-critic-fixtures-v2";
import { scoreCriticV2, type V3VerdictOut } from "./grounding-critic-score-v2";

const ORDER = CRITIC_CORPUS_V2.map((c) => c.id);
// a PERFECT critic: for the given decision order, answer each decisionId with its case's expected verdict.
function perfect(order = ORDER): { verdicts: V3VerdictOut[]; map: Record<string, string> } {
  const { input, decisionToCaseId } = buildBatchedV3Input(order);
  const byId = new Map(CRITIC_CORPUS_V2.map((c) => [c.id, c]));
  const verdicts = input.decisions.map((d) => ({ decisionId: d.decisionId, verdict: byId.get(decisionToCaseId[d.decisionId])!.expectedVerdict }));
  return { verdicts, map: decisionToCaseId };
}

describe("corpus-v2 (no goal confound)", () => {
  it("has 16 cases under a goal that makes every positive material", () => {
    expect(CRITIC_CORPUS_V2.length).toBe(16);
    expect(BATCH_GOAL_V2).toContain("messaging exactly as displayed");
  });
  it("paySafeExpected true IFF the correct verdict is exactly supported; 1 and 2 share the identical fact", () => {
    for (const c of CRITIC_CORPUS_V2) expect(c.paySafeExpected).toBe(c.expectedVerdict === "supported" && c.acceptableVerdicts.every((v) => v === "supported"));
    const d = CRITIC_CORPUS_V2.find((c) => c.id === "displayed_claim_supported")!;
    const u = CRITIC_CORPUS_V2.find((c) => c.id === "underlying_claim_unproven")!;
    expect(JSON.stringify(d.facts)).toBe(JSON.stringify(u.facts));
    expect(d.paySafeExpected).toBe(true);
    expect(u.paySafeExpected).toBe(false);
  });
  it("corpusV2Digest is deterministic; the batched V3 input carries the single goal + 16 decisions + a Sage-owned map", () => {
    expect(corpusV2Digest()).toBe(corpusV2Digest());
    const { input, decisionToCaseId } = buildBatchedV3Input(ORDER);
    expect(input.founderGoalUntrusted).toBe(BATCH_GOAL_V2);
    expect(input.decisions.length).toBe(16);
    expect(input.decisions[0].decisionId).toBe("d0");
    expect(Object.keys(decisionToCaseId).length).toBe(16);
    // the decisions expose evidence but NO case identity — the model can't learn the expected answer.
    expect(JSON.stringify(input.decisions)).not.toContain("expectedVerdict");
    expect(JSON.stringify(input.decisions)).not.toContain("paySafeExpected");
  });
});

describe("scorer-v2 (binds on Sage-owned decisionIds, model-blind)", () => {
  it("a PERFECT critic scores falseSupported 0, full coverage, every contrast correct", () => {
    const { verdicts, map } = perfect();
    const s = scoreCriticV2(verdicts, map);
    expect(s.strictSchemaValid).toBe(true);
    expect(s.exactDecisionCoverage).toBe(true);
    expect(s.falseSupported).toBe(0);
    expect(s.falseRejected).toBe(0);
    expect(s.exactVerdictAccuracy).toBe(1);
    expect(s.supportedRecall).toBe(1);
    expect(s.pairedContrastCorrect).toBe(s.totalPairs);
    expect(s.displayVsTruthCorrect && s.goalAlignmentCorrect && s.actionCausalityCorrect && s.injectionCaseCorrect).toBe(true);
  });
  it("FALSE SUPPORT is always detected (supported on a paySafe=false case)", () => {
    const { verdicts, map } = perfect();
    const caseToDid = Object.fromEntries(Object.entries(map).map(([d, c]) => [c, d]));
    const mutated = verdicts.map((v) => (v.decisionId === caseToDid["underlying_claim_unproven"] ? { ...v, verdict: "supported" } : v));
    const s = scoreCriticV2(mutated, map);
    expect(s.falseSupported).toBe(1);
    expect(s.falseSupportedCaseIds).toContain("underlying_claim_unproven");
  });
  it("a decision binds to canonical provenance even when the OUTPUT ROWS are reordered", () => {
    const { verdicts, map } = perfect();
    const reversed = [...verdicts].reverse();
    expect(JSON.stringify(scoreCriticV2(reversed, map))).toBe(JSON.stringify(scoreCriticV2(verdicts, map)));
  });
  it("UNKNOWN / DUPLICATE decisionIds fail strict schema; a MISSING decisionId fails exact coverage", () => {
    const { verdicts, map } = perfect();
    expect(scoreCriticV2([...verdicts, { decisionId: "d999", verdict: "supported" }], map).strictSchemaValid).toBe(false);
    expect(scoreCriticV2([...verdicts, verdicts[0]], map).duplicateDecisionCount).toBe(1);
    expect(scoreCriticV2(verdicts.slice(0, 15), map).exactDecisionCoverage).toBe(false);
  });
  it("scoring is model-blind + confidence-agnostic; supportedPrecision is the SUPPORTED-class precision", () => {
    const { verdicts, map } = perfect();
    const withNoise = verdicts.map((v) => ({ ...v, confidence: 0.99, servedModel: "secret" } as V3VerdictOut));
    expect(JSON.stringify(scoreCriticV2(withNoise, map))).toBe(JSON.stringify(scoreCriticV2(verdicts, map)));
    expect(scoreCriticV2(verdicts, map).supportedPrecision).toBe(1); // all supported verdicts are truly paySafe
  });
});
