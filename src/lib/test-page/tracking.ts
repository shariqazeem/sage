import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { channelPosts, xPosts, type Campaign, type CampaignEvent, type InspectionJob, type Submission } from "@/lib/db/schema";
import { founderStorageKey } from "@/lib/auth/founder";
import { buildHeldTriage } from "@/lib/campaigns/held-triage";
import { decodeDetail } from "@/lib/campaigns/journal";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { REACHED_REPORT, AGAIN_TAP } from "@/lib/core-test/shape";
import { listCoreAnswers } from "@/lib/core-test/answers";
import { getDecisionBySubmission, listCampaignEvents, listSubmissions } from "@/lib/db/campaigns";
import { getInspectionJobByCampaign } from "@/lib/db/inspection";
import { getApprovedRevision, getCurrentRevision } from "@/lib/db/plan-revisions";
import { listVisits } from "@/lib/db/test-visits";
import { chainConfig, explorerAddressUrl } from "@/lib/deputy/networks";
import { short } from "@/lib/format";
import { sageReadsOnly } from "@/lib/launch/product-kind";
import { seatHolders } from "@/lib/people/seats";
import { storedFindings } from "@/lib/report";
import { framesOf } from "@/lib/site/real-test-frames";
import { hostOf } from "@/lib/site/when";
import { buildActivity, reasonWords, type ActivityItem } from "./activity";
import { buildFunnel, buildSources, isSourceKey, walletKey, type FunnelAnswer, type FunnelInput, type SourceKey, type SourceRow, type TestFunnel } from "./funnel";

/**
 * THE ROWS BEHIND "SEE EVERYTHING" (27 Nov 2026): the server side of the funnel, the sources, each
 * person's journey and what Sage did. It reads recorded rows and hands them to the pure cores
 * (`funnel.ts`, `activity.ts`). Everything here is for the test's OWNER; no public view reads it.
 */

/** What a person's ticket carries for the owner: where they came from and when each thing happened. */
export interface TicketJourney {
  source: SourceKey | null;
  sawAt: number | null;
  signedInAt: number | null;
  openedAt: number | null;
  answeredAt: number | null;
  decidedAt: number | null;
  paidAt: number | null;
  /** how far they said they got with the main action, in the report's words; null when they tapped nothing */
  stoppedAt: string | null;
  /** whether they said they would use it again; null when they tapped nothing */
  wouldReturn: string | null;
}

