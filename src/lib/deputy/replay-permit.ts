import "server-only";

import { payoutActionReplayMode } from "./payout-replay";
import { loadVerifiedCampaignPolicy, probesForMission, policyMarksActionMission } from "./verification-policy";
import { getMissionByHash } from "@/lib/db/campaigns";
import { dbReplayJournal, type ReplayJournalHandle } from "@/lib/db/payout-replay-journal";
import type { Campaign, Submission } from "@/lib/db/schema";

/**
 * The CENTRAL replay permit, verified at the settlement sink (settleApprovedSubmission) BEFORE any broadcast.
 *
 * P1 — a campaign with verificationPolicyRequired=true carries a PERMANENT settlement COVENANT. The env mode
 * (off/shadow/unknown/canary) can create/observe NEW canaries but can NEVER weaken a covenant already attached:
 * a required covenant only settles under canary WITH a fresh reproduced permit; under off/shadow/unknown it is
 * FROZEN (HOLD), never settled unverified. Non-required historical campaigns keep legacy behaviour. NONE of the
 * settlement paths (deputy, cron, manual routes) can bypass this — a settle without the permit fails closed.
 */

export type ReplayPermit = { ok: true; reason: string } | { ok: false; reason: string };

export function verifyReplayPermit(
  campaign: Pick<Campaign, "id" | "verificationPolicy" | "verificationPolicyDigest" | "verificationPolicyVersion" | "verificationPolicyRequired" | "policySourceRevisionNumber" | "missionPlanDigest">,
  submission: Pick<Submission, "id" | "missionIdHash">,
  journal: ReplayJournalHandle = dbReplayJournal,
): ReplayPermit {
  const required = campaign.verificationPolicyRequired === true;
  const hasPolicy = campaign.verificationPolicy != null;

  // a NON-required campaign must have NO attached policy — a policy without the required marker is an
  // inconsistent covenant state → fail closed (defect: a V2/action policy exists while required=false).
  if (!required) {
    return hasPolicy ? { ok: false, reason: "inconsistent:policy_without_required" } : { ok: true, reason: "policy_not_required" };
  }

  // REQUIRED covenant — immutable. Only canary can settle it (with a fresh permit); every other mode FREEZES.
  const mode = payoutActionReplayMode();
  if (mode !== "canary") return { ok: false, reason: `covenant_frozen:${mode}` };

  // the covenant's metadata must be internally consistent.
  if (!campaign.verificationPolicyDigest || !campaign.verificationPolicyVersion || campaign.policySourceRevisionNumber == null) {
    return { ok: false, reason: "covenant_metadata_incomplete" };
  }

  const load = loadVerifiedCampaignPolicy(campaign);
  if (!load.ok) return { ok: false, reason: `policy_${load.reason}` }; // required but unverifiable → fail closed
  const policy = load.policy;
  // version/digest fields must agree with the loaded policy (source-revision presence already checked above).
  if (policy.version !== campaign.verificationPolicyVersion || policy.policyDigest !== campaign.verificationPolicyDigest) {
    return { ok: false, reason: "covenant_fields_disagree" };
  }

  const mission = submission.missionIdHash ? getMissionByHash(campaign.id, submission.missionIdHash) : null;
  if (!mission) return { ok: false, reason: "mission_unknown" }; // required campaign + unknown mission → fail closed
  // the COMPLETE policy proves whether this mission is an action mission; a non-action mission needs no permit.
  if (!policyMarksActionMission(policy, mission.missionKey)) return { ok: true, reason: "non_action_mission" };

  const probes = probesForMission(policy, mission.missionKey);
  if (probes.length === 0) return { ok: false, reason: "no_probe_for_action_mission" };
  for (const probe of probes) {
    const rec = journal.lookup(submission.id, policy.policyDigest, probe.probeDigest);
    if (!rec || !rec.completed) return { ok: false, reason: "replay_not_completed" };
    if (rec.decision !== "allow" || rec.code !== "reproduced") return { ok: false, reason: `replay_veto:${rec.code}` };
  }
  return { ok: true, reason: "all_probes_reproduced" };
}
