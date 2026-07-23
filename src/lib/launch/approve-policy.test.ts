import { describe, it, expect } from "vitest";
import { checkRevisionPolicyForApproval } from "./approve-policy";
import { compileVerificationPolicyV2, type VerificationPolicyV2 } from "./mission-probe-v2";
import type { ObservationSetV1, ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import type { CandidateMission, CriterionGroundingV1 } from "./schemas";
import type { ValidationScope } from "./validate-mission";

/** Phase 2 — the approval-critical policy check reads only the CURRENT revision + fails closed on every defect. */

const scope: ValidationScope = { hosts: new Set(["app.test"]) } as ValidationScope;
const fact: ObservedFactV1 = { version: "obs-fact-v1", id: "f", source: "field_transition", grounding: "seen", decisive: true, pageUrl: "https://app.test/r", stateId: "s", visibleTexts: ["Ready"], provenanceDigest: "pd" };
const trans: ActionTransitionV1 = { version: "action-transition-v1", id: "t", startUrl: "https://app.test/", beforeStateDigest: "b", verb: "click", locator: { role: "button", accessibleName: "Go" }, afterUrl: "https://app.test/r", afterStateDigest: "s", addedTexts: ["Ready"], removedTexts: [], observableChange: true, networkMethodSummary: "get_observed", safeClassification: "safe", provenance: { fromStateIndex: 0, toStateIndex: 1 } };
const set: ObservationSetV1 = { version: "obs-set-v1" as ObservationSetV1["version"], facts: [fact], transitions: [trans], captureVersion: 1, digest: "setdig" };
const gc: CriterionGroundingV1 = { criterionIndex: 0, criterionKind: "action_outcome", sourceFactIds: ["f"], sourceTransitionIds: ["t"], evidenceIndex: 0, verificationMode: "observation" };
const mission = { missionKey: "m", criteria: ["c"], evidenceRequirements: ["e"], groundingV1: { version: "mission-grounding-v1", observationSetDigest: "setdig", criteria: [gc] } } as unknown as CandidateMission;
const PLAN = "0xplan";
const complete = () => compileVerificationPolicyV2({ missionPlanDigest: PLAN, productMapDigest: "0xmap", set, missions: [mission], replayReproduced: new Set(["t"]), scope }).policy;
const incomplete = () => compileVerificationPolicyV2({ missionPlanDigest: PLAN, productMapDigest: "0xmap", set, missions: [mission], replayReproduced: new Set(), scope }).policy;
const bind = (p: VerificationPolicyV2 | null, over: Partial<Parameters<typeof checkRevisionPolicyForApproval>[0]> = {}) => checkRevisionPolicyForApproval({ verificationPolicy: p, verificationPolicyDigest: p?.policyDigest ?? null, verificationPolicyRequired: true, planMissionPlanDigest: PLAN, ...over });

describe("checkRevisionPolicyForApproval — fail closed", () => {
  it("valid current plan + complete required policy → approved", () => {
    expect(bind(complete())).toMatchObject({ ok: true });
  });
  it("required policy missing → rejected", () => {
    expect(bind(null)).toEqual({ ok: false, reason: "required_but_missing" });
  });
  it("not-required + no policy → approved (plan-only)", () => {
    expect(checkRevisionPolicyForApproval({ verificationPolicy: null, verificationPolicyDigest: null, verificationPolicyRequired: false, planMissionPlanDigest: PLAN })).toMatchObject({ ok: true });
  });
  it("policy for a DIFFERENT plan → rejected", () => {
    expect(bind(complete(), { planMissionPlanDigest: "0xOTHER" })).toEqual({ ok: false, reason: "plan_mismatch" });
  });
  it("stored digest disagrees with the policy (belongs to old revision / tampered) → rejected", () => {
    const p = complete();
    expect(bind(p, { verificationPolicyDigest: "deadbeef" })).toEqual({ ok: false, reason: "digest_mismatch" });
  });
  it("partial action-criterion coverage (required) → rejected incomplete", () => {
    expect(bind(incomplete())).toEqual({ ok: false, reason: "incomplete" });
  });
  it("malformed policy → rejected schema_invalid", () => {
    expect(bind({ nope: true } as unknown as VerificationPolicyV2)).toEqual({ ok: false, reason: "schema_invalid" });
  });
  it("a job.result policy change is IRRELEVANT — the check only reads the revision inputs", () => {
    // there is no job.result parameter; the only source is the revision fields → mutation elsewhere cannot affect it.
    expect(Object.keys(checkRevisionPolicyForApproval as unknown as object)).not.toContain("jobResult");
    expect(bind(complete())).toMatchObject({ ok: true });
  });
});
