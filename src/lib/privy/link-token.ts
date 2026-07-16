import "server-only";

import { nanoid } from "nanoid";

/**
 * One-time link tokens that bind a Telegram chat to a SIWE sign-in. The agent mints a token for a
 * chat and hands the founder a `sagepays.xyz/link/<token>` URL; the founder opens it, signs in with
 * their real wallet (SIWE), and the server pairs that proven address to the chat. Tokens are
 * single-use, short-lived, and in-process (a persistent pm2 process holds them; a restart just
 * means re-issuing the link — no funds or bindings are at stake here).
 */

interface Pending {
  chatId: string;
  expiresAt: number;
}

const tokens = new Map<string, Pending>();
const TTL_MS = 15 * 60 * 1000; // 15 minutes

function sweep(): void {
  const now = Date.now();
  for (const [k, v] of tokens) if (v.expiresAt < now) tokens.delete(k);
}

/** Mint a fresh single-use link token for a chat. */
export function createLinkToken(chatId: string): string {
  sweep();
  const token = nanoid(24);
  tokens.set(token, { chatId, expiresAt: Date.now() + TTL_MS });
  return token;
}

/** Read (without consuming) the chat a token is for, or null if unknown/expired. */
export function peekLinkToken(token: string): string | null {
  const p = tokens.get(token);
  if (!p || p.expiresAt < Date.now()) return null;
  return p.chatId;
}

/** Consume a token, returning its chat id exactly once. Null if unknown/expired/already used. */
export function consumeLinkToken(token: string): string | null {
  const p = tokens.get(token);
  if (!p) return null;
  tokens.delete(token);
  return p.expiresAt < Date.now() ? null : p.chatId;
}
