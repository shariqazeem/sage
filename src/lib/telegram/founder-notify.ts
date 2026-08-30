import "server-only";

import type { Campaign, Submission } from "@/lib/db/schema";
import type { SettleOutcome } from "@/lib/campaigns/settle";
import { founderStorageKey } from "@/lib/auth/founder";
import { getAgentWalletByAddress } from "@/lib/db/agent-wallets";
import { getRecipientWalletByAddress } from "@/lib/db/recipient-wallets";
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
/**
 * The Telegram chat bound to whoever launched this campaign, or null if none is.
 *
 * `getAddress` used to wrap the lookup, and it throws on a Starknet felt — swallowed by the catch,
 * so a founder who launched from a Starknet wallet was simply unfindable, silently. That is the
 * same shape as the three identity lockouts: viem refusing a felt inside an existing try/catch,
 * with nothing in a log to say why.
 *
 * It bought nothing either way. The query already matches on `lower(...)`, so checksum casing was
 * never load-bearing — only the throw was. `founderStorageKey` is the form these addresses are
 * WRITTEN in, so EVM rows keep matching byte-for-byte and a felt normalises the way it was stored.
 *
 * NOTE what this is not: today no Starknet campaign has a Telegram-bound founder, because the
 * walletless path launches on GOAT. This makes the lookup correct for when one does, rather than
 * fixing a founder who is currently missing messages.
 */
function founderChatId(campaign: Campaign): string | null {
  return getAgentWalletByAddress(founderStorageKey(campaign.posterWallet))?.chatId ?? null;
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

/**
 * QUIET-CAMPAIGN NUDGE (FC Phase 3) — the agent noticing, once, that a funded campaign has had
 * zero submissions and saying so with the two actions it can take from chat. Returns whether a
 * push was actually sent (false for campaigns not launched from chat), so the caller records the
 * once-ever event only when someone was really told.
 */
export async function notifyFounderQuietCampaign(campaign: Campaign, nowSec: number): Promise<boolean> {
  const chatId = founderChatId(campaign);
  if (!chatId) return false;
  const days = Math.max(2, Math.round((nowSec - (campaign.createdAt ?? nowSec)) / 86_400));
  const lines = [
    `🪁 Quiet campaign`,
    campaign.title,
    `Live ${days} days, no submissions yet — the budget is just waiting on reach.`,
    `Board: ${appUrl()}/c/${campaign.id}`,
    ``,
    `Say "invite a recipient" and I'll mint a personal link for someone specific — or share the board link where your people are. Say "stop the campaign" to wind it down and reclaim the balance.`,
  ];
  await dmWithRetry(chatId, lines.join("\n"));
  return true;
}

/**
 * WALLETLESS RECIPIENT paid-push (move 2): when a settlement lands in a chat-bound recipient
 * wallet, tell the person in their own chat — the receipt, the amount, where the money sits.
 * Best-effort and swallowed: a notification must never delay or affect a settlement.
 */
export async function notifyRecipientPaid(
  campaign: Campaign,
  submission: Submission,
  outcome: { recipient: string; amountBase: number; txHash: string },
): Promise<void> {
  try {
    const rw = getRecipientWalletByAddress(outcome.recipient || submission.wallet);
    if (!rw) return;
    const mission = submission.missionIdHash ? getMissionByHash(campaign.id, submission.missionIdHash) : null;
    await sendTelegram(
      rw.chatId,
      `💸 You just got paid $${(outcome.amountBase / 1_000_000).toFixed(2)} USDC for "${mission?.title ?? campaign.title}".\n` +
        `Receipt: ${appUrl()}/proof/${outcome.txHash}\n` +
        `Your verified work record just grew: ${appUrl()}/record/${rw.address}\n` +
        `It's in your Sage wallet — ask me "what's my balance?" anytime.`,
      { html: false },
    );
  } catch (err) {
    console.error("[recipient-notify] failed:", err instanceof Error ? err.message : err);
  }
}
