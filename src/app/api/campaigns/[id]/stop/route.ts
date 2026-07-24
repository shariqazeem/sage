import { NextResponse } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { getCampaign, setCampaignStatus } from "@/lib/db/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/campaigns/<id>/stop — catalogue a campaign the owner has stopped on-chain.
 * The actual money move (revoke + withdrawRemaining) is signed by the founder's own wallet in the
 * campaign console; this only marks the DB row "cancelled" so it leaves the running list and shows
 * as stopped. Owner-gated (SIWE session must match the campaign's poster wallet). The on-chain vault
 * state remains the source of truth for funds; this is the catalogue label.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign) return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });

  const session = await getSessionAddress();
  if (!session || session.toLowerCase() !== campaign.posterWallet.toLowerCase()) {
    return NextResponse.json({ ok: false, error: "Not your campaign." }, { status: 403 });
  }

  setCampaignStatus(id, "cancelled");
  return NextResponse.json({ ok: true, status: "cancelled" });
}
