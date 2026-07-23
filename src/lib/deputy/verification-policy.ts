import "server-only";

import { parseCompleteVerificationPolicyV2, type VerificationPolicyV2 } from "@/lib/launch/mission-probe-v2";
import type { MissionProbeV1 } from "@/lib/launch/mission-probe";
import type { Campaign } from "@/lib/db/schema";

/**
 * Load + VERIFY a campaign's bound VerificationPolicyV2 for payout action-replay. Every check FAILS CLOSED: a
 * missing policy, an empty campaign missionPlanDigest, a structurally-invalid or incomplete policy, a digest
 * that does not recompute to the separately-stored digest, or a policy bound to a different mission plan all
 * return `{ ok: false, reason }`. A fail-closed result means an action mission is NOT autonomous-payout eligible.
 */

export type PolicyLoad =
  | { ok: true; policy: VerificationPolicyV2 }
  | { ok: false; reason: "policy_missing" | "policy_malformed" | "policy_incomplete" | "policy_digest_mismatch" | "policy_plan_mismatch" };

export function loadVerifiedCampaignPolicy(campaign: Pick<Campaign, "verificationPolicy" | "verificationPolicyDigest" | "missionPlanDigest">): PolicyLoad {
  const raw = campaign.verificationPolicy;
  const storedDigest = campaign.verificationPolicyDigest;
  if (raw == null || !storedDigest) return { ok: false, reason: "policy_missing" };
  // a canary policy is only meaningful when bound to a committed plan.
  if (!campaign.missionPlanDigest) return { ok: false, reason: "policy_plan_mismatch" };
  // strict schema + COMPLETE coverage + self-consistent digest (parseCompleteVerificationPolicyV2 does all three).
  const parsed = parseCompleteVerificationPolicyV2(raw);
  if (!parsed.ok) return { ok: false, reason: parsed.reason === "schema_invalid" ? "policy_malformed" : "policy_incomplete" };
  const policy = parsed.policy;
  // the recomputed digest must ALSO equal the separately-stored campaign digest (tamper of one but not the other).
  if (policy.policyDigest !== storedDigest) return { ok: false, reason: "policy_digest_mismatch" };
  if (policy.missionPlanDigest !== campaign.missionPlanDigest) return { ok: false, reason: "policy_plan_mismatch" };
  return { ok: true, policy };
}

/** The compiled probes for a mission (by missionKey). Empty ⇒ this mission has no action-replay probe. */
export function probesForMission(policy: VerificationPolicyV2, missionKey: string): MissionProbeV1[] {
  return policy.probes.filter((p) => p.missionKey === missionKey);
}

/** True ⇔ the verified policy proves this mission HAS ≥1 action criterion. Used to fail closed: never infer
 *  "not an action mission" merely because a missionKey is absent from an untrusted/incomplete policy. */
export function policyMarksActionMission(policy: VerificationPolicyV2, missionKey: string): boolean {
  return policy.actionCriteria.some((ac) => ac.missionKey === missionKey);
}
