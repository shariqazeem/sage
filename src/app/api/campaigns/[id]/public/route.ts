import { NextResponse } from "next/server";
import { getCampaign, listCampaignEvents, listSubmissions } from "@/lib/db/campaigns";
import { summarizeSettled } from "@/lib/telegram/format";
import { loadCampaignActivity } from "@/lib/campaigns/load-activity";
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

  // The live spectator feed: recent settled payouts (paid recipients + their txs
  // are already public on-chain) newest-first, and an AGGREGATE count of entries
  // being verified right now. Individual pending wallets/briefs stay private
  // (own-scope via /me) — a spectator sees the payouts, not other people's work.
  const subs = listSubmissions(c.id);
  const feed = subs
    .filter((s) => s.status === "paid")
    .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))
    .flatMap((s) =>
      s.payoutTx
        ? [{ wallet: s.wallet, payoutTx: s.payoutTx, at: s.decidedAt ?? s.createdAt }]
        : [],
    )
    .slice(0, 12);
  const verifying = subs.filter(
    (s) => s.status === "pending" || s.status === "settling",
  ).length;

  // Sage activity — a safe projection of the real work journal (see activity.ts). It
  // never exposes evidence/notes/reason text; held/blocked carry a coarse class only.
  // The honest heartbeat (lastCheckedAt) is the last moment Sage actually recorded work.
  const { activity, lastCheckedAt } = loadCampaignActivity(c.id);

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
      verifying,
      feed,
      activity,
      lastCheckedAt,
      url: `${siteUrl()}/c/${c.id}`,
    },
    {
      // short cache so the 5s spectator poll stays fresh, still CDN-cacheable.
      headers: {
        "Cache-Control": "public, max-age=5, s-maxage=5, stale-while-revalidate=30",
      },
    },
  );
}