const RETRY = /observation_retry|for the tester to refine/i;
const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * THE ANSWERS WAITING FOR THE BUILDER, each with the recorded reason. An answer is the builder's once Sage
 * has read it and it is still pending, unless its last hold only asks the tester to add to their answer
 * (that one is not the builder's yet). The reason is the held triage's own fixed sentence, else the
 * journal's words; never a new one.
 */
export function heldForBuilder(campaign: Campaign, subs: readonly Submission[] = listSubmissions(campaign.id), events: readonly CampaignEvent[] = listCampaignEvents(campaign.id)): Map<string, string> {
  const lastHold = new Map<string, string | null>();
  // events arrive newest first, so the first one seen for an answer is its latest hold
  for (const e of events) {
    if (e.kind !== "autopay_held" || !e.submissionId || lastHold.has(e.submissionId)) continue;
    lastHold.set(e.submissionId, decodeDetail(e.detail).text);
  }
  const held = new Map<string, string>();
  for (const s of subs) {
    if (s.status !== "pending" || !getDecisionBySubmission(s.id)) continue;
    const journal = lastHold.get(s.id) ?? null;
    if (journal && RETRY.test(journal)) continue;
    const triage = reasonWords(buildHeldTriage(campaign, s).heldBecause[0]);
    const why = triage && !/^held \(/.test(triage) ? triage : (reasonWords(journal) ?? "Sage held it for you to read");
    held.set(s.id, capital(why));
  }
  return held;
}

export interface Tracking {
  funnel: TestFunnel;
  sources: SourceRow[];
  /** by submission id, and `seat:<wallet key>` for a place taken with no answer yet */
  journeyOf: (key: { submissionId: string } | { seatWallet: string }) => TicketJourney;
  held: Map<string, string>;
}

export function trackingFor(campaign: Campaign, subs: readonly Submission[] = listSubmissions(campaign.id), events: readonly CampaignEvent[] = listCampaignEvents(campaign.id)): Tracking {
  const visits = listVisits(campaign.id);
  const held = heldForBuilder(campaign, subs, events);
  const answers: FunnelAnswer[] = subs.map((s) => ({
    wallet: s.wallet,
    state: s.status === "paid" ? "paid" : s.status === "rejected" || s.status === "blocked" ? "not-paid" : held.has(s.id) ? "held" : "open",
  }));
  const seats = seatHolders(campaign.id);
  const input: FunnelInput = { visits, answers, seats };

  // a person's earliest visit, by wallet
  const visitOf = new Map<string, (typeof visits)[number]>();
  for (const v of visits) {
    if (!v.wallet) continue;
    const k = walletKey(v.wallet);
    if (!visitOf.has(k)) visitOf.set(k, v); // oldest first
  }
  const firstOf = (wallet: string, pick: "signedInAt" | "openedAt"): number | null => {
    const k = walletKey(founderStorageKey(wallet));
    const times = visits.filter((v) => v.wallet && walletKey(v.wallet) === k && v[pick] !== null).map((v) => v[pick] as number);
    return times.length > 0 ? Math.min(...times) : null;
  };
  const paidAt = new Map<string, number>();
  for (const e of events) {
    if ((e.kind === "settled" || e.kind === "autopay_settled") && e.submissionId) paidAt.set(e.submissionId, Math.min(paidAt.get(e.submissionId) ?? e.createdAt, e.createdAt));
  }
  const taps = listCoreAnswers(campaign.id);
  const byId = new Map(subs.map((s) => [s.id, s]));
  const seatSet = new Set(seats.map((w) => walletKey(founderStorageKey(w))));

  const journeyOf: Tracking["journeyOf"] = (key) => {
    const sub = "submissionId" in key ? (byId.get(key.submissionId) ?? null) : null;
    const wallet = sub ? sub.wallet : "seatWallet" in key ? key.seatWallet : null;
    const k = wallet ? walletKey(founderStorageKey(wallet)) : null;
    const visit = k ? (visitOf.get(k) ?? null) : null;
    const tap = sub ? (taps.get(sub.id) ?? null) : null;
    const source: SourceKey | null = visit ? (isSourceKey(visit.source) ? visit.source : "other") : k && seatSet.has(k) ? "link" : sub ? "direct" : null;
    return {
      source,
      sawAt: visit?.firstAt ?? null,
      signedInAt: wallet ? firstOf(wallet, "signedInAt") : null,
      openedAt: wallet ? firstOf(wallet, "openedAt") : null,
      answeredAt: sub?.createdAt ?? null,
      decidedAt: sub?.decidedAt ?? null,
      paidAt: sub && sub.status === "paid" ? (paidAt.get(sub.id) ?? sub.decidedAt ?? null) : null,
      stoppedAt: tap ? REACHED_REPORT[tap.reached] : null,
      wouldReturn: tap ? AGAIN_TAP[tap.again] : null,
    };
  };

  return { funnel: buildFunnel(input), sources: buildSources(input), journeyOf, held };
}

/** Only the funnel: for a card on Home, where the journeys are not needed. */
export function funnelFor(campaign: Campaign): TestFunnel {
  const subs = listSubmissions(campaign.id);
  return buildFunnel({
    visits: listVisits(campaign.id),
    answers: subs.map((s) => ({ wallet: s.wallet, state: s.status === "paid" ? "paid" : s.status === "rejected" || s.status === "blocked" ? "not-paid" : "open" })),
    seats: seatHolders(campaign.id),
  });
}

/* ──────────────────────────────────────────────────── what Sage did ───── */

/** A post in a public Telegram channel has an address; one in a channel known only by its number does not. */
function channelUrl(chatId: string, messageId: number | null): string | null {
  if (!messageId || !chatId.startsWith("@")) return null;
  return `https://t.me/${chatId.slice(1)}/${messageId}`;
}

export function activityFor(
  campaign: Campaign,
  ctx: { subs?: readonly Submission[]; events?: readonly CampaignEvent[]; job?: InspectionJob | null } = {},
): ActivityItem[] {
  const subs = ctx.subs ?? listSubmissions(campaign.id);
  const events = ctx.events ?? listCampaignEvents(campaign.id);
  const job = ctx.job === undefined ? getInspectionJobByCampaign(campaign.id) : ctx.job;
  const e = v2Economics(campaign);
  const host = job ? hostOf(job.productUrl) : null;

  const result = (job?.result ?? null) as { map?: { fieldTest?: unknown; productKind?: unknown } } | null;
  const ran = host && result?.map?.fieldTest ? framesOf(result.map.fieldTest, host, 1) : null;
  const revision = job ? (getApprovedRevision(job.id) ?? getCurrentRevision(job.id)) : null;
  const planned = (revision?.planJson ?? null) as { missions?: unknown[] } | null;

  const created = events.find((x) => x.kind === "campaign_created");
  const posted = db
    .select()
    .from(xPosts)
    .where(and(inArray(xPosts.subjectKey, [`mission:${campaign.id}`, `result:${campaign.id}`]), eq(xPosts.status, "posted")))
    .all();
  const channel = db.select().from(channelPosts).where(eq(channelPosts.subjectKey, `mission:${campaign.id}`)).get();
  const findings = storedFindings(campaign.id);

  // The end has a time only when a row carries one: the last payout that filled the test. A test that was
  // stopped by hand records no time for it, so it gets no line here (its status says it on the page).
  const full = e.totalCompletions > 0 && e.paidCompletions >= e.totalCompletions;
  const lastPaid = Math.max(0, ...events.filter((x) => x.kind === "settled" || x.kind === "autopay_settled").map((x) => x.createdAt));

  return buildActivity({
    product: host ?? campaign.title,
    run: job && ran ? { at: job.createdAt, steps: ran.steps, seconds: ran.seconds } : null,
    sageReads: job ? sageReadsOnly(result?.map ?? null, job.productUrl) : null,
    plan: revision && Array.isArray(planned?.missions) ? { at: revision.approvedAt ?? revision.createdAt, missions: planned.missions.length, places: e.totalCompletions } : null,
    opened:
      campaign.status === "draft"
        ? null
        : {
            at: created?.createdAt ?? campaign.createdAt,
            fundedBase: e.totalFundedBase,
            places: e.totalCompletions,
            network: chainConfig(e.chainId).name,
            vaultUrl: campaign.settlementRail === "starknet" ? null : explorerAddressUrl(campaign.chainId, campaign.vaultAddress),
          },
    events: events.map((x) => ({ kind: x.kind, at: x.createdAt, text: decodeDetail(x.detail).text, submissionId: x.submissionId, txHash: x.txHash, amountBase: x.amount })),
    answers: new Map(subs.map((s) => [s.id, { handle: short(s.wallet), status: s.status, rejectReason: s.rejectReason }])),
    xPosts: posted
      .filter((p) => p.kind === "mission" || p.kind === "result")
      .map((p) => ({ kind: p.kind as "mission" | "result", at: p.postedAt ?? p.createdAt, url: p.tweetId ? `https://x.com/i/status/${p.tweetId}` : null })),
    channelPost: channel && channel.status === "posted" ? { at: channel.postedAt ?? channel.createdAt, url: channelUrl(channel.chatId, channel.messageId) } : null,
    findings: findings ? { at: findings.builtAt, answers: findings.paidAnswers, groups: findings.json?.findings?.length ?? 0 } : null,
    ended: full && lastPaid > 0 ? { at: lastPaid, how: "full", paid: e.paidCompletions, total: e.totalCompletions } : null,
  });
}
