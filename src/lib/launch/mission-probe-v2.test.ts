import { describe, it, expect } from "vitest";
import { compileVerificationPolicyV2, validateVerificationPolicyV2Complete, verificationPolicyV2Digest, VerificationPolicyV2Schema, parseCompleteVerificationPolicyV2, type VerificationPolicyV2 } from "./mission-probe-v2";
import type { ObservationSetV1, ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import type { CandidateMission, CriterionGroundingV1 } from "./schemas";
import type { ValidationScope } from "./validate-mission";

/** Phase 1 — VerificationPolicyV2 completeness matrix (deterministic). */

const scope: ValidationScope = { hosts: new Set(["app.test"]) } as ValidationScope;
// two after-states → two action criteria on one mission (or two missions).
const fact = (id: string, state: string, text: string): ObservedFactV1 => ({ version: "obs-fact-v1", id, source: "field_transition", grounding: "seen", decisive: true, pageUrl: `https://app.test/${state}`, stateId: state, visibleTexts: [text], provenanceDigest: "pd" });
const trans = (id: string, after: string, text: string): ActionTransitionV1 => ({ version: "action-transition-v1", id, startUrl: "https://app.test/", beforeStateDigest: "b", verb: "click", locator: { role: "button", accessibleName: text }, afterUrl: `https://app.test/${after}`, afterStateDigest: after, addedTexts: [text], removedTexts: [], observableChange: true, networkMethodSummary: "get_observed", safeClassification: "safe", provenance: { fromStateIndex: 0, toStateIndex: 1 } });
const gc = (i: number, factId: string, transId: string, kind = "action_outcome"): CriterionGroundingV1 => ({ criterionIndex: i, criterionKind: kind as CriterionGroundingV1["criterionKind"], sourceFactIds: [factId], sourceTransitionIds: [transId], evidenceIndex: i, verificationMode: "observation" });
const mission = (key: string, criteria: CriterionGroundingV1[], n: number): CandidateMission => ({ missionKey: key, criteria: Array(n).fill("c"), evidenceRequirements: Array(n).fill("e"), groundingV1: { version: "mission-grounding-v1", observationSetDigest: "setdig", criteria } } as unknown as CandidateMission);

const set2: ObservationSetV1 = { version: "obs-set-v1" as ObservationSetV1["version"], facts: [fact("f1", "s1", "One"), fact("f2", "s2", "Two")], transitions: [trans("t1", "s1", "One"), trans("t2", "s2", "Two")], captureVersion: 1, digest: "setdig" };
const twoCrit = mission("m", [gc(0, "f1", "t1"), gc(1, "f2", "t2")], 2);
const compile = (missions: CandidateMission[], set = set2, replayed = new Set(["t1", "t2"])) => compileVerificationPolicyV2({ missionPlanDigest: "0xplan", productMapDigest: "0xmap", set, missions, replayReproduced: replayed, scope });

describe("compileVerificationPolicyV2 — completeness", () => {
  it("two action criteria, two probes → complete", () => {
    const r = compile([twoCrit]);
    expect(r.complete).toBe(true);
    expect(r.policy.actionCriteria).toHaveLength(2);
    expect(r.policy.probes).toHaveLength(2);
    expect(validateVerificationPolicyV2Complete(r.policy)).toEqual({ complete: true });
  });
  it("two action criteria, one reproducible → INCOMPLETE (missing probe)", () => {
    const r = compile([twoCrit], set2, new Set(["t1"])); // t2 not reproduced → its probe rejected
    expect(r.complete).toBe(false);
    expect(r.policy.actionCriteria).toHaveLength(2);
    expect(r.policy.actionCriteria.some((a) => a.probeDigest === "")).toBe(true);
    expect(validateVerificationPolicyV2Complete(r.policy)).toEqual({ complete: false, reason: "missing_probe" });
  });
  it("a complete policy reorders to the SAME digest", () => {
    const a = compile([twoCrit]).policy;
    const b: VerificationPolicyV2 = { ...a, actionCriteria: [...a.actionCriteria].reverse(), probes: [...a.probes].reverse() };
    expect(verificationPolicyV2Digest(b)).toBe(a.policyDigest);
  });
});

describe("validateVerificationPolicyV2Complete — self-consistency", () => {
  const good = () => compile([twoCrit]).policy;
  const reseal = (p: VerificationPolicyV2): VerificationPolicyV2 => ({ ...p, policyDigest: verificationPolicyV2Digest(p) });
  it("duplicated criterion → invalid", () => {
    const p = good();
    const dup = reseal({ ...p, actionCriteria: [p.actionCriteria[0], p.actionCriteria[0]] });
    expect(validateVerificationPolicyV2Complete(dup).complete).toBe(false);
    expect(validateVerificationPolicyV2Complete(dup)).toMatchObject({ reason: "duplicate_criterion" });
  });
  it("extra probe (no matching criterion) → invalid", () => {
    const p = good();
    const extra = reseal({ ...p, probes: [...p.probes, { ...p.probes[0], missionKey: "ghost", probeId: "x", probeDigest: "x" }] });
    expect(validateVerificationPolicyV2Complete(extra)).toMatchObject({ complete: false, reason: "extra_probe" });
  });
  it("wrong criterion binding (probeDigest points nowhere) → invalid", () => {
    const p = good();
    const wrong = reseal({ ...p, actionCriteria: [{ ...p.actionCriteria[0], probeDigest: "deadbeef" }, p.actionCriteria[1]] });
    expect(validateVerificationPolicyV2Complete(wrong)).toMatchObject({ complete: false, reason: "probe_criterion_mismatch" });
  });
  it("forged policyDigest → invalid", () => {
    expect(validateVerificationPolicyV2Complete({ ...good(), policyDigest: "nope" })).toMatchObject({ complete: false, reason: "digest_mismatch" });
  });
});

describe("VerificationPolicyV2Schema — strict nested", () => {
  it("accepts a compiled policy; rejects unknown top-level + nested fields", () => {
    const p = compile([twoCrit]).policy;
    expect(VerificationPolicyV2Schema.safeParse(p).success).toBe(true);
    expect(VerificationPolicyV2Schema.safeParse({ ...p, extra: 1 }).success).toBe(false);
    const badProbe = { ...p, probes: [{ ...p.probes[0], injected: true }] };
    expect(VerificationPolicyV2Schema.safeParse(badProbe).success).toBe(false); // nested malformed probe
  });
  it("parseCompleteVerificationPolicyV2 requires strict schema AND completeness", () => {
    const complete = compile([twoCrit]).policy;
    expect(parseCompleteVerificationPolicyV2(complete)).toMatchObject({ ok: true });
    const incomplete = compile([twoCrit], set2, new Set(["t1"])).policy;
    expect(parseCompleteVerificationPolicyV2(incomplete)).toMatchObject({ ok: false, reason: "incomplete:missing_probe" });
    expect(parseCompleteVerificationPolicyV2({ nope: 1 })).toMatchObject({ ok: false, reason: "schema_invalid" });
  });
});
