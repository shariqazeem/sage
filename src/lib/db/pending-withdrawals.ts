import "server-only";

import { and, eq, gte } from "drizzle-orm";
import { db } from "./index";
import { nowSeconds } from "./keys";
import { pendingWithdrawals } from "./schema";

/**
 * Durable pending-withdrawal store — the DB-backed replacement for the old in-memory Map, so a
 * pm2 restart between `sage_request_withdrawal` and `sage_confirm_withdrawal` no longer silently
 * drops the request. One pending per chat; a fresh request replaces the previous one.
 */

const DEFAULT_TTL_SECONDS = 5 * 60;

/** Store (or replace) the pending withdrawal for a chat. Amount is pinned server-side. */
export function putPendingWithdrawal(input: {
  chatId: string;
  amountBase: bigint;
  toAddress: string;
  ttlSeconds?: number;
}): void {
  const now = nowSeconds();
  const expiresAt = now + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const amount = input.amountBase.toString();
  db.insert(pendingWithdrawals)
    .values({ chatId: input.chatId, amountBase: amount, toAddress: input.toAddress, expiresAt, consumed: false, createdAt: now })
    .onConflictDoUpdate({
      target: pendingWithdrawals.chatId,
      set: { amountBase: amount, toAddress: input.toAddress, expiresAt, consumed: false, createdAt: now },
    })
    .run();
}

/**
 * Atomically consume the pending withdrawal for a chat: returns it EXACTLY ONCE, only when it is
 * not expired and not already consumed, marking it consumed in the SAME statement. A retry (or a
 * concurrent confirm) returns null — so a withdrawal can never be double-sent, even across restarts.
 */
export function consumePendingWithdrawal(chatId: string): { toAddress: string; amountBase: bigint } | null {
  const now = nowSeconds();
  const row = db
    .update(pendingWithdrawals)
    .set({ consumed: true })
    .where(
      and(
        eq(pendingWithdrawals.chatId, chatId),
        eq(pendingWithdrawals.consumed, false),
        gte(pendingWithdrawals.expiresAt, now),
      ),
    )
    .returning()
    .get();
  return row ? { toAddress: row.toAddress, amountBase: BigInt(row.amountBase) } : null;
}
