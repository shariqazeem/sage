import "server-only";
import { and, eq, gte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { submissions, testerNotices, workAlerts, type Campaign, type Submission } from "@/lib/db/schema";
import { decodeDetail } from "@/lib/campaigns/journal";
import { getCampaign, getMissionByHash, listCampaignEvents } from "@/lib/db/campaigns";
import { productUrlForCampaign } from "@/lib/db/inspection";
import { nowSeconds } from "@/lib/db/keys";
import { getRecipientWalletByAddress } from "@/lib/db/recipient-wallets";
import { walletKey } from "@/lib/db/roster";
import { OBS_MAX_ATTEMPTS } from "@/lib/deputy/observation-verify";
import { notPaidReason } from "@/lib/report";
import { siteUrl } from "@/lib/site";
import { testUrl } from "@/lib/site/test-url";
import { hostOf } from "@/lib/site/when";
import { sendTelegram } from "@/lib/telegram/bot";
import { heldForBuilder, RETRY } from "@/lib/test-page/tracking";
import { dueTesterNotices, noticeKey, type AnswerFacts } from "./due";

/**
 * TELL THE TESTER (28 Nov 2026). The sweep's step for testers who asked Sage to message them on Telegram
 * (the alerts roster, `work_alerts`): what happened to their OWN answer, once per answer and kind.
 *
 * - Opt-in only. Being paid is not consent: a wallet that never joined the roster is never messaged, and a
 *   muted one is not either.
 * - Only what happened after they joined, and nothing from before this step first ran: the first run marks
 *   everything already true as said and sends nothing (`BASELINE`).
 * - A walletless tester whose payout already messages their chat (`notifyRecipientPaid`) is not told twice.
 * - Best effort. It reads rows and sends text; it cannot touch a payout, and a failure stops nothing.
 */
export const RECENT_SEC = 7 * 24 * 3600;
export const MAX_TESTER_NOTICES_PER_TICK = 8;
/** The row that says the first run happened: its past was marked, not messaged. */
export const BASELINE = { submissionId: "__baseline__", kind: "baseline" } as const;

export type Send = (chatId: string, text: string) => Promise<boolean>;
const sendPlain: Send = (chatId, text) => sendTelegram(chatId, text, { html: false });

export interface TesterNoticeSummary {
  sent: number;
  failed: number;
  /** notices marked as said without a message, on the first run */
  baselined: number;
}

const claim = (submissionId: string, kind: string, now: number): boolean =>
  db.insert(testerNotices).values({ submissionId, kind, sentAt: now }).onConflictDoNothing().run().changes > 0;
const release = (submissionId: string, kind: string): void => {
  db.delete(testerNotices).where(and(eq(testerNotices.submissionId, submissionId), eq(testerNotices.kind, kind))).run();
};

/** One answer as its tester may be told about it. Reads only what the test's page shows that tester. */
function factsOf(s: Submission, campaign: Campaign, ctx: { held: Map<string, string>; lastHold: Map<string, { text: string | null; at: number }> }): AnswerFacts {
  const productUrl = productUrlForCampaign(campaign.id);
  const mission = s.missionIdHash ? getMissionByHash(campaign.id, s.missionIdHash) : null;
  const hold = ctx.lastHold.get(s.id) ?? null;
  const builderSaid = s.rejectReason?.startsWith("The builder said:") ? s.rejectReason.slice(0, 240) : null;
  const rejected = s.status === "rejected" || s.status === "blocked";
  return {
    submissionId: s.id,
    product: (productUrl ? hostOf(productUrl) : null) ?? campaign.title,
    url: testUrl(campaign.id),
    status: s.status,
    rewardBase: mission?.rewardAmount ?? campaign.rewardAmount,
    payoutTx: s.payoutTx,
    origin: siteUrl(),
    // exactly the line the page shows this tester: the builder's own words as written, else the public reason
    reason: rejected ? (builderSaid ?? notPaidReason(s, "public")) : null,
    heldForBuilder: ctx.held.has(s.id),
    canImprove: s.status === "pending" && !!hold?.text && RETRY.test(hold.text) && (s.attempt ?? 1) < OBS_MAX_ATTEMPTS,
    at: s.status === "pending" ? (hold?.at ?? s.createdAt) : (s.decidedAt ?? s.createdAt),
  };
}

export async function notifyTesters(now = nowSeconds(), deps: { send?: Send } = {}): Promise<TesterNoticeSummary> {
  const send = deps.send ?? sendPlain;
  const summary: TesterNoticeSummary = { sent: 0, failed: 0, baselined: 0 };
  const firstRun = !db.select().from(testerNotices).where(and(eq(testerNotices.submissionId, BASELINE.submissionId), eq(testerNotices.kind, BASELINE.kind))).get();

  // everyone who asked, by wallet: the chat to tell and when they asked
  const roster = new Map(db.select().from(workAlerts).all().filter((r) => !r.mutedAt).map((r) => [r.walletKey, r]));
  if (roster.size === 0 && !firstRun) return summary;

  const recent = db
    .select()
    .from(submissions)
    .where(or(gte(submissions.createdAt, now - RECENT_SEC), gte(submissions.decidedAt, now - RECENT_SEC)))
    .all()
    .filter((s) => roster.has(walletKey(s.wallet)));

  const perCampaign = new Map<string, { campaign: Campaign; held: Map<string, string>; lastHold: Map<string, { text: string | null; at: number }> } | null>();
  const ctxOf = (campaignId: string) => {
    if (!perCampaign.has(campaignId)) {
      const campaign = getCampaign(campaignId);
      if (!campaign || campaign.sandbox) perCampaign.set(campaignId, null);
      else {
        const events = listCampaignEvents(campaignId);
        const lastHold = new Map<string, { text: string | null; at: number }>();
        // newest first: the first hold seen for an answer is its latest
        for (const e of events) if (e.kind === "autopay_held" && e.submissionId && !lastHold.has(e.submissionId)) lastHold.set(e.submissionId, { text: decodeDetail(e.detail).text, at: e.createdAt });
        perCampaign.set(campaignId, { campaign, held: heldForBuilder(campaign, undefined, events), lastHold });
      }
    }
    return perCampaign.get(campaignId) ?? null;
  };

  const facts: AnswerFacts[] = [];
  const since = new Map<string, number>();
  const chatOf = new Map<string, string>();
  for (const s of recent) {
    const ctx = ctxOf(s.campaignId);
    const member = roster.get(walletKey(s.wallet));
    if (!ctx || !member) continue;
    // a walletless tester's payout already messages their own chat (founder-notify.ts)
    if (s.status === "paid" && getRecipientWalletByAddress(s.wallet)) continue;
    facts.push(factsOf(s, ctx.campaign, ctx));
    since.set(s.id, member.createdAt);
    chatOf.set(s.id, member.target);
  }

  const already = new Set(db.select().from(testerNotices).all().map((r) => noticeKey({ submissionId: r.submissionId, kind: r.kind as never })));

  if (firstRun) {
    // the past is not news: everything true right now is marked as said, and nobody is messaged
    for (const n of dueTesterNotices(facts, already)) if (claim(n.submissionId, n.kind, now)) summary.baselined += 1;
    claim(BASELINE.submissionId, BASELINE.kind, now);
    return summary;
  }

  for (const n of dueTesterNotices(facts, already, since)) {
    if (summary.sent + summary.failed >= MAX_TESTER_NOTICES_PER_TICK) break;
    const chat = chatOf.get(n.submissionId);
    // written before it is sent: a crash can lose a message, never repeat one
    if (!chat || !claim(n.submissionId, n.kind, now)) continue;
    const ok = await send(chat, n.text).catch(() => false);
    if (ok) summary.sent += 1;
    else {
      release(n.submissionId, n.kind);
      summary.failed += 1;
    }
  }
  return summary;
}
