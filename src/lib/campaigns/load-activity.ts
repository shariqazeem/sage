import "server-only";
import {
  getDecisionBySubmission,
  listCampaignEvents,
  listSubmissions,
} from "@/lib/db/campaigns";
import { projectActivity, type ActivityEvent } from "./activity";
import { decodeDetail } from "./journal";
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
    // It is a TEXT column holding an encodeDetail envelope, so it must be DECODED — reading `.t`
    // off the string silently returned undefined for every hold, which is the other half of why
    // the founder's page said "unknown" while the Telegram DM said "observation_review".
    const t = decodeDetail(held?.detail ?? null).text;
    if (typeof t !== "string") return null;
    const token = t.includes("·") ? t.split("·").pop()!.trim() : t.trim();
    return token.length > 0 ? token : null;
  };
  /**
   * THE GATE'S REASON OUTRANKS THE BRAIN'S — including when the brain never gave one.
   *
   * This only looked up a reason when the DECISION recommended something other than pay, so every
   * observation-lane hold read "Sage couldn't reach a confident decision (unknown)" on the founder's
   * own campaign page. On the observation lane the brain deliberately ABSTAINS (the
   * `observation-abstain` receipt is the correct final receipt — the deterministic corpus matcher
   * decides, not the model), so `recommendation` is absent by design and the branch never fired.
   * Meanwhile the true reason — per-wallet cap, observation_review, observation_retry — was sitting
   * on the `autopay_held` event the whole time, and Telegram was already printing it correctly.
   * Measured on clawup 2026-08-14: four holds, four "(unknown)" on the web, four accurate DMs.
   *
   * The gate line is also used AS-IS. It is already a rendered, enumerated sentence written by our
   * own code, and passing it back through `reasonSentence` produced the double-wrapped nonsense
   * "Sage couldn't reach a confident decision (observation-based work that needs your judgment …)".
   */
  const heldReasons: Record<string, string> = {};
  for (const s of subs) {
    const d = getDecisionBySubmission(s.id);
    const recommendation = d?.brief?.recommendation;
    if (recommendation === "pay") continue; // verified — never render a hold line
    const gate = gateReasonOf(s.id);
    if (gate) heldReasons[s.id] = gate;
    else if (recommendation) heldReasons[s.id] = reasonSentence(d!.brief.reasonCode);
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
