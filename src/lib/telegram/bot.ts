import "server-only";

import type { Campaign } from "@/lib/db/schema";
import type { SettleOutcome } from "@/lib/campaigns/settle";
import { getCampaign, listCampaignEvents } from "@/lib/db/campaigns";
import { getAgentIdentity } from "@/lib/erc8004/identity";
import { getAgentReputation } from "@/lib/erc8004/reputation";
import { agentPageUrl } from "@/lib/site";
import { chainConfig } from "@/lib/deputy/networks";
import { splitForTelegram } from "./chunk";
import {
  agentSummaryText,
  announceBlockedText,
  announceSettledText,
  helpText,
  NOT_FOUND,
  startText,
  startWelcomeText,
  statusText,
  summarizeSettled,
  USAGE_STATUS,
  type TgCommand,
} from "./format";

/**
 * The server-only half of Sage's Telegram presence: the Bot API send primitive,
 * the inbound command dispatcher, and the outbound per-campaign announces.
 *
 * Everything the bot says is built from data that is ALREADY public — a
 * campaign's own stats page and the agent's grounded reputation card. There is
 * no session, no wallet, no private state reachable here: the webhook can only
 * ever echo public facts. The announces are outbound only and journal nothing —
 * the settled/blocked events they describe are recorded by settle-flow, not here.
 */

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
}

const campaignUrl = (slug: string): string => `${appUrl()}/c/${slug}`;
const proofUrl = (txHash: string): string => `${appUrl()}/proof/${txHash}`;

/**
 * Low-level Bot API send. Env-gated on TELEGRAM_BOT_TOKEN (a silent no-op if
 * unset) and it never throws: a failed send must never affect a payout or a
 * webhook response. Returns whether Telegram accepted the message.
 */
export async function sendTelegram(
  chatId: string,
  text: string,
  opts?: { html?: boolean },
): Promise<boolean> {
  const token = botToken();
  if (!token || !chatId) return false;

  // Command replies + announces are hand-built HTML; the conversational agent's free-form text is
  // sent PLAIN (html:false) so arbitrary model output can never trip Telegram's HTML parser (400).
  const html = opts?.html !== false;
  // Telegram rejects any message over 4096 chars — split long text into ordered chunks (never
  // mid-URL) and send them in sequence so the founder reads them in order.
  const chunks = splitForTelegram(text).filter((c) => c.trim().length > 0);
  if (chunks.length === 0) return false;
  // HTML SAFETY: a chunked HTML message can split an open/close tag pair across chunks — Telegram
  // then 400s that chunk and we'd swallow it (silent loss). A single chunk keeps HTML; a multi-chunk
  // message falls back to PLAIN (safe — only formatting is lost, and command replies are ~always one
  // chunk). Free-form concierge text is already plain, so this only ever affects a long HTML reply.
  const useHtml = html && chunks.length === 1;
  let allOk = true;
  for (const chunk of chunks) {
    allOk = (await sendOneMessage(token, chatId, chunk, useHtml)) && allOk;
  }
  return allOk;
}

/** Send ONE already-bounded message. Never throws; returns whether Telegram accepted it. */
async function sendOneMessage(token: string, chatId: string, text: string, html: boolean): Promise<boolean> {
  const body: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
  if (html) body.parse_mode = "HTML";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error("[telegram] send failed:", err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────────────────────────── inbound dispatch ─────── */

/** A campaign the public can see (drafts stay hidden). */
function publicCampaign(slug: string): Campaign | null {
  const c = getCampaign(slug);
  return c && c.status !== "draft" ? c : null;
}

/**
 * Build the reply for a parsed command, or null when there's nothing to say
 * (a non-command message). Reads only public surfaces; every branch is safe to
 * expose to anyone who can message the bot.
 */
export function buildReply(cmd: TgCommand): string | null {
  switch (cmd.kind) {
    case "status": {
      if (!cmd.slug) return USAGE_STATUS;
      const c = publicCampaign(cmd.slug);
      if (!c) return NOT_FOUND;
      const { paidCount, settledBase } = summarizeSettled(listCampaignEvents(c.id));
      return statusText({
        title: c.title,
        paidCount,
        maxRecipients: c.maxRecipients,
        settledBase,
        chainId: c.chainId,
        url: campaignUrl(c.id),
      });
    }
    case "agent": {
      const id = getAgentIdentity();
      const r = getAgentReputation();
      return agentSummaryText({
        name: id.name ?? "Sage",
        registered: id.registered,
        agentId: id.agentId,
        chainId: id.chainId,
        settledUsd: r.settledTotalBase / 1_000_000,
        payouts: r.payoutCount,
        blocked: r.blockedCount,
        decisions: r.decisionCount,
        avgConfidence: r.avgConfidence,
        url: agentPageUrl(),
      });
    }
    case "start": {
      if (!cmd.payload) return startWelcomeText();
      const c = publicCampaign(cmd.payload);
      return startText({ title: c?.title ?? null, url: campaignUrl(cmd.payload) });
    }
    case "help":
    case "unknown":
      return helpText();
    case "none":
      return null;
  }
}

/* ─────────────────────────────────────────────── outbound announces ──── */

/**
 * Announce a settled payout to a campaign's public chat, if the poster set one.
 * Outbound only — journals nothing (settle-flow already recorded the event).
 * Mainnet payouts include the block-explorer link; testnet shows the proof link.
 */
export async function announceCampaignSettled(
  campaign: Campaign,
  outcome: SettleOutcome,
): Promise<void> {
  const chatId = campaign.announceChatId;
  if (!chatId || !outcome.txHash) return;
  const mainnet = chainConfig(campaign.chainId).isMainnet;
  await sendTelegram(
    chatId,
    announceSettledText({
      title: campaign.title,
      amountBase: outcome.amountBase,
      recipient: outcome.recipient,
      proofUrl: proofUrl(outcome.txHash),
      explorerUrl: mainnet ? outcome.explorerUrl : undefined,
    }),
  );
}

/** Announce a vault-blocked spend to a campaign's public chat, if one is set. */
export async function announceCampaignBlocked(
  campaign: Campaign,
  outcome: SettleOutcome,
): Promise<void> {
  const chatId = campaign.announceChatId;
  if (!chatId) return;
  await sendTelegram(
    chatId,
    announceBlockedText({
      title: campaign.title,
      failedCheckIndex: outcome.failedCheckIndex,
      url: campaignUrl(campaign.id),
    }),
  );
}
