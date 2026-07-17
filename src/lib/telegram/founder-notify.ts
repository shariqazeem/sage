import "server-only";

import { getAddress } from "viem";
import type { Campaign, Submission } from "@/lib/db/schema";
import type { SettleOutcome } from "@/lib/campaigns/settle";
import { getAgentWalletByAddress } from "@/lib/db/agent-wallets";
import { getMissionByHash } from "@/lib/db/campaigns";
import { reward, short } from "@/lib/format";
import { sendTelegram } from "./bot";

/**
 * DM the FOUNDER when Sage pays or holds a tester on a campaign they launched from Telegram.
 * A chat-launched campaign's vault owner IS the founder's Privy agent wallet, so we resolve the
 * chat by that address. Everything here is best-effort: fire-and-forget from the settle/decide
 * path, one retry, and it never throws — a notification must never delay or affect a settlement.
 */

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://sagepays.xyz";
}

/** The Telegram chat that launched this campaign, or null when it wasn't launched from chat. */
function founderChatId(campaign: Campaign): string | null {
  try {
    return getAgentWalletByAddress(getAddress(campaign.posterWallet))?.chatId ?? null;
  } catch {
    return null;
  }
}

/** Send once, retry once on failure. Never throws. */
async function dmWithRetry(chatId: string, text: string): Promise<void> {
  const ok = await sendTelegram(chatId, text, { html: false }).catch(() => false);
  if (!ok) await sendTelegram(chatId, text, { html: false }).catch(() => {});
}

/** "Paid $X.XX to 0x…cd for '<mission>' — proof: <url>" (network-truthful amount). */
export async function notifyFounderSettled(
  campaign: Campaign,
  submission: Submission,
  outcome: SettleOutcome,
): Promise<void> {
  const chatId = founderChatId(campaign);
  if (!chatId || !outcome.txHash) return;
  const mission = submission.missionIdHash ? getMissionByHash(campaign.id, submission.missionIdHash) : null;
  const title = mission?.title ?? campaign.title;
  const amount = reward(Number(outcome.amountBase), campaign.chainId);
  await dmWithRetry(
    chatId,
    `Paid ${amount} to ${short(outcome.recipient)} for "${title}" — proof: ${appUrl()}/proof/${outcome.txHash}`,
  );
}

/** Held-review DM for a chat-launched campaign: point the founder at the chat review flow (the
 *  console is owner-gated to the Privy wallet they can't sign as), never at a raw reason string. */
export async function notifyFounderHeld(campaign: Campaign, submission: Submission): Promise<void> {
  const chatId = founderChatId(campaign);
  if (!chatId) return;
  const mission = submission.missionIdHash ? getMissionByHash(campaign.id, submission.missionIdHash) : null;
  const title = mission?.title ?? campaign.title;
  await dmWithRetry(
    chatId,
    `Held for review — "${title}". I wasn't confident enough to auto-pay this one.\n` +
      `Reply "show held submissions" and I'll list it so you can release or reject it.\n` +
      `Board: ${appUrl()}/c/${campaign.id}`,
  );
}
