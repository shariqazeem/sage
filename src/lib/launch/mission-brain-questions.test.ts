import { describe, expect, it } from "vitest";

import { rejectionQuestionsFor } from "./mission-brain";
import type { CandidateMission, MissionCritique, MissionValidationReport } from "./schemas";

/**
 * needs_input questions must come from WHY the plan died. Measured on production: every sampled
 * no_missions_passed_validation row asked the same map seed ("Sage did not find an obvious
 * signup/onboarding surface, where should a new user start?") regardless of cause — on a docs site
 * with 9 pages read, on a static manifesto, on a login wall. The founder cannot act on a question
 * that has nothing to do with what happened.
 */

const cand = (missionKey: string, title: string): CandidateMission => ({
  missionKey, title, objective: "o", instructions: "i", targetSurface: "https://x.example/",
  criteria: [], evidenceRequirements: [], whyItMatters: "", sources: [], priority: "medium",
  riskCategory: "critical_journey", effortMinutes: 5, conditions: [], rewardWeight: 3,
  maxCompletions: 3, verificationMethod: "", confidence: 0.8, assumptions: [], disallowed: [], anchors: [],
});
const critique = (missionKey: string, reasons: string[]): MissionCritique => ({
  missionKey, decision: "reject", reasons,
});
const report = (missionKey: string, code: string): MissionValidationReport => ({
  missionKey, ok: false, issues: [{ code, detail: "d" }],
} as unknown as MissionValidationReport);

describe("rejectionQuestionsFor", () => {
  it("a critic kill names the mission and the critic's reason", () => {
    const qs = rejectionQuestionsFor(
      [cand("m1", "Evaluate Login Method Visibility")],
      [critique("m1", ["Fails the WORTH PAYING FOR test: a low-value presence check."])],
      [],
    );
    expect(qs[0]).toContain("Evaluate Login Method Visibility");
    expect(qs[0]).toContain("presence check");
    expect(qs[0]).toMatch(/What should a tester DO/);
  });

  it("gate kills on invented pages ask for real links instead", () => {
    const qs = rejectionQuestionsFor(
      [cand("m1", "T")],
      [],
      [report("m1", "hallucinated_route")],
    );
    expect(qs.join(" ")).toContain("pages Sage never actually reached");
  });

  it("no rejection evidence, no invented question", () => {
    expect(rejectionQuestionsFor([], [], [])).toHaveLength(0);
  });
});
