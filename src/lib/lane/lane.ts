import "server-only";
import type { Campaign, Submission } from "@/lib/db/schema";
import { getDecisionBySubmission, getLatestSubmissionEvent, listCampaignEvents, listSubmissions, listSubmissionsForDedup } from "@/lib/db/campaigns";
import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { sameNullifierWallets } from "@/lib/identity/person";
import { decodeDetail } from "@/lib/campaigns/journal";
import { watchReadings, windowSecondsFor } from "@/lib/deputy/finalization";

/**
 * THE SETTLING LANE — every payout the agent has approved on an open campaign, with its clock and
 * the watch's current reading. Nothing here is decoration: `approvedAt` is the autopay_approved
 * event, the three lights are the same functions the sweep will run at maturity, and a ticket
 * leaves the lane only because a settlement or a revocation was recorded.
 */
export type Light = "clear" | "flag";
export interface LaneTicket {
  id: string;
  campaignId: string;
  campaignTitle: string;
  wallet: string;
  rewardBase: number;
  rail: "evm" | "starknet";
  state: "approved" | "settling" | "paid" | "revoked";
  approvedAt: number | null;
  finalizesAt: number | null;
  windowSec: number;
  lights: { nearDup: Light; copied: Light; cluster: Light } | null;
  reason: string | null;
  txHash: string | null;
  at: number;
}

const RECENT_SEC = 6 * 3600;

function ticketFor(c: Campaign, s: Submission, nowSec: number): LaneTicket | null {
  const agent = getLatestSubmissionEvent(s.id, "autopay_approved");
  if (s.status === "approved" || s.status === "settling") {
    const windowSec = windowSecondsFor(c.visibility);
    const decision = getDecisionBySubmission(s.id);
    const r = watchReadings({
      me: { note: s.note, contentSha256: decision?.contentSha256 ?? null, artifactFingerprint: decision?.artifactFingerprint ?? null },
      others: listSubmissionsForDedup(c.id, s.id),
      linkedWallets: linkedWalletsOf(s.wallet),
      personWallets: sameNullifierWallets(s.wallet),
      peerWallets: listSubmissions(c.id).filter((x) => x.id !== s.id).map((x) => x.wallet),
    });
    return {
      id: s.id, campaignId: c.id, campaignTitle: c.title, wallet: s.wallet, rewardBase: c.rewardAmount, rail: c.settlementRail,
      state: s.status === "settling" ? "settling" : "approved",
      approvedAt: agent?.createdAt ?? s.decidedAt ?? null,
      finalizesAt: agent ? agent.createdAt + windowSec : null,
      windowSec,
      lights: { nearDup: r.nearDup ? "flag" : "clear", copied: r.copied ? "flag" : "clear", cluster: r.cluster ? "flag" : "clear" },
      reason: r.nearDup ?? r.copied ?? r.cluster ?? null,
      txHash: null,
      at: agent?.createdAt ?? s.decidedAt ?? s.createdAt,
    };
  }
  if (!agent) return null; // only tickets that passed through the lane
  if (s.status === "paid" && s.payoutTx && (s.decidedAt ?? 0) >= nowSec - RECENT_SEC) {
    return { id: s.id, campaignId: c.id, campaignTitle: c.title, wallet: s.wallet, rewardBase: c.rewardAmount, rail: c.settlementRail, state: "paid", approvedAt: agent.createdAt, finalizesAt: null, windowSec: 0, lights: null, reason: null, txHash: s.payoutTx, at: s.decidedAt ?? nowSec };
  }
  if (s.status === "rejected" && (s.decidedAt ?? 0) >= nowSec - RECENT_SEC) {
    const rej = getLatestSubmissionEvent(s.id, "submission_rejected");
    const text = decodeDetail(rej?.detail ?? null).text ?? s.rejectReason ?? "";
    return { id: s.id, campaignId: c.id, campaignTitle: c.title, wallet: s.wallet, rewardBase: c.rewardAmount, rail: c.settlementRail, state: "revoked", approvedAt: agent.createdAt, finalizesAt: null, windowSec: 0, lights: null, reason: text.replace(/^0x[0-9a-f…]+ · /i, "") || (s.rejectReason ?? null), txHash: null, at: s.decidedAt ?? nowSec };
  }
  return null;
}

export function laneFor(campaigns: Campaign[], nowSec = Math.floor(Date.now() / 1000)): LaneTicket[] {
  const out: LaneTicket[] = [];
  for (const c of campaigns) {
    for (const s of listSubmissions(c.id)) {
      const t = ticketFor(c, s, nowSec);
      if (t) out.push(t);
    }
  }
  const rank = { approved: 0, settling: 1, revoked: 2, paid: 3 } as const;
  return out.sort((a, b) => rank[a.state] - rank[b.state] || b.at - a.at).slice(0, 40);
}

/** The last settlements and refusals across these campaigns — the tape the lane feeds. */
export function tapeFor(campaigns: Campaign[], limit = 12): { id: string; kind: "paid" | "revoked" | "held"; wallet: string | null; text: string; txHash: string | null; at: number; campaignTitle: string }[] {
  const rows: { id: string; kind: "paid" | "revoked" | "held"; wallet: string | null; text: string; txHash: string | null; at: number; campaignTitle: string }[] = [];
  for (const c of campaigns) {
    for (const e of listCampaignEvents(c.id)) {
      if (e.kind !== "autopay_settled" && e.kind !== "submission_rejected" && e.kind !== "autopay_held") continue;
      const text = decodeDetail(e.detail).text ?? "";
      rows.push({ id: e.id, kind: e.kind === "autopay_settled" ? "paid" : e.kind === "submission_rejected" ? "revoked" : "held", wallet: null, text, txHash: e.txHash ?? null, at: e.createdAt, campaignTitle: c.title });
    }
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, limit);
}
