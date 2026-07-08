import { NextResponse } from "next/server";
import { getCampaign, listCampaignEvents } from "@/lib/db/campaigns";
import { summarizeSettled } from "@/lib/telegram/format";
import { chainLabel } from "@/lib/deputy/networks";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/campaigns/[id]/public — the session-free slice of a campaign: exactly
 * what `/c/[slug]` and the Telegram `/status` command already show publicly
 * (title, reward, paid-of-max, settled total, network, link). Drafts are hidden;
 * nothing session-gated (submitter wallets, decision briefs, vault internals) is
 * exposed. This is the honest client surface for external readers — e.g. a
 * ClawUp skill answering "what has this campaign actually paid?" Cached 30s.
 *
 * The poster-gated `/api/campaigns/[id]` (full detail + submissions) is separate.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const c = getCampaign(id);
  if (!c || c.status === "draft") {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const { paidCount, settledBase } = summarizeSettled(listCampaignEvents(c.id));

  return NextResponse.json(
    {
      id: c.id,
      title: c.title,
      status: c.status,
      network: chainLabel(c.chainId),
      chainId: c.chainId,
      rewardUsd: c.rewardAmount / 1_000_000,
      maxRecipients: c.maxRecipients,
      paid: paidCount,
      settledUsd: settledBase / 1_000_000,
      url: `${siteUrl()}/c/${c.id}`,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}
