import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { alertTokens, workAlerts, type WorkAlert } from "@/lib/db/schema";
import type { RosterMember } from "@/lib/roster/alerts";

/** One person, one row, whatever spelling their wallet arrives in. */
export const walletKey = (w: string) => `0x${w.trim().toLowerCase().replace(/^0x/, "").replace(/^0+/, "") || "0"}`;

const TOKEN_TTL = 15 * 60;

/**
 * A short-lived, single-use link between a wallet and whoever opens it in Telegram. Possession of
 * the link is the only proof that the person in the chat owns that wallet, so it expires quickly and
 * cannot be replayed.
 */
export function mintAlertToken(wallet: string, now = Math.floor(Date.now() / 1000)): string {
  const token = `al_${randomBytes(12).toString("base64url")}`;
  db.insert(alertTokens).values({ token, wallet: wallet.trim(), expiresAt: now + TOKEN_TTL, usedAt: null, createdAt: now }).run();
  return token;
}

export function redeemAlertToken(token: string, chatId: string, now = Math.floor(Date.now() / 1000)): { ok: true; wallet: string } | { ok: false; reason: string } {
  const row = db.select().from(alertTokens).where(eq(alertTokens.token, token)).get();
  if (!row) return { ok: false, reason: "That link isn't valid." };
  if (row.usedAt) return { ok: false, reason: "That link was already used." };
  if (row.expiresAt < now) return { ok: false, reason: "That link expired — open a fresh one from your work record." };
  db.update(alertTokens).set({ usedAt: now }).where(eq(alertTokens.token, token)).run();
  joinRoster(row.wallet, chatId, now);
  return { ok: true, wallet: row.wallet };
}

export function joinRoster(wallet: string, chatId: string, now = Math.floor(Date.now() / 1000)): WorkAlert {
  const key = walletKey(wallet);
  const existing = db.select().from(workAlerts).where(eq(workAlerts.walletKey, key)).get();
  if (existing) {
    db.update(workAlerts).set({ target: chatId, mutedAt: null, updatedAt: now }).where(eq(workAlerts.walletKey, key)).run();
  } else {
    db.insert(workAlerts).values({ walletKey: key, wallet: wallet.trim(), channel: "telegram", target: chatId, mutedAt: null, lastNotifiedAt: null, notifyCount: 0, createdAt: now, updatedAt: now }).run();
  }
  return db.select().from(workAlerts).where(eq(workAlerts.walletKey, key)).get() as WorkAlert;
}

/** Leaving is one message and keeps the row, so coming back is one message too. */
export function muteByChat(chatId: string, now = Math.floor(Date.now() / 1000)): number {
  const rows = db.select().from(workAlerts).where(eq(workAlerts.target, chatId)).all();
  for (const r of rows) db.update(workAlerts).set({ mutedAt: now, updatedAt: now }).where(eq(workAlerts.walletKey, r.walletKey)).run();
  return rows.length;
}

export function rosterFor(wallet: string): WorkAlert | null {
  return db.select().from(workAlerts).where(eq(workAlerts.walletKey, walletKey(wallet))).get() ?? null;
}

/** Everyone currently reachable — muted rows never leave the table but never leave here either. */
export function activeRoster(): RosterMember[] {
  return db.select().from(workAlerts).where(isNull(workAlerts.mutedAt)).all()
    .map((r) => ({ walletKey: r.walletKey, wallet: r.wallet, target: r.target, mutedAt: r.mutedAt, lastNotifiedAt: r.lastNotifiedAt }));
}

export function markNotified(walletKeys: string[], now = Math.floor(Date.now() / 1000)): void {
  for (const k of walletKeys) {
    const row = db.select().from(workAlerts).where(eq(workAlerts.walletKey, k)).get();
    if (!row) continue;
    db.update(workAlerts).set({ lastNotifiedAt: now, notifyCount: row.notifyCount + 1, updatedAt: now }).where(eq(workAlerts.walletKey, k)).run();
  }
}

export function rosterSize(): { total: number; active: number } {
  const all = db.select().from(workAlerts).all();
  return { total: all.length, active: all.filter((r) => !r.mutedAt).length };
}

/** Housekeeping: spent and expired tokens are noise, and a token table is a credential store. */
export function reapAlertTokens(now = Math.floor(Date.now() / 1000)): number {
  const stale = db.select().from(alertTokens).where(or(eq(alertTokens.expiresAt, 0), isNull(alertTokens.usedAt))).all()
    .filter((t) => t.expiresAt < now - 3600);
  const used = db.select().from(alertTokens).all().filter((t) => t.usedAt !== null && t.usedAt < now - 86_400);
  for (const t of [...stale, ...used]) db.delete(alertTokens).where(and(eq(alertTokens.token, t.token))).run();
  return stale.length + used.length;
}
