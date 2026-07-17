import "server-only";
import {
  getDecisionBySubmission,
  listCampaignEvents,
  listSubmissions,
} from "@/lib/db/campaigns";
import { projectActivity, type ActivityEvent } from "./activity";

export interface CampaignActivity {
  activity: ActivityEvent[];
  /** last moment Sage actually recorded work (unix seconds), or null if none yet. */
  lastCheckedAt: number | null;
}

/**
 * Load the safe "Sage activity" feed for a campaign from real rows. Shared by the public
 * poll endpoint and the server-rendered board/console so the projection (and its
 * evidence-leak safety) lives in exactly one place. Confidence is read only for the
 * recent decision events (bounded), and only the number is used.
 */
export function loadCampaignActivity(campaignId: string, limit = 12): CampaignActivity {
  const events = listCampaignEvents(campaignId);
  const subs = listSubmissions(campaignId);

  const confidence: Record<string, number> = {};
  const recentDecisionSubs = [...events]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((e) => e.kind === "decision_recorded" && e.submissionId)
    .slice(0, 24)
    .map((e) => e.submissionId as string);
  for (const sid of new Set(recentDecisionSubs)) {
    const conf = getDecisionBySubmission(sid)?.brief?.confidence;
    if (typeof conf === "number") confidence[sid] = conf;
  }

  const activity = projectActivity(
    {
      submissions: subs.map((s) => ({
        id: s.id,
        wallet: s.wallet,
        createdAt: s.createdAt,
      })),
      events,
      confidence,
    },
    limit,
  );
  // Heartbeat = the last time Sage ACTED (a decision or settlement it recorded), not
  // campaign creation or a tester's submission — so a quiet-but-healthy campaign reads
  // "standing by", and a real processing delay reads "may be delayed".
  const SAGE_ACTIONS = [
    "decision_recorded",
    "settled",
    "autopay_settled",
    "autopay_held",
    "blocked",
  ];
  const actionAt = events
    .filter((e) => SAGE_ACTIONS.includes(e.kind))
    .map((e) => e.createdAt);
  const lastCheckedAt = actionAt.length ? Math.max(...actionAt) : null;
  return { activity, lastCheckedAt };
}
