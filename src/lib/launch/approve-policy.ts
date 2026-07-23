import { parseCompleteVerificationPolicyV2, VerificationPolicyV2Schema, verificationPolicyV2Digest } from "./mission-probe-v2";

/**
 * Phase 2 — the approval-critical VerificationPolicyV2 check, sourced ONLY from the CURRENT plan revision (never
 * from mutable job.result). Pure + deterministic so every rejection path is unit-testable. Fails closed on a
 * required-but-missing / malformed / digest-mismatch / cross-plan / incomplete policy.
 */
export interface RevisionPolicyInput {
  /** the revision's bound VerificationPolicyV2 (untrusted JSON), or null. */
  verificationPolicy: unknown;
  /** the revision's stored policy digest, or null. */
  verificationPolicyDigest: string | null;
  /** the revision's explicit "autonomous payout requires complete coverage" marker. */
  verificationPolicyRequired: boolean;
  /** the current revision plan's missionPlanDigest (the authoritative binding target). */
  planMissionPlanDigest: string;
}

export type RevisionPolicyCheck =
  | { ok: true; boundDigest: string | null; version: string | null }
  | { ok: false; reason: "required_but_missing" | "schema_invalid" | "digest_mismatch" | "plan_mismatch" | "incomplete" };

export function checkRevisionPolicyForApproval(input: RevisionPolicyInput): RevisionPolicyCheck {
  const raw = input.verificationPolicy ?? null;
  if (input.verificationPolicyRequired && raw == null) return { ok: false, reason: "required_but_missing" };
  if (raw == null) return { ok: true, boundDigest: null, version: null }; // no policy + not required → approve the plan
  const schema = VerificationPolicyV2Schema.safeParse(raw);
  if (!schema.success) return { ok: false, reason: "schema_invalid" };
  const pol = schema.data;
  if (verificationPolicyV2Digest(pol) !== pol.policyDigest || pol.policyDigest !== input.verificationPolicyDigest) return { ok: false, reason: "digest_mismatch" };
  if (pol.missionPlanDigest !== input.planMissionPlanDigest) return { ok: false, reason: "plan_mismatch" };
  if (input.verificationPolicyRequired) {
    const complete = parseCompleteVerificationPolicyV2(raw);
    if (!complete.ok) return { ok: false, reason: "incomplete" };
  }
  return { ok: true, boundDigest: pol.policyDigest, version: pol.version };
}
