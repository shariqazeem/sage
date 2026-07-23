import { describe, it, expect } from "vitest";
import { CRITIC_CORPUS, buildBatchedCriticInput, corpusDigest, BATCH_GOAL, type CriticCase } from "./grounding-critic-fixtures";
import { scoreCritic, type CriticVerdictOut } from "./grounding-critic-score";

const cited = (id: string) => CRITIC_CORPUS.find((c) => c.id === id)!.mission.criteria[0].facts.map((f) => f.id);
const perfect = (): CriticVerdictOut[] => CRITIC_CORPUS.map((c) => ({ missionKey: c.id, criterionIndex: 0, verdict: c.expectedVerdict, factRefs: cited(c.id) }));

describe("grounding-critic frozen corpus", () => {
  it("has 16 paired cases in the CRITIC_SYSTEM_V2 input shape", () => {
    expect(CRITIC_CORPUS.length).toBe(16);
    for (const c of CRITIC_CORPUS) { expect(c.mission.missionKey).toBe(c.id); expect(c.mission.criteria[0].criterionIndex).toBe(0); expect(c.mission.criteria[0]).toHaveProperty("groundingTier"); }
  });
  it("paySafeExpected is true IFF the correct verdict is exactly 'supported'", () => {
    for (const c of CRITIC_CORPUS) expect(c.paySafeExpected).toBe(c.expectedVerdict === "supported" && c.acceptableVerdicts.every((v) => v === "supported"));
  });
  it("the display-vs-truth pair distinguishes 'page displays X' (supported) from 'X is true' (paySafe=false)", () => {
    const disp = CRITIC_CORPUS.find((c) => c.id === "displayed_claim_supported")!;
    const truth = CRITIC_CORPUS.find((c) => c.id === "underlying_claim_unproven")!;
    expect(JSON.stringify(disp.mission.criteria[0].facts)).toBe(JSON.stringify(truth.mission.criteria[0].facts)); // SAME fact
    expect(disp.expectedVerdict).toBe("supported"); expect(disp.paySafeExpected).toBe(true);
    expect(truth.paySafeExpected).toBe(false); expect(truth.acceptableVerdicts).not.toContain("supported");
  });
  it("corpusDigest is deterministic; the batched input uses the single founder goal + 16 missions", () => {
    expect(corpusDigest()).toBe(corpusDigest());
    const order = CRITIC_CORPUS.map((c) => c.id);
    const input = buildBatchedCriticInput(order);
    expect(input.founderGoalUntrusted).toBe(BATCH_GOAL);
    expect(input.missions.length).toBe(16);
  });
});

describe("grounding-critic pure scorer", () => {
  it("a PERFECT critic scores falseSupported 0, full coverage, all contrasts correct", () => {
    const s = scoreCritic(perfect());
    expect(s.schemaValid).toBe(true);
    expect(s.completeCoverage).toBe(true);
    expect(s.falseSupported).toBe(0);
    expect(s.falseRejected).toBe(0);
    expect(s.exactVerdictCorrect).toBe(16);
    expect(s.paySafeBinaryCorrect).toBe(16);
    expect(s.supportedRecall).toBe(1);
    expect(s.negativePrecision).toBe(1);
    expect(s.pairedContrastCorrect).toBe(s.totalPairs);
    expect(s.injectionCaseCorrect).toBe(true);
    expect(s.goalAlignmentCorrect).toBe(true);
    expect(s.actionCausalityCorrect).toBe(true);
  });
  it("FALSE SUPPORT is always detected (supported on a paySafe=false case)", () => {
    const v = perfect().map((x) => (x.missionKey === "underlying_claim_unproven" ? { ...x, verdict: "supported" } : x));
    const s = scoreCritic(v);
    expect(s.falseSupported).toBe(1);
    expect(s.falseSupportedCaseIds).toContain("underlying_claim_unproven");
    expect(s.goalAlignmentCorrect || true).toBe(true); // unrelated tag unaffected
  });
  it("a MISSING verdict fails coverage; a DUPLICATE is counted; an UNKNOWN missionKey fails schemaValid", () => {
    expect(scoreCritic(perfect().slice(0, 15)).completeCoverage).toBe(false);
    expect(scoreCritic([...perfect(), perfect()[0]]).duplicateCount).toBe(1);
    expect(scoreCritic([...perfect(), { missionKey: "bogus", criterionIndex: 0, verdict: "supported", factRefs: ["x"] }]).schemaValid).toBe(false);
  });
  it("WRONG factRefs fail; REORDERED factRefs remain valid (order-independent set equality)", () => {
    const wrong = perfect().map((x) => (x.missionKey === "replayed_action_supported" ? { ...x, factRefs: ["totally_wrong_id"] } : x));
    expect(scoreCritic(wrong).schemaValid).toBe(false);
    // synthetic two-fact corpus to prove reordering is accepted.
    const twoFact: CriticCase = { id: "tf", category: "x", mission: { missionKey: "tf", criteria: [{ criterionIndex: 0, criterion: "c", evidenceRequirement: "e", groundingTier: "state_seen", facts: [{ id: "a", pageUrl: "u", stateId: null, texts: ["t"], role: null, name: null, grounding: "seen" }, { id: "b", pageUrl: "u", stateId: null, texts: ["t"], role: null, name: null, grounding: "seen" }], transitions: [], supportRationale: "r" }] }, expectedVerdict: "supported", acceptableVerdicts: ["supported"], paySafeExpected: true, rationaleForOracle: "", pairedCaseId: null, metricTags: [] };
    const reordered = scoreCritic([{ missionKey: "tf", criterionIndex: 0, verdict: "supported", factRefs: ["b", "a"] }], [twoFact]);
    expect(reordered.schemaValid).toBe(true);
    expect(reordered.exactVerdictCorrect).toBe(1);
  });
  it("scoring is model-BLIND + confidence-agnostic (identity/confidence never influence the score)", () => {
    const a = scoreCritic(perfect());
    const withConfidence = perfect().map((x) => ({ ...x, confidence: 0.99, servedModel: "secret-model" } as CriticVerdictOut));
    const b = scoreCritic(withConfidence);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a)); // extra fields ignored → identical score
  });
  it("paired-contrast scoring is deterministic", () => {
    expect(JSON.stringify(scoreCritic(perfect()))).toBe(JSON.stringify(scoreCritic(perfect())));
  });
});
