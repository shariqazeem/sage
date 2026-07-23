import "server-only";

import { payoutActionReplayMode } from "./payout-replay";
import { loadVerifiedCampaignPolicy, probesForMission, policyMarksActionMission } from "./verification-policy";
import { getMissionByHash } from "@/lib/db/campaigns";
import { dbReplayJournal, type ReplayJournalHandle } from "@/lib/db/payout-replay-journal";
import type { Campaign, Submission } from "@/lib/db/schema";

/**
 * Phase 5 — the CENTRAL replay permit, verified at the settlement sink (settleApprovedSubmission) BEFORE any
 * broadcast. A policy-required canary ACTION submission may only settle when the durable journal proves that
 * EVERY required probe has a COMPLETED, REPRODUCED result for the EXACT (submissionId, policyDigest, probeDigest).
 * This lets runDeputyOnSubmission (and cron/manual re-fire) reuse the same durable permit — but NONE of them can
 * bypass it: a settle without the permit fails closed. Required canary policies have NO human override this sprint.
 */

export type ReplayPermit = { ok: true; reason: string } | { ok: false; reason: string };

export function verifyReplayPermit(
  campaign: Pick<Campaign, "id" | "verificationPolicy" | "verificationPolicyDigest" | "verificationPolicyRequired" | "missionPlanDigest">,
  submission: Pick<Submission, "id" | "missionIdHash">,
  journal: ReplayJournalHandle = dbReplayJournal,
): ReplayPermit {
  // only canary mode gates settlement; off/shadow leave historical behaviour unchanged.
  if (payoutActionReplayMode() !== "canary") return { ok: true, reason: "mode_not_canary" };
  if (campaign.verificationPolicyRequired !== true) return { ok: true, reason: "policy_not_required" };

  const load = loadVerifiedCampaignPolicy(campaign);
  if (!load.ok) return { ok: false, reason: `policy_${load.reason}` }; // required but unverifiable → fail closed
  const policy = load.policy;

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
