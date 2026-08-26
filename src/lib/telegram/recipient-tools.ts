import "server-only";

import { getCampaign, listMissions, listSubmissions } from "@/lib/db/campaigns";
import { getRecipientWallet, listInvitedCampaignIds } from "@/lib/db/recipient-wallets";
import { submitAsRecipient } from "@/lib/campaigns/recipient-submit";
import { runDeputyOnSubmission } from "@/lib/deputy/pipeline";
import { usdcBalanceBase } from "./wallet-status";

/**
 * RECIPIENT tools — the receiving side of the loop, in chat (move 2). Telegram-only, keyed on the
 * CHAT (server-resolved `ref`), never on model-supplied identity. A chat with no recipient binding
 * gets a friendly refusal, so these defs can sit in the toolset unconditionally.
 */

export const RECIPIENT_TOOLS = [
  {
    name: "sage_my_work",
    description:
      "For an invited RECIPIENT chat: list the campaigns this person was invited to, the open work and what each pays, the status of anything they've submitted, and their Sage wallet balance. No arguments — the chat is the identity. If it says this chat isn't a recipient, they probably haven't opened their invite link yet.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sage_submit_work",
    description:
      "Submit an invited RECIPIENT's finished work for verification. Call when a recipient sends a link to what they made, a transaction hash, or says the work is done. Sage verifies it deterministically and pays if it checks out — NEVER say it's paid; say it's being verified (the payment message arrives on its own if it passes).",
    inputSchema: {
      type: "object",
      properties: {
        link: { type: "string", description: "The URL of their work, if they sent one." },
        details: { type: "string", description: "Their own words about what they did — include a transaction hash here if they sent one." },
        campaignId: { type: "string", description: "Only when they're invited to several campaigns and named which one." },
        missionKey: { type: "string", description: "Only when a specific milestone was named." },
      },
    },
  },
] as const;

const RECIPIENT_TOOL_NAMES = new Set<string>(RECIPIENT_TOOLS.map((t) => t.name));
export function isRecipientTool(name: string): boolean {
  return RECIPIENT_TOOL_NAMES.has(name);
}

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }], isError: false });

export async function callRecipientTool(
  name: string,
  args: Record<string, unknown>,
  chatRef: string,
  scheduleAfter: (fn: () => void | Promise<void>) => void,
): Promise<{ content: { type: "text"; text: string }[]; isError: boolean }> {
  const rw = getRecipientWallet(chatRef);

  if (name === "sage_my_work") {
    if (!rw) return json({ ok: false, error: "This chat isn't set up as a recipient — they need to open the invite link the funder sent them." });
    const campaignIds = listInvitedCampaignIds(rw.address);
    const campaigns = campaignIds
      .map((id) => getCampaign(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => {
        const missions = listMissions(c.id).filter((m) => m.status === "active");
        const mine = listSubmissions(c.id).filter((s) => s.wallet === rw.address);
        return {
          campaignId: c.id,
          title: c.title,
          status: c.status,
          work: missions.map((m) => ({ missionKey: m.missionKey, title: m.title, paysUsd: m.rewardAmount / 1_000_000 })),
          mySubmissions: mine.map((s) => ({ status: s.status, ...(s.payoutTx ? { receipt: `/proof/${s.payoutTx}` } : {}) })),
        };
      });
    let balanceUsd: number | null = null;
    try {
      balanceUsd = Number(await usdcBalanceBase(rw.address, 2345)) / 1_000_000;
    } catch {
      /* balance is a nicety — never block the answer on an RPC blip */
    }
    return json({
      ok: true,
      wallet: rw.address,
      balanceUsd,
      recordUrl: `https://sagepays.xyz/record/${rw.address}`,
      invited: campaigns,
    });
  }

  if (name === "sage_submit_work") {
    const r = await submitAsRecipient({
      chatId: chatRef,
      campaignId: typeof args.campaignId === "string" ? args.campaignId : undefined,
      missionKey: typeof args.missionKey === "string" ? args.missionKey : undefined,
      evidenceUrl: typeof args.link === "string" ? args.link : undefined,
      note: typeof args.details === "string" ? args.details : undefined,
    });
    if (!r.ok) return json(r);
    // The ONE decision path — same as the web submit route: judge after the reply flushes.
    const submissionId = r.submissionId;
    scheduleAfter(async () => {
      try {
        await runDeputyOnSubmission(submissionId);
      } catch (err) {
        console.error("[recipient-tools] pipeline failed:", err);
      }
    });
    return json({
      ok: true,
      submissionId: r.submissionId,
      milestone: r.missionTitle,
      paysUsdIfVerified: r.rewardUsd,
      note: "Submitted — Sage is verifying it now. Do NOT say it's paid: if it verifies, the payment lands with a receipt and this chat gets the message automatically.",
    });
  }

  return json({ ok: false, error: `unknown recipient tool: ${name}` });
}
