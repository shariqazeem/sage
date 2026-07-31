import { describe, it, expect } from "vitest";
import { verifyReplayPermit } from "./replay-permit";
import type { Campaign, Submission } from "@/lib/db/schema";

/**
 * REGRESSION — campaign `launch-yara-garden-cerk8k`, the first real tester submission.
 *
 * The account PASSED the observation bar (5 of 9 distinct sources, comfortably over the 3 required)
 * and was still held, on every sweep, with
 * `action_replay_permit_denied:inconsistent:policy_without_required`.
 *
 * `verifyReplayPermit` fails closed when a policy exists while `required=false`, and it is right to:
 * it cannot distinguish a deliberate state from a corrupted one. The defect was upstream. A plan with
 * zero action criteria still COMPILES a policy — `{actionCriteria: [], probes: []}` — which proves
 * nothing and gates nothing, and attaching it put the campaign permanently into the inconsistent
 * state. A client-side product has no safe GET transitions to replay, so it compiles exactly this
 * empty policy, which means the entire class of observation-only campaigns could never pay anyone.
 *
 * The invariant is now maintained at the source: a policy is stored if and only if it is required.
 * These tests pin BOTH sides — the permit still refuses the corrupt state, and the consistent states
 * settle.
 */

const campaign = (over: Partial<Campaign>): Campaign =>
  ({
    id: "c1",
    verificationPolicy: null,
    verificationPolicyDigest: null,
    verificationPolicyVersion: null,
    verificationPolicyRequired: false,
    policySourceRevisionNumber: null,
    missionPlanDigest: "0xplan",
    ...over,
  }) as unknown as Campaign;

const submission = { id: "s1", missionIdHash: "0xmission" } as unknown as Submission;

const VACUOUS = {
  version: "verification-policy-v2",
  missionPlanDigest: "0xplan",
  productMapDigest: "0xmap",
  observationSetDigest: "set",
  actionCriteria: [],
  probes: [],
  policyDigest: "f54c31",
};

describe("an observation-only campaign can settle", () => {
  it("permits when no policy is attached and none is required", () => {
    const r = verifyReplayPermit(campaign({}), submission);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("policy_not_required");
  });

  it("is the state a zero-action plan must produce", () => {
    // The compiler yields `actionCriteria: []` for a client-side product; the pipeline must therefore
    // store NO policy, which lands on the permitted branch above.
    expect(VACUOUS.actionCriteria).toHaveLength(0);
    const asStored = campaign({
      verificationPolicy: null,
      verificationPolicyDigest: null,
      verificationPolicyRequired: false,
    });
    expect(verifyReplayPermit(asStored, submission).ok).toBe(true);
  });
});

describe("the corrupt state is still refused — the guarantee is unchanged", () => {
  it("refuses a policy attached without the required marker", () => {
    const r = verifyReplayPermit(
      campaign({
        verificationPolicy: VACUOUS as unknown as Campaign["verificationPolicy"],
        verificationPolicyDigest: "f54c31",
        verificationPolicyVersion: "verification-policy-v2",
        policySourceRevisionNumber: 1,
        verificationPolicyRequired: false,
      }),
      submission,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("inconsistent:policy_without_required");
  });

  it("this is exactly the row that froze the live campaign", () => {
    // policyLen=377, required=0 — reproduced field for field.
    const live = campaign({
      verificationPolicy: VACUOUS as unknown as Campaign["verificationPolicy"],
      verificationPolicyDigest:
        "f54c314b530e8ef357680db3924b1eb6f89ae404a8d059464a471303ac0d48ce",
      verificationPolicyVersion: "verification-policy-v2",
      policySourceRevisionNumber: 1,
      verificationPolicyRequired: false,
    });
    expect(verifyReplayPermit(live, submission).ok).toBe(false);
  });
});

describe("a REQUIRED covenant is not weakened by any of this", () => {
  it("still refuses a required campaign with incomplete metadata", () => {
    const r = verifyReplayPermit(
      campaign({
        verificationPolicy: VACUOUS as unknown as Campaign["verificationPolicy"],
        verificationPolicyRequired: true,
        verificationPolicyDigest: null,
        verificationPolicyVersion: null,
        policySourceRevisionNumber: null,
      }),
      submission,
    );
    expect(r.ok).toBe(false);
    // frozen by mode, or incomplete metadata — either way it does NOT settle.
    expect(r.reason).not.toBe("policy_not_required");
  });

  it("never returns the permitted no-policy reason once required is set", () => {
    const r = verifyReplayPermit(
      campaign({ verificationPolicyRequired: true }),
      submission,
    );
    expect(r.reason).not.toBe("policy_not_required");
  });
});
