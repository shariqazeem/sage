import "server-only";
import type { Campaign } from "@/lib/db/schema";
import { founderStorageKey } from "@/lib/auth/founder";
import { decodeDetail } from "@/lib/campaigns/journal";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { hasMissionPlan } from "@/lib/campaigns/vault-kind";
import { isPublicWork } from "@/lib/campaigns/visibility";
import { getAgentWalletByAddress } from "@/lib/db/agent-wallets";
import { listCampaignEvents, listCampaigns, listSubmissions } from "@/lib/db/campaigns";
import { productUrlForCampaign } from "@/lib/db/inspection";
import { nowSeconds } from "@/lib/db/keys";
import { storedFindings } from "@/lib/report";
import { testUrl } from "@/lib/site/test-url";
import { hostOf } from "@/lib/site/when";
import { sendTelegram } from "@/lib/telegram/bot";
import { founderChatId } from "@/lib/telegram/founder-notify";
import { heldForBuilder } from "@/lib/test-page/tracking";
import { baselineKinds, dueNotices, type NoticeFacts } from "./due";
import { builderEmailOf, sendEmail, stopUrlFor, type SendEmail } from "./email";
import { dueByEmail, emailConfigured, emailFor, emailKind } from "./email-core";
import { channelOf, claimNotice, noticesSent, releaseNotice } from "./store";

/**
 * TELL THE BUILDER (27 Nov 2026). The sweep's step for builders who asked to hear about their tests on
 * Telegram: a first answer, an answer waiting for them, the findings, the end, a quiet first day.
 *
 * The same notices go by email to a builder who turned email on, when email is set up (`email-core.ts`).
 *
 * Opt-in (a builder bound their own chat, or switched email on), once per notice and channel (`builder_notices`), never about a test whose
 * founder the Telegram-launch path already messages, and never more than a few messages a tick. Best
 * effort: it reads rows and sends text. It cannot touch a payout, and a failure here stops nothing.
 */
export const RECENT_SEC = 7 * 24 * 3600;
export const MAX_NOTICES_PER_TICK = 6;
export const MAX_NOTICES_PER_TEST_PER_TICK = 2;

const IN_FLIGHT = new Set(["pending", "approved", "settling"]);

export type Send = (chatId: string, text: string) => Promise<boolean>;
const sendPlain: Send = (chatId, text) => sendTelegram(chatId, text, { html: false });

/** The person a test belongs to: the account's founder when Sage holds the wallet that launched it. */
export function builderOf(campaign: Campaign): string {
  const agent = getAgentWalletByAddress(founderStorageKey(campaign.posterWallet));
  return founderStorageKey(agent?.founderAddress ?? campaign.posterWallet);
}

const isTest = (c: Campaign): boolean => !c.sandbox && c.kind === "testing" && c.status !== "draft" && hasMissionPlan(c.vaultKind);

export function noticeFacts(campaign: Campaign, now: number): NoticeFacts & { lastAt: number } {
  const subs = listSubmissions(campaign.id);
  const events = listCampaignEvents(campaign.id);
  const e = v2Economics(campaign);
  const held = heldForBuilder(campaign, subs, events);
  const findings = storedFindings(campaign.id);
  const announced = events.find((x) => x.kind === "work_announced");
  const told = /Told (\d+) of \d+/.exec(decodeDetail(announced?.detail ?? null).text ?? "");
  const url = productUrlForCampaign(campaign.id);
  return {
    product: (url ? hostOf(url) : null) ?? campaign.title,
    url: testUrl(campaign.id),
    status: campaign.status,
    openedAt: campaign.createdAt,
    now,
    answers: subs.length,
    inFlight: subs.filter((s) => IN_FLIGHT.has(s.status) && !held.has(s.id)).length,
    held: [...held].map(([submissionId, why]) => ({ submissionId, why })),
    findingGroups: findings?.json?.findings?.length ?? 0,
    findingAnswers: findings?.paidAnswers ?? 0,
    paidPeople: new Set(subs.filter((s) => s.status === "paid").map((s) => s.wallet.toLowerCase())).size,
    places: e.totalCompletions,
    full: e.totalCompletions > 0 && e.paidCompletions >= e.totalCompletions,
    publicWork: isPublicWork(campaign),
    told: told ? Number(told[1]) : null,
    lastAt: Math.max(campaign.createdAt, findings?.builtAt ?? 0, ...subs.map((s) => s.decidedAt ?? s.createdAt)),
  };
}

