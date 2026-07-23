import "server-only";

import { getApprovedRevision, getCurrentRevision } from "@/lib/db/plan-revisions";
import { attachVerificationPolicyToCampaign, type AttachPolicyResult } from "@/lib/db/campaigns";
import { checkRevisionPolicyForApproval } from "@/lib/launch/approve-policy";
import { deserializePlan } from "@/lib/launch/serde";

/**
 * Phase 3 — the ONE production caller that attaches an APPROVED revision's VerificationPolicyV2 to its campaign.
 * Called at deployment attach (the final atomic activation). Only an APPROVED, CURRENT revision may supply the
 * policy; the campaign's plan must match; the write is atomic + write-once (see attachVerificationPolicyToCampaign).
 * A revision with no policy is a no-op (non-canary campaign). Never binds an unapproved policy.
 */
export type AttachApprovedPolicyResult =
  | { ok: true; attached: boolean; idempotent?: boolean; reason?: string }
  | { ok: false; reason: string };

export function attachApprovedPolicyToCampaign(campaignId: string, jobId: string): AttachApprovedPolicyResult {
  const approved = getApprovedRevision(jobId);
  if (!approved) return { ok: true, attached: false, reason: "no_approved_revision" };
  // the approved revision must be the CURRENT one (no attaching a superseded plan's policy).
  const current = getCurrentRevision(jobId);
  if (!current || current.id !== approved.id) return { ok: false, reason: "approved_not_current" };
  const rawPolicy = approved.verificationPolicy ?? null;
  if (rawPolicy == null) {
    // no policy on the approved revision → nothing to attach (non-canary campaign).
    return { ok: true, attached: false, reason: approved.verificationPolicyRequired ? "required_but_missing" : "no_policy" };
  }
  // re-verify the policy against the approved plan before binding (defense in depth).
  const check = checkRevisionPolicyForApproval({
    verificationPolicy: rawPolicy,
    verificationPolicyDigest: approved.verificationPolicyDigest ?? null,
    verificationPolicyRequired: approved.verificationPolicyRequired === true,
    planMissionPlanDigest: deserializePlan(approved.planJson).missionPlanDigest,
  });
  if (!check.ok) return { ok: false, reason: `policy_check:${check.reason}` };
  const pol = rawPolicy as { version: string; missionPlanDigest: string; policyDigest: string };
  const res: AttachPolicyResult = attachVerificationPolicyToCampaign({
    campaignId,
    policy: rawPolicy,
    policyDigest: pol.policyDigest,
    policyVersion: pol.version,
    policyRequired: approved.verificationPolicyRequired === true,
    sourceRevisionNumber: approved.revisionNumber,
    revisionMissionPlanDigest: pol.missionPlanDigest,
  });
  if (!res.ok) return { ok: false, reason: `attach:${res.reason}` };
  return { ok: true, attached: true, idempotent: res.idempotent };
}
