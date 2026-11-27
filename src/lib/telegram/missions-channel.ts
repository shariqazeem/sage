import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channelPosts, type ChannelPostRow } from "@/lib/db/schema";
import { listLiveCampaigns } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import { sharingFor } from "@/lib/sharing";
import { testUrl } from "@/lib/site/test-url";
import { openPlaces, productName } from "@/lib/x/agent";
import { usd } from "@/lib/x/compose";

/**
 * SAGE'S TELEGRAM CHANNEL OF OPEN TESTS (relaunch, 20 Nov 2026).
 *
 * Many of the people who try products for Sage already live in Telegram. When a builder says yes to
 * "Sage shares it" on the offer card (`campaign_sharing.post_mission`, the same yes Sage's X account
 * reads), the test is posted once to Sage's public channel with one button: Take a place.
 *
 * Opt-in on both sides: the builder chose to share, and a tester chose to follow the channel. Nobody is
 * messaged directly from here (that is the roster's job, and it has its own consent rules).
 *
 * The row is written before the message is sent, and only a row that never reached Telegram is tried
 * again, so a test is posted at most once even across a crash. Never throws: a channel that is down can
 * never cost a payout or stop the sweep.
 */
export const MAX_CHANNEL_POSTS_PER_TICK = 3;

export type ChannelSend = (chatId: string, html: string, button: { text: string; url: string }) => Promise<
  { ok: true; messageId: number | null } | { ok: false; detail: string }
>;

export type ChannelSummary = { posted: number; failed: number; skipped: string | null };

/** The channel's chat id (`@name` or `-100…`), or null when the founder hasn't set one up. */
export function missionsChannel(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.TELEGRAM_MISSIONS_CHAT_ID?.trim() || null;
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The post, in Sage's voice: what to try, how many places, what each pays. Numbers from the vault's plan. */
export function channelText(input: { product: string; places: number; rewardMinBase: number; rewardMaxBase: number }): string {
  const reward =
    input.rewardMinBase === input.rewardMaxBase
      ? `${usd(input.rewardMinBase)} each`
      : `${usd(input.rewardMinBase)}–${usd(input.rewardMaxBase)} each`;
  const places = `${input.places} ${input.places === 1 ? "place" : "places"}`;
  return [
    "<b>New test on Sage</b>",
    "",
    `Try <b>${escapeHtml(input.product)}</b> and tell us where you get stuck.`,
    `${places} · ${reward} · paid in USDC on Metis`,
  ].join("\n");
}

/** The Bot API call, with one URL button. Never throws. */
export const sendToChannel: ChannelSend = async (chatId, html, button) => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, detail: "no bot token" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] },
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
    if (!res.ok || j.ok === false) return { ok: false, detail: (j.description ?? `HTTP ${res.status}`).slice(0, 200) };
    return { ok: true, messageId: typeof j.result?.message_id === "number" ? j.result.message_id : null };
  } catch (e) {
    // a fetch failure names a host or a timeout, never the token (it is only in the path)
    return { ok: false, detail: e instanceof Error && e.name === "AbortError" ? "timed out" : "network error" };
  } finally {
    clearTimeout(timer);
  }
};

function rowFor(subjectKey: string): ChannelPostRow | null {
  return db.select().from(channelPosts).where(eq(channelPosts.subjectKey, subjectKey)).get() ?? null;
}

/**
 * Post every newly shared, open, listed test to the channel, at most three a tick. Tests without the
 * builder's yes, sandboxes, unlisted (members-only) work and full tests are never posted.
 */
export async function postMissionsToChannel(
  nowSec: number = nowSeconds(),
  deps: { chatId?: string | null; send?: ChannelSend } = {},
): Promise<ChannelSummary> {
  const summary: ChannelSummary = { posted: 0, failed: 0, skipped: null };
  const chatId = deps.chatId === undefined ? missionsChannel() : deps.chatId;
  if (!chatId) return { ...summary, skipped: "no channel set up" };
  const send = deps.send ?? sendToChannel;

  let attempts = 0;
  for (const c of listLiveCampaigns()) {
    if (attempts >= MAX_CHANNEL_POSTS_PER_TICK) break;
    if (c.sandbox || c.visibility !== "listed" || c.safetyHold || c.kind !== "testing") continue;
    const subjectKey = `mission:${c.id}`;
    const existing = rowFor(subjectKey);
    // posted is final; a drafted row may have reached Telegram before a crash, so it is never resent
    if (existing && existing.status !== "failed") continue;
    if (!sharingFor(c.id).postMission) continue;
    const open = openPlaces(c);
    if (open.places <= 0) continue;
    const product = productName(c);
    if (!product) continue;

    attempts += 1;
    const html = channelText({ product, places: open.places, rewardMinBase: open.rewardMinBase, rewardMaxBase: open.rewardMaxBase });
    if (existing) {
      db.update(channelPosts).set({ status: "drafted", reason: null, chatId }).where(eq(channelPosts.subjectKey, subjectKey)).run();
    } else {
      db.insert(channelPosts).values({ subjectKey, chatId, status: "drafted", createdAt: nowSec }).run();
    }
    const res = await send(chatId, html, { text: "Take a place", url: testUrl(c.id, "tg") }).catch(
      (e: unknown) => ({ ok: false as const, detail: e instanceof Error ? e.message.slice(0, 200) : "send failed" }),
    );
    if (res.ok) {
      db.update(channelPosts)
        .set({ status: "posted", messageId: res.messageId, postedAt: nowSec, reason: null })
        .where(eq(channelPosts.subjectKey, subjectKey))
        .run();
      summary.posted += 1;
    } else {
      db.update(channelPosts).set({ status: "failed", reason: res.detail }).where(eq(channelPosts.subjectKey, subjectKey)).run();
      summary.failed += 1;
    }
  }
  return summary;
}
