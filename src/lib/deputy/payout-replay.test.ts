import { describe, it, expect, afterEach } from "vitest";
import { runPayoutActionReplay, classifyReplay, payoutActionReplayMode, type PayoutReplayDeps } from "./payout-replay";
import { compileVerificationPolicy } from "@/lib/launch/mission-probe";
import type { ObservationSetV1, ObservedFactV1, ActionTransitionV1 } from "@/lib/launch/observed-facts";
import type { CandidateMission } from "@/lib/launch/schemas";
import type { ValidationScope } from "@/lib/launch/validate-mission";
import type { Campaign } from "@/lib/db/schema";
import type { ProbeClassification } from "@/lib/launch/inspection-replay";

/**
 * Phase 4 — payout action replay is SUBTRACTIVE. Money semantics truth table (deterministic; fake browser).
 * `reproduced` only ALLOWS a qualified decision to continue; every other result vetoes (canary) or is journaled
 * (shadow); it can never manufacture a payout.
 */

const MODE = "PAYOUT_ACTION_REPLAY_MODE";
afterEach(() => { delete process.env[MODE]; });

const AFTER = "state-after";
const scope: ValidationScope = { hosts: new Set(["app.test"]) } as ValidationScope;
const fact: ObservedFactV1 = { version: "obs-fact-v1", id: "f-after", source: "field_transition", grounding: "seen", decisive: true, pageUrl: "https://app.test/report", stateId: AFTER, visibleTexts: ["Report ready"], provenanceDigest: "pd" };
const trans: ActionTransitionV1 = { version: "action-transition-v1", id: "t-load", startUrl: "https://app.test/", beforeStateDigest: "b", verb: "click", locator: { role: "button", accessibleName: "Load report" }, afterUrl: "https://app.test/report", afterStateDigest: AFTER, addedTexts: ["Report ready"], removedTexts: [], observableChange: true, networkMethodSummary: "get_observed", safeClassification: "safe", provenance: { fromStateIndex: 0, toStateIndex: 1 } };
const set: ObservationSetV1 = { version: "obs-set-v1" as ObservationSetV1["version"], facts: [fact], transitions: [trans], captureVersion: 1, digest: "setdig" };
const actionMission: CandidateMission = { missionKey: "m-load", criteria: ["c"], evidenceRequirements: ["e"], groundingV1: { version: "mission-grounding-v1", observationSetDigest: "setdig", criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", sourceFactIds: ["f-after"], sourceTransitionIds: ["t-load"], evidenceIndex: 0, verificationMode: "observation" }] } } as unknown as CandidateMission;

function campaignWithPolicy(missions: CandidateMission[] = [actionMission], replayed = new Set(["t-load"])): Campaign {
  const policy = compileVerificationPolicy({ missionPlanDigest: "0xplan", productMapDigest: "0xmap", set, missions, replayReproduced: replayed, scope }).policy;
  return { verificationPolicy: policy, verificationPolicyDigest: policy.policyDigest, missionPlanDigest: "0xplan" } as Campaign;
}
const fakeRunProbe = (classification: ProbeClassification, reason = ""): PayoutReplayDeps => ({ runProbe: async (p) => ({ classification, reason, probeId: p.id }) });

describe("payoutActionReplayMode — off default; unknown/enforce → off", () => {
  it("maps env correctly", () => {
    for (const [v, exp] of [[undefined, "off"], ["off", "off"], ["shadow", "shadow"], ["canary", "canary"], ["enforce", "off"], ["banana", "off"]] as const) {
      if (v === undefined) delete process.env[MODE]; else process.env[MODE] = v;
      expect(payoutActionReplayMode()).toBe(exp);
    }
  });
});

describe("classifyReplay — guarded-browser classification → bounded payout code", () => {
  it("maps each classification (+ reason) to a bounded code", () => {
    expect(classifyReplay("reproduced", "")).toBe("reproduced");
    expect(classifyReplay("product_drift", "target element not found")).toBe("locator_missing");
    expect(classifyReplay("product_drift", "a change occurred but not the expected one")).toBe("wrong_after_state");
    expect(classifyReplay("locator_ambiguous", "")).toBe("locator_ambiguous");
    expect(classifyReplay("no_observable_change", "")).toBe("no_observable_change");
    expect(classifyReplay("unsafe_rejected", "")).toBe("unsafe_transition");
    expect(classifyReplay("probe_flake", "")).toBe("timeout");
    expect(classifyReplay("infrastructure_failure", "entry navigation failed")).toBe("egress_refused");
    expect(classifyReplay("infrastructure_failure", "browser engine unavailable")).toBe("internal_error");
  });
});

describe("runPayoutActionReplay — money semantics truth table", () => {
  it("off → skip (byte-identical existing behavior)", async () => {
    const r = await runPayoutActionReplay(campaignWithPolicy(), "m-load", fakeRunProbe("reproduced"));
    expect(r).toMatchObject({ decision: "skip", code: null });
  });
  it("canary + non-canary campaign (no bound policy) → skip", async () => {
    process.env[MODE] = "canary";
    const r = await runPayoutActionReplay({ verificationPolicy: null, verificationPolicyDigest: null, missionPlanDigest: "0xplan" } as Campaign, "m-load", fakeRunProbe("reproduced"));
    expect(r.decision).toBe("skip");
  });
  it("canary + not an action mission → skip", async () => {
    process.env[MODE] = "canary";
    const r = await runPayoutActionReplay(campaignWithPolicy(), "some-other-mission", fakeRunProbe("reproduced"));
    expect(r.decision).toBe("skip");
  });
  it("canary + reproduced → ALLOW (continue; never creates a payout)", async () => {
    process.env[MODE] = "canary";
    const r = await runPayoutActionReplay(campaignWithPolicy(), "m-load", fakeRunProbe("reproduced"));
    expect(r).toMatchObject({ decision: "allow", code: "reproduced", isActionMission: true });
  });
  it("canary + product drift → HOLD (veto)", async () => {
    process.env[MODE] = "canary";
    const r = await runPayoutActionReplay(campaignWithPolicy(), "m-load", fakeRunProbe("product_drift", "a change occurred but not the expected one"));
    expect(r).toMatchObject({ decision: "hold", code: "wrong_after_state" });
  });
  it("canary + no valid probe for an action mission → HOLD (probe_not_applicable)", async () => {
    process.env[MODE] = "canary";
    // an action mission whose transition was NOT reproduced → no probe compiles, but it IS an action mission.
    const c = campaignWithPolicy([actionMission], new Set()); // nothing reproduced → 0 probes, actionMissions=[m-load]
    const r = await runPayoutActionReplay(c, "m-load", fakeRunProbe("reproduced"));
    expect(r).toMatchObject({ decision: "hold", code: "probe_not_applicable", isActionMission: true });
  });
  it("canary + tampered policy → HOLD (policy_digest_mismatch)", async () => {
    process.env[MODE] = "canary";
    const c = campaignWithPolicy();
    (c.verificationPolicy as { probes: { expected: { addedTexts: string[] } }[] }).probes[0].expected.addedTexts = ["anything"];
    const r = await runPayoutActionReplay(c, "m-load", fakeRunProbe("reproduced"));
    expect(r).toMatchObject({ decision: "hold", code: "policy_digest_mismatch" });
  });
  it("canary + policy present but missing stored digest → HOLD (policy_missing)", async () => {
    process.env[MODE] = "canary";
    const c = campaignWithPolicy();
    c.verificationPolicyDigest = null;
    const r = await runPayoutActionReplay(c, "m-load", fakeRunProbe("reproduced"));
    expect(r).toMatchObject({ decision: "hold", code: "policy_missing" });
  });
  it("shadow + failure → ALLOW (journal only, settlement unchanged)", async () => {
    process.env[MODE] = "shadow";
    const r = await runPayoutActionReplay(campaignWithPolicy(), "m-load", fakeRunProbe("no_observable_change"));
    expect(r).toMatchObject({ decision: "allow", code: "no_observable_change" });
  });
  it("shadow + reproduced → ALLOW", async () => {
    process.env[MODE] = "shadow";
    const r = await runPayoutActionReplay(campaignWithPolicy(), "m-load", fakeRunProbe("reproduced"));
    expect(r).toMatchObject({ decision: "allow", code: "reproduced" });
  });
  it("a thrown browser error is a bounded internal_error veto (canary)", async () => {
    process.env[MODE] = "canary";
    const r = await runPayoutActionReplay(campaignWithPolicy(), "m-load", { runProbe: async () => { throw new Error("boom"); } });
    expect(r).toMatchObject({ decision: "hold", code: "internal_error" });
  });
});
