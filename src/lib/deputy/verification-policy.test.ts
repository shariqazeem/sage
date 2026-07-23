import { describe, it, expect } from "vitest";
import { loadVerifiedCampaignPolicy, probesForMission } from "./verification-policy";
import { compileVerificationPolicy } from "@/lib/launch/mission-probe";
import type { ObservationSetV1, ObservedFactV1, ActionTransitionV1 } from "@/lib/launch/observed-facts";
import type { CandidateMission } from "@/lib/launch/schemas";
import type { ValidationScope } from "@/lib/launch/validate-mission";
import type { Campaign } from "@/lib/db/schema";

/** Phase 3 — the campaign policy loader FAILS CLOSED on missing / malformed / tampered / plan-mismatched policy. */

const AFTER = "state-after";
const scope: ValidationScope = { hosts: new Set(["app.test"]) } as ValidationScope;
const fact: ObservedFactV1 = { version: "obs-fact-v1", id: "f-after", source: "field_transition", grounding: "seen", decisive: true, pageUrl: "https://app.test/report", stateId: AFTER, visibleTexts: ["Report ready"], provenanceDigest: "pd" };
const trans: ActionTransitionV1 = { version: "action-transition-v1", id: "t-load", startUrl: "https://app.test/", beforeStateDigest: "b", verb: "click", locator: { role: "button", accessibleName: "Load report" }, afterUrl: "https://app.test/report", afterStateDigest: AFTER, addedTexts: ["Report ready"], removedTexts: [], observableChange: true, networkMethodSummary: "get_observed", safeClassification: "safe", provenance: { fromStateIndex: 0, toStateIndex: 1 } };
const set: ObservationSetV1 = { version: "obs-set-v1" as ObservationSetV1["version"], facts: [fact], transitions: [trans], captureVersion: 1, digest: "setdig" };
const mission: CandidateMission = { missionKey: "m-load", criteria: ["c"], evidenceRequirements: ["e"], groundingV1: { version: "mission-grounding-v1", observationSetDigest: "setdig", criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", sourceFactIds: ["f-after"], sourceTransitionIds: ["t-load"], evidenceIndex: 0, verificationMode: "observation" }] } } as unknown as CandidateMission;

const built = compileVerificationPolicy({ missionPlanDigest: "0xplan", productMapDigest: "0xmap", set, missions: [mission], replayReproduced: new Set(["t-load"]), scope }).policy;
const campaign = (over: Partial<Campaign> = {}): Campaign => ({ verificationPolicy: built, verificationPolicyDigest: built.policyDigest, missionPlanDigest: "0xplan", ...over } as Campaign);

describe("loadVerifiedCampaignPolicy — fail closed", () => {
  it("a correctly-bound policy loads", () => {
    const r = loadVerifiedCampaignPolicy(campaign());
    expect(r.ok).toBe(true);
    if (r.ok) expect(probesForMission(r.policy, "m-load")).toHaveLength(1);
  });
  it("missing policy or digest → policy_missing", () => {
    expect(loadVerifiedCampaignPolicy(campaign({ verificationPolicy: null }))).toEqual({ ok: false, reason: "policy_missing" });
    expect(loadVerifiedCampaignPolicy(campaign({ verificationPolicyDigest: null }))).toEqual({ ok: false, reason: "policy_missing" });
  });
  it("malformed policy → policy_malformed", () => {
    expect(loadVerifiedCampaignPolicy(campaign({ verificationPolicy: { nope: true } }))).toEqual({ ok: false, reason: "policy_malformed" });
  });
  it("tampered probe (stored digest unchanged) → policy_digest_mismatch", () => {
    const tampered = { ...built, probes: built.probes.map((p) => ({ ...p, expected: { ...p.expected, addedTexts: ["Anything I want"] } })) };
    expect(loadVerifiedCampaignPolicy(campaign({ verificationPolicy: tampered }))).toEqual({ ok: false, reason: "policy_digest_mismatch" });
  });
  it("policyDigest field forged but body unchanged → policy_digest_mismatch", () => {
    expect(loadVerifiedCampaignPolicy(campaign({ verificationPolicy: { ...built, policyDigest: "deadbeef" }, verificationPolicyDigest: "deadbeef" }))).toEqual({ ok: false, reason: "policy_digest_mismatch" });
  });
  it("policy bound to a different mission plan → policy_plan_mismatch", () => {
    expect(loadVerifiedCampaignPolicy(campaign({ missionPlanDigest: "0xDIFFERENT" }))).toEqual({ ok: false, reason: "policy_plan_mismatch" });
  });
});
