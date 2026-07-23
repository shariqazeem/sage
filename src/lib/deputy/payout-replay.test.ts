import { describe, it, expect, afterEach } from "vitest";
import { runPayoutActionReplay, classifyReplay, payoutActionReplayMode, type PayoutReplayDeps } from "./payout-replay";
import { makeV2Policy, v2Campaign, V2_MISSION } from "./policy-test-fixtures";
import type { Campaign } from "@/lib/db/schema";
import type { ProbeClassification } from "@/lib/launch/inspection-replay";

/**
 * Phase 4 — payout action replay is SUBTRACTIVE + FAIL-CLOSED for a policy-REQUIRED campaign (V2 policy).
 * `reproduced` only ALLOWS a qualified decision; every other result vetoes (canary) or is journaled (shadow).
 */

const MODE = "PAYOUT_ACTION_REPLAY_MODE";
afterEach(() => { delete process.env[MODE]; });
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

describe("runPayoutActionReplay — V2 fail-closed truth table", () => {
  it("off → skip (byte-identical existing behavior)", async () => {
    expect(await runPayoutActionReplay(v2Campaign(), "m-load", fakeRunProbe("reproduced"))).toMatchObject({ decision: "skip", code: null });
  });
  it("policyRequired=false → skip (historical)", async () => {
    process.env[MODE] = "canary";
    const r = await runPayoutActionReplay(v2Campaign({ verificationPolicyRequired: false }), "m-load", fakeRunProbe("reproduced"));
    expect(r.decision).toBe("skip");
  });
  it("required + policy MISSING → HOLD policy_missing (never skip)", async () => {
    process.env[MODE] = "canary";
    const r = await runPayoutActionReplay(v2Campaign({ verificationPolicy: null }), "m-load", fakeRunProbe("reproduced"));
    expect(r).toMatchObject({ decision: "hold", code: "policy_missing" });
  });
  it("required + tampered policy → HOLD policy_digest_mismatch", async () => {
    process.env[MODE] = "canary";
    const c = v2Campaign();
    (c.verificationPolicy as { probes: { expected: { addedTexts: string[] } }[] }).probes[0].expected.addedTexts = ["anything"];
    const r = await runPayoutActionReplay(c, "m-load", fakeRunProbe("reproduced"));
    expect(r).toMatchObject({ decision: "hold", code: "policy_digest_mismatch" });
  });
  it("required + mission NOT in actionCriteria (proven non-action by complete policy) → skip", async () => {
    process.env[MODE] = "canary";
    const r = await runPayoutActionReplay(v2Campaign(), "some-other-mission", fakeRunProbe("reproduced"));
    expect(r.decision).toBe("skip");
  });
  it("required + reproduced → ALLOW (continue; never creates a payout)", async () => {
    process.env[MODE] = "canary";
    expect(await runPayoutActionReplay(v2Campaign(), "m-load", fakeRunProbe("reproduced"))).toMatchObject({ decision: "allow", code: "reproduced", isActionMission: true });
  });
  it("required + product drift → HOLD (veto)", async () => {
    process.env[MODE] = "canary";
    expect(await runPayoutActionReplay(v2Campaign(), "m-load", fakeRunProbe("product_drift", "a change occurred but not the expected one"))).toMatchObject({ decision: "hold", code: "wrong_after_state" });
  });
  it("shadow + failure → ALLOW (journal only, settlement unchanged)", async () => {
    process.env[MODE] = "shadow";
    expect(await runPayoutActionReplay(v2Campaign(), "m-load", fakeRunProbe("no_observable_change"))).toMatchObject({ decision: "allow", code: "no_observable_change" });
  });
  it("a thrown browser error is a bounded internal_error veto (canary)", async () => {
    process.env[MODE] = "canary";
    const r = await runPayoutActionReplay(v2Campaign(), "m-load", { runProbe: async () => { throw new Error("boom"); } });
    expect(r).toMatchObject({ decision: "hold", code: "internal_error" });
  });
  it("an incomplete required policy fails the loader → HOLD (never a partial-coverage allow)", async () => {
    process.env[MODE] = "canary";
    const incomplete = makeV2Policy([V2_MISSION], new Set());
    const c = v2Campaign({ verificationPolicy: incomplete, verificationPolicyDigest: incomplete.policyDigest }) as Campaign;
    const r = await runPayoutActionReplay(c, "m-load", fakeRunProbe("reproduced"));
    expect(r.decision).toBe("hold");
  });
});
