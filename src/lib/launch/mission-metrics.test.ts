import { describe, it, expect } from "vitest";
import { computeGroundingMetrics } from "./mission-metrics";
import { validatePlanMissions, type ValidationScope } from "./validate-mission";
import { deriveObservations, decisiveFacts } from "./observed-facts";
import type { ObservationSetV1 } from "./observed-facts";
import type { CandidateMission, MissionValidationCode, MissionValidationReport, FieldTestState, FieldTestSummary, MissionGroundingV1 } from "./schemas";

const st = (over: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://p.test/", networkMethods: ["GET"], ...over });
function obsSet(): ObservationSetV1 {
  const ft: FieldTestSummary = {
    ran: true, startUrl: "https://p.test/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1,
    states: [
      st({ trigger: "initial load", visibleTextExcerpt: "Welcome", notableElements: [{ tag: "button", text: "Start", role: "button" }] }),
      st({ trigger: "clicked 'Start'", url: "https://p.test/play", visibleTextExcerpt: "Talk to Yara", notableElements: [{ tag: "button", text: "Talk to Yara", role: "button" }], pixelDeltaPct: 40 }),
    ],
  };
  return deriveObservations(ft);
}
const seenId = (s: ObservationSetV1, name: string) => decisiveFacts(s).find((f) => f.elementName === name)!.id;
const grounding = (c: MissionGroundingV1["criteria"]): MissionGroundingV1 => ({ version: "mission-grounding-v1", criteria: c });
const candidate = (over: Partial<CandidateMission>): CandidateMission => ({
  missionKey: "k", title: "t", objective: "o", instructions: "i", targetSurface: "https://p.test/",
  criteria: ["c"], evidenceRequirements: ["e"], whyItMatters: "w", sources: [], priority: "high",
  riskCategory: "critical_journey", effortMinutes: 3, conditions: [], rewardWeight: 5, maxCompletions: 3,
  verificationMethod: "v", confidence: 0.8, assumptions: [], disallowed: [], ...over,
});
const report = (missionKey: string, ...codes: MissionValidationCode[]): MissionValidationReport => ({ ok: codes.length === 0, missionKey, issues: codes.map((code) => ({ code, field: "x", detail: "x" })) });

describe("P-GEN grounding metrics (deterministic, offline)", () => {
  it("a perfectly grounded, in-scope, safe round → promotionClean, all integrities 1.0", () => {
    const cands = [candidate({ missionKey: "a", groundingV1: grounding([{ criterionIndex: 0, sourceFactIds: ["fx"], evidenceIndex: 0, verificationMode: "observation" }]) })];
    const reps = [report("a")];
    const m = computeGroundingMetrics(cands, reps, obsSet());
    expect(m.anchorIntegrity).toBe(1);
    expect(m.factReferenceIntegrity).toBe(1);
    expect(m.criterionEvidenceMapping).toBe(1);
    expect(m.targetScopeValidity).toBe(1);
    expect(m.unsafeOrAuthMissions).toBe(0);
    expect(m.promotionClean).toBe(true);
    expect(m.accepted).toBe(1);
  });

  it("an ungrounded fact ref drops fact-reference integrity below 1 and blocks promotion", () => {
    const cands = [candidate({ missionKey: "a", groundingV1: grounding([{ criterionIndex: 0, sourceFactIds: ["ghost"], evidenceIndex: 0, verificationMode: "observation" }]) })];
    const reps = [report("a", "ungrounded_fact_ref")];
    const m = computeGroundingMetrics(cands, reps, obsSet());
    expect(m.factReferenceIntegrity).toBeLessThan(1);
    expect(m.promotionClean).toBe(false);
  });

  it("an unsafe / authenticated mission is counted and blocks promotion", () => {
    const cands = [candidate({ missionKey: "a" }), candidate({ missionKey: "b" })];
    const reps = [report("a", "wallet_signing_request"), report("b")];
    const m = computeGroundingMetrics(cands, reps, obsSet());
    expect(m.unsafeOrAuthMissions).toBe(1);
    expect(m.promotionClean).toBe(false);
  });

  it("a target-scope violation drops target-scope validity", () => {
    const m = computeGroundingMetrics([candidate({ missionKey: "a" }), candidate({ missionKey: "b" })], [report("a", "target_out_of_scope"), report("b")], obsSet());
    expect(m.targetScopeValidity).toBe(0.5);
    expect(m.promotionClean).toBe(false);
  });

  it("critic parse failures block promotion", () => {
    const m = computeGroundingMetrics([candidate({ missionKey: "a" })], [report("a")], obsSet(), { criticParseFailures: 1 });
    expect(m.criticParseFailures).toBe(1);
    expect(m.promotionClean).toBe(false);
  });

  it("END-TO-END through the real gate: a grounded, in-scope, safe mission is accepted and scores clean", () => {
    const s = obsSet();
    const scope: ValidationScope = { knownUrls: new Set(["https://p.test/", "https://p.test/play"]), hosts: new Set(["p.test"]), repoPaths: new Set() };
    const mission = candidate({
      missionKey: "talk-to-yara", title: "Reach the world and talk to Yara", objective: "Reach the world and open the Talk-to-Yara dialog",
      instructions: "1. Click Start to enter the world. 2. Click Talk to Yara and read her reply.", targetSurface: "https://p.test/play",
      criteria: ["Reach the world after clicking Start", "Open the Talk to Yara dialog and observe her reply"],
      evidenceRequirements: ["Describe the world state you reached after clicking Start", "Describe what Yara said when you opened the dialog"],
      whyItMatters: "This is the core journey observed in the field test.", verificationMethod: "the tester's written account judged against Sage's observation corpus",
      sources: [{ kind: "page", ref: "https://p.test/play", observation: "reached the world and saw Talk to Yara" }],
      groundingV1: grounding([
        { criterionIndex: 0, sourceFactIds: [seenId(s, "Start")], evidenceIndex: 0, verificationMode: "observation" },
        { criterionIndex: 1, sourceFactIds: [seenId(s, "Talk to Yara")], evidenceIndex: 1, verificationMode: "observation" },
      ]),
    });
    const reports = validatePlanMissions([mission], scope, undefined, s); // corpus undefined → anchor gate skipped; grounding gate active
    const m = computeGroundingMetrics([mission], reports, s);
    expect(reports[0].ok, JSON.stringify(reports[0].issues)).toBe(true);
    expect(m.promotionClean).toBe(true);
    expect(m.coverage.coveredStates).toBeGreaterThan(0);
    expect(m.coverage.evidenceModeDistribution.observation).toBe(2);
  });

  it("END-TO-END: a mission citing a NON-existent fact is REJECTED by the real gate", () => {
    const s = obsSet();
    const scope: ValidationScope = { knownUrls: new Set(["https://p.test/"]), hosts: new Set(["p.test"]), repoPaths: new Set() };
    const mission = candidate({
      missionKey: "ghost", criteria: ["do a thing"], evidenceRequirements: ["describe it"],
      groundingV1: grounding([{ criterionIndex: 0, sourceFactIds: ["deadbeefdeadbeefdeadbeef"], evidenceIndex: 0, verificationMode: "observation" }]),
    });
    const reports = validatePlanMissions([mission], scope, undefined, s);
    expect(reports[0].ok).toBe(false);
    expect(reports[0].issues.some((i) => i.code === "ungrounded_fact_ref")).toBe(true);
  });
});
