import "server-only";
import {
  getDecisionBySubmission,
  listCampaignEvents,
  listSubmissions,
} from "@/lib/db/campaigns";
import { projectActivity, type ActivityEvent } from "./activity";
import { reasonSentence } from "@/lib/deputy/reason-copy";

export interface CampaignActivity {
  activity: ActivityEvent[];
  /** last moment Sage actually recorded work (unix seconds), or null if none yet. */
  lastCheckedAt: number | null;
  /** is there work awaiting Sage right now (a pending submission)? Drives the honest heartbeat. */
  pending: boolean;
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

  // Any submission whose DECISION recommended something other than pay was HELD — surface the real
  // reason so its decision line reads "Held: …", never a false "verified". Keyed on the decision, not
  // current status, so a held-then-released payout still shows the hold (then a separate paid line).
  // THE REASON A SUBMISSION IS ACTUALLY HELD is the SETTLEMENT GATE's, not the brain's, whenever the
  // gate is what stopped it. Reading `brief.reasonCode` unconditionally told the first real tester on
  // the yara campaign "the submitted link had no usable evidence" — a url-lane code that is
  // meaningless for an observation mission (the pipeline says so in as many words) — while the true
  // reason, recorded correctly on the `autopay_held` event, was a replay-permit denial. Their account
  // had in fact PASSED the bar with 5 of 9 distinct sources. Telling someone their evidence was
  // unusable when it was accepted is the worst kind of wrong: it reads as a verdict on their work.
  const gateReasonOf = (submissionId: string): string | null => {
    const held = [...events]
      .filter((e) => e.kind === "autopay_held" && e.submissionId === submissionId)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    // detail carries "<wallet> · <reason>"; the reason is the part the founder needs.
    const t = (held?.detail as { t?: unknown } | null)?.t;
    if (typeof t !== "string") return null;
    const token = t.includes("·") ? t.split("·").pop()!.trim() : t.trim();
    return token.length > 0 ? token : null;
  };
  const heldReasons: Record<string, string> = {};
  for (const s of subs) {
    const d = getDecisionBySubmission(s.id);
    if (d && d.brief?.recommendation && d.brief.recommendation !== "pay") {
      heldReasons[s.id] = reasonSentence(gateReasonOf(s.id) ?? d.brief.reasonCode);
    }
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
      heldReasons,
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
  const pending = subs.some((s) => s.status === "pending");
  return { activity, lastCheckedAt, pending };
}
