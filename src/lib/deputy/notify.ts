import "server-only";

import { sendTelegram } from "@/lib/telegram/bot";

/**
 * Optional Telegram op-notification for autonomous Deputy actions, sent to the
 * single operator chat (TELEGRAM_CHAT_ID). Env-gated and never throws (see
 * sendTelegram) — a failed notification must never affect a payout, so it adds
 * nothing to the keyless path.
 *
 * This is the PRIVATE operator channel. The PUBLIC, per-campaign announces a
 * poster opts into live in src/lib/telegram/bot (announceCampaign*).
 */
export async function notifyTelegram(text: string): Promise<void> {
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!chatId) return;
  await sendTelegram(chatId, text);
}
