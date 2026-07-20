import "server-only";

import { getAddress } from "viem";
import type { Campaign, Submission } from "@/lib/db/schema";
import type { SettleOutcome } from "@/lib/campaigns/settle";
import { getAgentWalletByAddress } from "@/lib/db/agent-wallets";
import { getMissionByHash } from "@/lib/db/campaigns";
import { buildHeldTriage, triageLines, leanLabel } from "@/lib/campaigns/held-triage";
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

/** A tester's own note, made safe for a DIRECT (non-LLM) founder DM: one line, capped, clearly framed as
 *  their unverified words. A human reads this — a prompt-injection in it is inert (only an LLM obeys), and
 *  this text never reaches the concierge model. Empty → null (a blank note is honest for observation work). */
function testerWordsLine(note: string | null): string | null {
  const t = (note ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return `Their own words (unverified): "${t.length > 240 ? t.slice(0, 240) + "…" : t}"`;
}

/**
 * P22 — the held-review DM now arrives PRE-ANALYZED (anti-rubber-stamp): the tester's claim and Sage's
 * own match analysis come FIRST, the advisory lean LAST and framed as the founder's decision. The lean is
 * deterministic (computed from match counts, never from a model reading the note), so a manipulated note
 * cannot sway it. Points at the chat review flow — the console is owner-gated to the Privy wallet they
 * can't sign as. Fires only on FINAL holds (P20.4).
 */
export async function notifyFounderHeld(campaign: Campaign, submission: Submission): Promise<void> {
  const chatId = founderChatId(campaign);
  if (!chatId) return;
  const t = buildHeldTriage(campaign, submission);
  const words = testerWordsLine(submission.note);
  const lines = [
    `Held for your review — "${t.missionTitle}"${t.attempt > 1 ? ` (after ${t.attempt} attempts)` : ""}.`,
    ...(words ? ["", words] : []),
    "",
    ...triageLines(t),
    "",
    leanLabel(t),
    "",
    `Reply "show held submissions" to release or reject it — I'll always read the reward + recipient back before paying.`,
    `Board: ${appUrl()}/c/${campaign.id}`,
  ];
  await dmWithRetry(chatId, lines.join("\n"));
}
