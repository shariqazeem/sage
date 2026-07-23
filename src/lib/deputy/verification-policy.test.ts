import { describe, it, expect } from "vitest";
import { loadVerifiedCampaignPolicy, probesForMission, policyMarksActionMission } from "./verification-policy";
import { makeV2Policy, v2Campaign, V2_MISSION } from "./policy-test-fixtures";
import type { Campaign } from "@/lib/db/schema";

/** Phase 3/4 — the campaign V2 policy loader FAILS CLOSED on missing / malformed / incomplete / tampered / plan-mismatched. */

describe("loadVerifiedCampaignPolicy (V2) — fail closed", () => {
  it("a correctly-bound complete policy loads", () => {
    const r = loadVerifiedCampaignPolicy(v2Campaign());
    expect(r.ok).toBe(true);
    if (r.ok) { expect(probesForMission(r.policy, "m-load")).toHaveLength(1); expect(policyMarksActionMission(r.policy, "m-load")).toBe(true); }
  });
  it("missing policy or digest → policy_missing", () => {
    expect(loadVerifiedCampaignPolicy(v2Campaign({ verificationPolicy: null }))).toEqual({ ok: false, reason: "policy_missing" });
    expect(loadVerifiedCampaignPolicy(v2Campaign({ verificationPolicyDigest: null }))).toEqual({ ok: false, reason: "policy_missing" });
  });
  it("empty campaign missionPlanDigest → policy_plan_mismatch", () => {
    expect(loadVerifiedCampaignPolicy(v2Campaign({ missionPlanDigest: null }))).toEqual({ ok: false, reason: "policy_plan_mismatch" });
  });
  it("malformed policy → policy_malformed", () => {
    expect(loadVerifiedCampaignPolicy(v2Campaign({ verificationPolicy: { nope: true } }))).toEqual({ ok: false, reason: "policy_malformed" });
  });
  it("incomplete policy (an action criterion with no probe) → policy_incomplete", () => {
    const incomplete = makeV2Policy([V2_MISSION], new Set()); // nothing reproduced → probe rejected
    const c = { ...v2Campaign(), verificationPolicy: incomplete, verificationPolicyDigest: incomplete.policyDigest } as Campaign;
    expect(loadVerifiedCampaignPolicy(c)).toEqual({ ok: false, reason: "policy_incomplete" });
  });
  it("tampered probe (stored digest unchanged) → policy_digest_mismatch", () => {
    const p = makeV2Policy();
    const tampered = { ...p, probes: p.probes.map((x) => ({ ...x, expected: { ...x.expected, addedTexts: ["Anything"] } })) };
    expect(loadVerifiedCampaignPolicy(v2Campaign({ verificationPolicy: tampered }))).toMatchObject({ ok: false });
  });
  it("policy bound to a different mission plan → policy_plan_mismatch", () => {
    expect(loadVerifiedCampaignPolicy(v2Campaign({ missionPlanDigest: "0xDIFFERENT" }))).toEqual({ ok: false, reason: "policy_plan_mismatch" });
  });
});
