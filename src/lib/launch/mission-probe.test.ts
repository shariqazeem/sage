import { describe, it, expect } from "vitest";
import { compileMissionProbe, compileVerificationPolicy, verificationPolicyDigest } from "./mission-probe";
import type { ObservationSetV1, ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import type { CandidateMission, CriterionGroundingV1 } from "./schemas";
import type { ValidationScope } from "./validate-mission";

/**
 * Phase 2 — the MissionProbeV1 / VerificationPolicyV1 compiler is PURE + DETERMINISTIC. Every field is derived
 * from the observation record; a model cannot author an index, locator, URL, or outcome. Hand-built fixtures
 * give exact control over each safety/grounding condition.
 */

const BEFORE = "state-before";
const AFTER = "state-after";
const scope: ValidationScope = { hosts: new Set(["app.test"]) } as ValidationScope;

const fact = (over: Partial<ObservedFactV1>): ObservedFactV1 => ({
  version: "obs-fact-v1", id: "f-after", source: "field_transition", grounding: "seen", decisive: true,
  pageUrl: "https://app.test/report", stateId: AFTER, visibleTexts: ["Report ready"], provenanceDigest: "pd", ...over,
});
const trans = (over: Partial<ActionTransitionV1>): ActionTransitionV1 => ({
  version: "action-transition-v1", id: "t-load", startUrl: "https://app.test/", beforeStateDigest: BEFORE, verb: "click",
  locator: { role: "button", accessibleName: "Load report" }, afterUrl: "https://app.test/report", afterStateDigest: AFTER,
  addedTexts: ["Report ready"], removedTexts: [], observableChange: true, networkMethodSummary: "get_observed",
  safeClassification: "safe", provenance: { fromStateIndex: 0, toStateIndex: 1 }, ...over,
});
const mkSet = (facts: ObservedFactV1[], transitions: ActionTransitionV1[]): ObservationSetV1 => ({
  version: "obs-set-v1" as ObservationSetV1["version"], facts, transitions, captureVersion: 1, digest: "setdig-abc",
});
const grounding = (over: Partial<CriterionGroundingV1> = {}): CriterionGroundingV1 => ({
  criterionIndex: 0, criterionKind: "action_outcome", sourceFactIds: ["f-after"], sourceTransitionIds: ["t-load"], evidenceIndex: 0, verificationMode: "observation", ...over,
});
const mission = (gc: CriterionGroundingV1[], key = "m-load"): CandidateMission => ({
  missionKey: key, criteria: ["Loading the report reaches the observed report state"], evidenceRequirements: ["Describe the report state"],
  groundingV1: { version: "mission-grounding-v1", observationSetDigest: "setdig-abc", criteria: gc },
} as unknown as CandidateMission);

const compile = (opts: { set?: ObservationSetV1; gc?: CriterionGroundingV1; reproduced?: Set<string>; scope?: ValidationScope } = {}) =>
  compileMissionProbe({
    mission: mission([opts.gc ?? grounding()]), criterionIndex: 0, grounding: opts.gc ?? grounding(),
    set: opts.set ?? mkSet([fact({})], [trans({})]), replayReproduced: opts.reproduced ?? new Set(["t-load"]), scope: opts.scope ?? scope,
  });

describe("compileMissionProbe — the happy path", () => {
  it("an exact safe, reproduced action_outcome compiles into a probe with derived fields", () => {
    const r = compile();
    expect("probe" in r).toBe(true);
    if (!("probe" in r)) return;
    const p = r.probe;
    expect(p.kind).toBe("action_replay");
    expect(p.action).toEqual({ verb: "click", role: "button", name: "Load report" }); // locator from the BEFORE state
    expect(p.expected.afterUrl).toBe("https://app.test/report");
    expect(p.expected.afterStateDigest).toBe(AFTER);
    expect(p.expected.addedTexts).toEqual(["Report ready"]);
    expect(p.safety).toEqual({ classification: "safe", networkMethods: ["GET"], inspectionReplayReproduced: true });
    expect(p.sourceFactIds).toEqual(["f-after"]);
    expect(p.sourceTransitionId).toBe("t-load");
    expect(p.probeDigest).toHaveLength(64);
    expect(p.probeId).toBe(p.probeDigest.slice(0, 24));
  });
});

describe("compileMissionProbe — the rejection matrix (bounded codes, no probe)", () => {
  const reject = (r: ReturnType<typeof compile>) => ("rejected" in r ? r.rejected : "COMPILED");
  it("non action_outcome → not_action_outcome", () => {
    expect(reject(compile({ gc: grounding({ criterionKind: "content_claim" }) }))).toBe("not_action_outcome");
  });
  it("no transition cited → no_transition_cited", () => {
    expect(reject(compile({ gc: grounding({ sourceTransitionIds: [] }) }))).toBe("no_transition_cited");
  });
  it("transition id not in set → transition_not_in_set", () => {
    expect(reject(compile({ gc: grounding({ sourceTransitionIds: ["ghost"] }) }))).toBe("transition_not_in_set");
  });
  it("unsafe / state-changing transition → unsafe_transition", () => {
    expect(reject(compile({ set: mkSet([fact({})], [trans({ safeClassification: "state_changing" })]) }))).toBe("unsafe_transition");
    expect(reject(compile({ set: mkSet([fact({})], [trans({ safeClassification: "unverified" })]) }))).toBe("unsafe_transition");
  });
  it("safe but methods not get_observed → methods_not_get_head", () => {
    expect(reject(compile({ set: mkSet([fact({})], [trans({ networkMethodSummary: "not_captured" })]) }))).toBe("methods_not_get_head");
  });
  it("transition NOT reproduced by replay → not_replay_reproduced", () => {
    expect(reject(compile({ reproduced: new Set() }))).toBe("not_replay_reproduced");
  });
  it("verb not replayable (load/scroll) → verb_not_replayable", () => {
    expect(reject(compile({ set: mkSet([fact({})], [trans({ verb: "load" })]) }))).toBe("verb_not_replayable");
  });
  it("no before-state locator → no_locator_from_before_state", () => {
    expect(reject(compile({ set: mkSet([fact({})], [trans({ locator: {} })]) }))).toBe("no_locator_from_before_state");
  });
  it("press with a non-allowlisted key → key_not_allowlisted", () => {
    expect(reject(compile({ set: mkSet([fact({})], [trans({ verb: "press", locator: { raw: "F13" } })]) }))).toBe("key_not_allowlisted");
  });
  it("cited fact does not exist (ghost model claim) → no_seen_after_state_fact", () => {
    expect(reject(compile({ gc: grounding({ sourceFactIds: ["ghost-fact"] }) }))).toBe("no_seen_after_state_fact");
  });
  it("cited fact exists but belongs to another state → outcome_fact_not_in_after_state", () => {
    expect(reject(compile({ set: mkSet([fact({ stateId: BEFORE })], [trans({})]) }))).toBe("outcome_fact_not_in_after_state");
  });
  it("after-state fact is INFERRED, not seen → inferred_after_state_only", () => {
    expect(reject(compile({ set: mkSet([fact({ grounding: "inferred", source: "vision" })], [trans({})]) }))).toBe("inferred_after_state_only");
  });
  it("no grounded outcome signal (added text not in the seen after-fact) → no_outcome_signal", () => {
    expect(reject(compile({ set: mkSet([fact({ visibleTexts: ["something else"] })], [trans({ addedTexts: ["Report ready"] })]) }))).toBe("no_outcome_signal");
  });
  it("start / after URL out of canonical scope", () => {
    expect(reject(compile({ scope: { hosts: new Set(["other.test"]) } as ValidationScope }))).toBe("start_url_out_of_scope");
    expect(reject(compile({ set: mkSet([fact({})], [trans({ afterUrl: "https://evil.test/x" })]) }))).toBe("after_url_out_of_scope");
  });
});

describe("compileMissionProbe — determinism + tamper sensitivity", () => {
  it("identical inputs ⇒ identical digest; changing the action / outcome / mission changes it", () => {
    const base = compile();
    if (!("probe" in base)) throw new Error("expected probe");
    const same = compile();
    if (!("probe" in same)) throw new Error("expected probe");
    expect(same.probe.probeDigest).toBe(base.probe.probeDigest);

    const changedAction = compile({ set: mkSet([fact({})], [trans({ locator: { role: "button", accessibleName: "Refresh" } })]) });
    if ("probe" in changedAction) expect(changedAction.probe.probeDigest).not.toBe(base.probe.probeDigest);

    const changedOutcome = compile({ set: mkSet([fact({ visibleTexts: ["Report ready", "Rows: 42"] })], [trans({ addedTexts: ["Report ready", "Rows: 42"] })]) });
    if ("probe" in changedOutcome) expect(changedOutcome.probe.probeDigest).not.toBe(base.probe.probeDigest);
  });
  it("set-like arrays are canonicalized (sourceFactIds sorted) so ordering never changes the digest", () => {
    const s1 = mkSet([fact({ id: "f-b" }), fact({ id: "f-a" })], [trans({})]);
    const s2 = mkSet([fact({ id: "f-a" }), fact({ id: "f-b" })], [trans({})]);
    const gc = grounding({ sourceFactIds: ["f-a", "f-b"] });
    const r1 = compileMissionProbe({ mission: mission([gc]), criterionIndex: 0, grounding: gc, set: s1, replayReproduced: new Set(["t-load"]), scope });
    const r2 = compileMissionProbe({ mission: mission([gc]), criterionIndex: 0, grounding: gc, set: s2, replayReproduced: new Set(["t-load"]), scope });
    if ("probe" in r1 && "probe" in r2) { expect(r1.probe.sourceFactIds).toEqual(["f-a", "f-b"]); expect(r1.probe.probeDigest).toBe(r2.probe.probeDigest); }
  });
});

describe("compileVerificationPolicy — bind probes to the plan; non-action criteria produce no probe", () => {
  const planArgs = { missionPlanDigest: "0xplan", productMapDigest: "0xmap", set: mkSet([fact({})], [trans({})]), replayReproduced: new Set(["t-load"]), scope };
  it("compiles a probe per compilable action criterion; skips content criteria; records rejections", () => {
    const m = mission([grounding(), grounding({ criterionIndex: 1, criterionKind: "content_claim" }), grounding({ criterionIndex: 2, sourceTransitionIds: ["ghost"] })]);
    const { policy, rejections } = compileVerificationPolicy({ ...planArgs, missions: [m] });
    expect(policy.probes).toHaveLength(1);
    expect(policy.probes[0].criterionIndex).toBe(0);
    expect(rejections).toEqual([{ missionKey: "m-load", criterionIndex: 2, code: "transition_not_in_set" }]); // content criterion is NOT a rejection
    expect(policy.policyDigest).toHaveLength(64);
    expect(verificationPolicyDigest(policy)).toBe(policy.policyDigest); // recompute matches
  });
  it("probes are sorted (missionKey, criterionIndex); a changed probe changes the policyDigest", () => {
    const a = compileVerificationPolicy({ ...planArgs, missions: [mission([grounding()])] });
    const b = compileVerificationPolicy({ ...planArgs, missions: [mission([grounding()])] });
    expect(a.policy.policyDigest).toBe(b.policy.policyDigest);
    const changed = compileVerificationPolicy({ ...planArgs, missionPlanDigest: "0xDIFFERENT", missions: [mission([grounding()])] });
    expect(changed.policy.policyDigest).not.toBe(a.policy.policyDigest);
  });
  it("a mission with only non-action criteria yields an empty (but valid) policy", () => {
    const { policy } = compileVerificationPolicy({ ...planArgs, missions: [mission([grounding({ criterionKind: "content_claim" })])] });
    expect(policy.probes).toHaveLength(0);
    expect(policy.version).toBe("verification-policy-v1");
  });
});
