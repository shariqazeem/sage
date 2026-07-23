import "server-only";

import { verificationPolicyDigest, type VerificationPolicyV1, type MissionProbeV1 } from "@/lib/launch/mission-probe";
import type { Campaign } from "@/lib/db/schema";

/**
 * Phase 3 — load + VERIFY a campaign's bound VerificationPolicyV1 for payout action-replay (Phase 4). Every
 * check FAILS CLOSED: a missing policy, a structurally-invalid policy, a digest that does not recompute to the
 * separately-stored digest, or a policy bound to a different mission plan all return `{ ok: false, reason }`.
 * A fail-closed result means an action mission is NOT autonomous-payout eligible — it can only HOLD, never pay.
 */

export type PolicyLoad =
  | { ok: true; policy: VerificationPolicyV1 }
  | { ok: false; reason: "policy_missing" | "policy_malformed" | "policy_digest_mismatch" | "policy_plan_mismatch" };

function isPolicy(v: unknown): v is VerificationPolicyV1 {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return p.version === "verification-policy-v1" && typeof p.missionPlanDigest === "string" && typeof p.productMapDigest === "string" &&
    typeof p.observationSetDigest === "string" && Array.isArray(p.actionMissions) && Array.isArray(p.probes) && typeof p.policyDigest === "string";
}

export function loadVerifiedCampaignPolicy(campaign: Pick<Campaign, "verificationPolicy" | "verificationPolicyDigest" | "missionPlanDigest">): PolicyLoad {
  const raw = campaign.verificationPolicy;
  const storedDigest = campaign.verificationPolicyDigest;
  if (raw == null || !storedDigest) return { ok: false, reason: "policy_missing" };
  if (!isPolicy(raw)) return { ok: false, reason: "policy_malformed" };
  const policy = raw as VerificationPolicyV1;
  // recompute the digest over the policy body — a tampered policy whose stored digest wasn't also changed fails.
  const recomputed = verificationPolicyDigest(policy);
  if (recomputed !== policy.policyDigest || recomputed !== storedDigest) return { ok: false, reason: "policy_digest_mismatch" };
  // the policy must be bound to THIS campaign's committed mission plan.
  if (campaign.missionPlanDigest && policy.missionPlanDigest !== campaign.missionPlanDigest) return { ok: false, reason: "policy_plan_mismatch" };
  return { ok: true, policy };
}

/** The compiled probes for a mission (by missionKey). Empty ⇒ this mission has no action-replay probe. */
export function probesForMission(policy: VerificationPolicyV1, missionKey: string): MissionProbeV1[] {
  return policy.probes.filter((p) => p.missionKey === missionKey);
}
