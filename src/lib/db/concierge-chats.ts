import "server-only";

import { eq } from "drizzle-orm";
import { db } from "./index";
import { nowSeconds } from "./keys";
import { conciergeChats } from "./schema";

/**
 * Durable per-chat memory for the Telegram concierge. Stores the trimmed rolling history as an
 * opaque JSON string (the concierge owns the ChatMessage shape); one row per chat, upserted each
 * turn. Persisting here is what lets a founder's thread survive a server restart.
 */

/** Load a chat's stored history JSON (or "[]" if none). The caller parses it into its own type. */
export function loadChatMessages(chatId: string): string {
  const row = db.select().from(conciergeChats).where(eq(conciergeChats.chatId, chatId)).get();
  return row?.messagesJson ?? "[]";
}

/** Upsert a chat's history JSON (already trimmed by the caller). */
export function saveChatMessages(chatId: string, messagesJson: string): void {
  const now = nowSeconds();
  db.insert(conciergeChats)
    .values({ chatId, messagesJson, updatedAt: now })
    .onConflictDoUpdate({ target: conciergeChats.chatId, set: { messagesJson, updatedAt: now } })
    .run();
}
