import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { alertTokens, builderChannels, builderNotices, type BuilderChannelRow } from "@/lib/db/schema";
import { founderStorageKey } from "@/lib/auth/founder";

/**
 * WHERE A BUILDER HEARS ABOUT THEIR TESTS (27 Nov 2026).
 *
 * A builder who paid for a test on the web heard nothing afterwards: only tests launched from Telegram
 * messaged their founder. A signed-in builder now opens a single-use link in Telegram, and that chat is
 * where Sage tells them about a first answer, an answer waiting for them, the findings and the end.
 *
 * The link is the roster's own kind of token (`alert_tokens`, 15 minutes, used once) with a `bu_` prefix,
 * so the two can never be redeemed as each other. It is minted only for a signed-in session, so the chat
 * that opens it is bound to the person who was signed in. Opt-in, and one tap to stop.
 */
export const UPDATES_TOKEN_PREFIX = "bu_";
const TOKEN_TTL = 15 * 60;

export type UpdatesState = "connected" | "muted" | "off";

export function mintUpdatesToken(founder: string, now = Math.floor(Date.now() / 1000)): string {
  const token = `${UPDATES_TOKEN_PREFIX}${randomBytes(12).toString("base64url")}`;
  db.insert(alertTokens).values({ token, wallet: founderStorageKey(founder), expiresAt: now + TOKEN_TTL, usedAt: null, createdAt: now }).run();
  return token;
}

export function redeemUpdatesToken(token: string, chatId: string, now = Math.floor(Date.now() / 1000)): { ok: true; founderKey: string } | { ok: false; reason: string } {
  if (!token.startsWith(UPDATES_TOKEN_PREFIX)) return { ok: false, reason: "That link isn't valid." };
  const row = db.select().from(alertTokens).where(eq(alertTokens.token, token)).get();
  if (!row) return { ok: false, reason: "That link isn't valid." };
  if (row.usedAt) return { ok: false, reason: "That link was already used. Open a fresh one from any of your tests on Sage." };
  if (row.expiresAt < now) return { ok: false, reason: "That link expired. Open a fresh one from any of your tests on Sage." };
  db.update(alertTokens).set({ usedAt: now }).where(eq(alertTokens.token, token)).run();
  const founderKey = founderStorageKey(row.wallet);
  bindChannel(founderKey, chatId, now);
  return { ok: true, founderKey };
}

export function bindChannel(founder: string, chatId: string, now = Math.floor(Date.now() / 1000)): BuilderChannelRow {
  const founderKey = founderStorageKey(founder);
  db.insert(builderChannels)
    .values({ founderKey, channel: "telegram", target: chatId, mutedAt: null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: builderChannels.founderKey, set: { target: chatId, mutedAt: null, updatedAt: now } })
    .run();
  return db.select().from(builderChannels).where(eq(builderChannels.founderKey, founderKey)).get() as BuilderChannelRow;
}

export function channelOf(founder: string): BuilderChannelRow | null {
  return db.select().from(builderChannels).where(eq(builderChannels.founderKey, founderStorageKey(founder))).get() ?? null;
}

/** Stopping keeps the row, so starting again is one link and not a new identity. Returns whether a row was there. */
export function muteChannel(founder: string, now = Math.floor(Date.now() / 1000)): boolean {
  const row = channelOf(founder);
  if (!row) return false;
  db.update(builderChannels).set({ mutedAt: now, updatedAt: now }).where(eq(builderChannels.founderKey, row.founderKey)).run();
  return true;
}

export function builderUpdatesState(founder: string): UpdatesState {
  const row = channelOf(founder);
  return !row ? "off" : row.mutedAt ? "muted" : "connected";
}

/* ───────────────────────────────────────── one message per notice ───── */

export function noticesSent(campaignId: string): Set<string> {
  return new Set(db.select().from(builderNotices).where(eq(builderNotices.campaignId, campaignId)).all().map((r) => r.kind));
}

/**
 * Take a notice: true for the one caller that may send it. The (campaign, kind) primary key is the lock, and
 * it is written BEFORE the message is sent, so a crash can lose a message but can never send one twice.
 */
export function claimNotice(campaignId: string, kind: string, now = Math.floor(Date.now() / 1000)): boolean {
  return db.insert(builderNotices).values({ campaignId, kind, sentAt: now }).onConflictDoNothing().run().changes > 0;
}

/** Give a notice back when Telegram did not take the message, so the next sweep tries once more. */
export function releaseNotice(campaignId: string, kind: string): void {
  db.delete(builderNotices).where(and(eq(builderNotices.campaignId, campaignId), eq(builderNotices.kind, kind))).run();
}
