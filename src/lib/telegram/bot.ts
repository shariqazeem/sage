import "server-only";

import type { Campaign } from "@/lib/db/schema";
import type { SettleOutcome } from "@/lib/campaigns/settle";
import { getCampaign, listCampaignEvents } from "@/lib/db/campaigns";
import { getAgentIdentity } from "@/lib/erc8004/identity";
import { getAgentReputation } from "@/lib/erc8004/reputation";
import { agentPageUrl } from "@/lib/site";
import { chainConfig } from "@/lib/deputy/networks";
import {
  agentSummaryText,
  announceBlockedText,
  announceSettledText,
  helpText,
  NOT_FOUND,
  startText,
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
export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = botToken();
  if (!token || !chatId) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
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
      if (!cmd.payload) return helpText();
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