/** Live, or ended with something happening in the last week: the tests a builder may still hear about. */
function inScope(campaign: Campaign, lastAt: number, now: number): boolean {
  return campaign.status === "live" || now - lastAt <= RECENT_SEC;
}

/**
 * What is already true when a builder connects is not news. Called once when a channel is turned on (the
 * chat is bound, or email is switched on): every notice due on their tests right now, except an answer still
 * waiting for them, is marked said on THAT channel.
 */
export function settleBaseline(founder: string, now = nowSeconds(), channel: "telegram" | "email" = "telegram"): number {
  const key = founderStorageKey(founder);
  let marked = 0;
  for (const c of listCampaigns()) {
    if (!isTest(c) || builderOf(c) !== key) continue;
    const sent = noticesSent(c.id);
    const due = channel === "email" ? dueByEmail(dueNotices(noticeFacts(c, now)), sent) : dueNotices(noticeFacts(c, now), sent);
    for (const kind of baselineKinds(due)) if (claimNotice(c.id, channel === "email" ? emailKind(kind) : kind, now)) marked += 1;
  }
  return marked;
}

export interface BuilderNoticeSummary {
  tests: number;
  sent: number;
  failed: number;
}

export async function notifyBuilders(now = nowSeconds(), deps: { send?: Send; email?: SendEmail } = {}): Promise<BuilderNoticeSummary> {
  const send = deps.send ?? sendPlain;
  const mail = deps.email ?? sendEmail;
  const mailOn = emailConfigured();
  const summary: BuilderNoticeSummary = { tests: 0, sent: 0, failed: 0 };
  const full = () => summary.sent + summary.failed >= MAX_NOTICES_PER_TICK;
  for (const c of listCampaigns()) {
    if (full()) break;
    if (!isTest(c)) continue;
    const builder = builderOf(c);
    const chat = channelOf(builder);
    const telegram = chat && !chat.mutedAt ? chat : null;
    const address = mailOn ? builderEmailOf(builder) : null;
    const stop = address && !address.mutedAt ? stopUrlFor(address.founderKey) : null;
    // email goes out only with a working stop link in it
    const email = address && !address.mutedAt && stop ? { to: address.email, stop } : null;
    if (!telegram && !email) continue;
    // a test launched from Telegram already messages its founder in that chat (founder-notify.ts)
    if (founderChatId(c)) continue;
    const facts = noticeFacts(c, now);
    if (!inScope(c, facts.lastAt, now)) continue;
    const sent = noticesSent(c.id);
    const everything = dueNotices(facts);
    const byChat = telegram ? everything.filter((n) => !sent.has(n.kind)).slice(0, MAX_NOTICES_PER_TEST_PER_TICK) : [];
    const byMail = email ? dueByEmail(everything, sent).slice(0, MAX_NOTICES_PER_TEST_PER_TICK) : [];
    if (byChat.length === 0 && byMail.length === 0) continue;
    summary.tests += 1;
    const deliver = async (kind: string, go: () => Promise<boolean>) => {
      if (full()) return;
      // written before it is sent: a crash can lose a message, never repeat one
      if (!claimNotice(c.id, kind, now)) return;
      const ok = await go().catch(() => false);
      if (ok) summary.sent += 1;
      else {
        releaseNotice(c.id, kind);
        summary.failed += 1;
      }
    };
    for (const n of byChat) await deliver(n.kind, () => send(telegram!.target, n.text));
    for (const n of byMail) await deliver(emailKind(n.kind), () => mail(email!.to, emailFor(n.text, email!.stop)));
  }
  return summary;
}
