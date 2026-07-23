import { describe, it, expect } from "vitest";
import { validateMissionGrounding, coverageReport, stripGrounding } from "./mission-grounding";
import { deriveObservations, decisiveFacts } from "./observed-facts";
import type { ObservationSetV1 } from "./observed-facts";
import type { CandidateMission, FieldTestState, FieldTestSummary, MissionGroundingV1 } from "./schemas";

const st = (over: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://p.test/", networkMethods: ["GET"], ...over });
function set(): ObservationSetV1 {
  const ft: FieldTestSummary = {
    ran: true, startUrl: "https://p.test/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1,
    states: [
      st({ trigger: "initial load", visibleTextExcerpt: "Welcome", notableElements: [{ tag: "button", text: "Start", role: "button" }] }),
      st({ trigger: "clicked 'Start'", url: "https://p.test/play", visibleTextExcerpt: "Talk to Yara", notableElements: [{ tag: "button", text: "Talk to Yara", role: "button" }], pixelDeltaPct: 40 }),
    ],
    visionObservations: [{ stateIndex: 1, trigger: "clicked 'Start'", sceneDescription: "A world", visibleText: ["Talk to Yara"], uiElements: [], productTypeSignals: ["game"], audienceSignals: [], qualityIssues: [] }],
  };
  return deriveObservations(ft);
}
const seenId = (s: ObservationSetV1, name: string) => decisiveFacts(s).find((f) => f.elementName === name)!.id;
const visionId = (s: ObservationSetV1) => s.facts.find((f) => f.source === "vision")!.id;

function mission(over: Partial<CandidateMission> = {}): CandidateMission {
  return {
    missionKey: "talk-to-yara", title: "Talk to Yara", objective: "Reach the world and talk to Yara",
    instructions: "Click Start, then click Talk to Yara.", targetSurface: "https://p.test/",
    criteria: ["Reach the world by clicking Start", "Open the Talk-to-Yara dialog"],
    evidenceRequirements: ["Describe the world state you reached", "Describe what Yara said"],
    whyItMatters: "core journey", sources: [], priority: "high", riskCategory: "critical_journey",
    effortMinutes: 3, conditions: [], rewardWeight: 5, maxCompletions: 3, verificationMethod: "observation",
    confidence: 0.8, assumptions: [], disallowed: [], ...over,
  };
}
const grounding = (criteria: MissionGroundingV1["criteria"]): MissionGroundingV1 => ({ version: "mission-grounding-v1", criteria });

describe("Mission Brain V2 — deterministic grounding gate", () => {
  it("no groundingV1 → no-op (backward-compatible)", () => {
    expect(validateMissionGrounding(mission(), set())).toEqual([]);
  });
  it("no observation set → no-op", () => {
    expect(validateMissionGrounding(mission({ groundingV1: grounding([]) }), null)).toEqual([]);
  });

  it("a fully grounded mission passes", () => {
    const s = set();
    const m = mission({ groundingV1: grounding([
      { criterionIndex: 0, sourceFactIds: [seenId(s, "Start")], evidenceIndex: 0, verificationMode: "observation" },
      { criterionIndex: 1, sourceFactIds: [seenId(s, "Talk to Yara")], evidenceIndex: 1, verificationMode: "observation" },
    ]) });
    expect(validateMissionGrounding(m, s)).toEqual([]);
  });

  it("ungrounded_fact_ref — a cited fact id that does not exist", () => {
    const s = set();
    const m = mission({ groundingV1: grounding([
      { criterionIndex: 0, sourceFactIds: ["deadbeefdeadbeefdeadbeef"], evidenceIndex: 0, verificationMode: "observation" },
      { criterionIndex: 1, sourceFactIds: [seenId(s, "Talk to Yara")], evidenceIndex: 1, verificationMode: "observation" },
    ]) });
    const codes = validateMissionGrounding(m, s).map((i) => i.code);
    expect(codes).toContain("ungrounded_fact_ref");
  });

  it("inferred_decisive_source — a criterion grounded ONLY in vision (inferred)", () => {
    const s = set();
    const m = mission({ groundingV1: grounding([
      { criterionIndex: 0, sourceFactIds: [visionId(s)], evidenceIndex: 0, verificationMode: "observation" },
      { criterionIndex: 1, sourceFactIds: [seenId(s, "Talk to Yara")], evidenceIndex: 1, verificationMode: "observation" },
    ]) });
    const codes = validateMissionGrounding(m, s).map((i) => i.code);
    expect(codes).toContain("inferred_decisive_source");
  });

  it("criterion_evidence_unmapped — a criterion with no grounding entry, or a bad evidence index", () => {
    const s = set();
    const missingEntry = mission({ groundingV1: grounding([{ criterionIndex: 0, sourceFactIds: [seenId(s, "Start")], evidenceIndex: 0, verificationMode: "observation" }]) });
    expect(validateMissionGrounding(missingEntry, s).map((i) => i.code)).toContain("criterion_evidence_unmapped"); // criterion 1 unmapped
    const badEvidence = mission({ groundingV1: grounding([
      { criterionIndex: 0, sourceFactIds: [seenId(s, "Start")], evidenceIndex: 9, verificationMode: "observation" },
      { criterionIndex: 1, sourceFactIds: [seenId(s, "Talk to Yara")], evidenceIndex: 1, verificationMode: "observation" },
    ]) });
    expect(validateMissionGrounding(badEvidence, s).map((i) => i.code)).toContain("criterion_evidence_unmapped");
  });

  it("evidence_mode_incapable — a URL mode with no page(dom) source, and observation mode with no state source", () => {
    const s = set();
    // state-only fact (field_transition), but the criterion claims deterministic_url → incapable.
    const stateFact = s.facts.find((f) => f.source === "field_transition")!.id;
    const urlMode = mission({ groundingV1: grounding([
      { criterionIndex: 0, sourceFactIds: [stateFact], evidenceIndex: 0, verificationMode: "deterministic_url" },
      { criterionIndex: 1, sourceFactIds: [seenId(s, "Talk to Yara")], evidenceIndex: 1, verificationMode: "observation" },
    ]) });
    expect(validateMissionGrounding(urlMode, s).map((i) => i.code)).toContain("evidence_mode_incapable");
  });
});

describe("Mission Brain V2 — coverage report", () => {
  it("reports inspected vs covered states, diversity, evidence modes, and duplicate coverage", () => {
    const s = set();
    const m1 = mission({ missionKey: "m1", objective: "reach world", riskCategory: "critical_journey", groundingV1: grounding([
      { criterionIndex: 0, sourceFactIds: [seenId(s, "Start")], evidenceIndex: 0, verificationMode: "observation" },
      { criterionIndex: 1, sourceFactIds: [seenId(s, "Talk to Yara")], evidenceIndex: 1, verificationMode: "observation" },
    ]) });
    const m2 = mission({ missionKey: "m2", objective: "onboarding check", riskCategory: "onboarding", verificationMethod: "url", groundingV1: grounding([
      { criterionIndex: 0, sourceFactIds: [seenId(s, "Start")], evidenceIndex: 0, verificationMode: "semantic_url" },
      { criterionIndex: 1, sourceFactIds: [seenId(s, "Start")], evidenceIndex: 1, verificationMode: "semantic_url" },
    ]) });
    const report = coverageReport(s, [m1, m2]);
    expect(report.inspectedStates).toBeGreaterThan(0);
    expect(report.coveredStates).toBeGreaterThan(0);
    expect(report.diversityByRisk).toMatchObject({ critical_journey: 1, onboarding: 1 });
    expect(report.evidenceModeDistribution.observation).toBe(2);
    expect(report.evidenceModeDistribution.semantic_url).toBe(2);
    expect(report.acceptedMissions).toBe(2);
  });

  it("detects duplicate coverage (same objective + same covered states)", () => {
    const s = set();
    const g = grounding([{ criterionIndex: 0, sourceFactIds: [seenId(s, "Start")], evidenceIndex: 0, verificationMode: "observation" }]);
    const a = mission({ missionKey: "a", objective: "same thing", criteria: ["c"], evidenceRequirements: ["e"], groundingV1: g });
    const b = mission({ missionKey: "b", objective: "same thing", criteria: ["c"], evidenceRequirements: ["e"], groundingV1: g });
    expect(coverageReport(s, [a, b]).duplicateCoverage).toBe(1);
  });
});

describe("stripGrounding — design-time metadata never reaches canonical compilation", () => {
  it("removes groundingV1", () => {
    const m = mission({ groundingV1: grounding([]) });
    expect("groundingV1" in stripGrounding(m)).toBe(false);
    expect(stripGrounding(m).missionKey).toBe("talk-to-yara");
  });
});
