import { NextResponse } from "next/server";

import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { getCampaign, resolveStoppedCampaignSubmissions,
  setCampaignStatus } from "@/lib/db/campaigns";

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

  const session = await getFounderAddress();
  if (!sameFounder(session, campaign.posterWallet)) {
    return NextResponse.json({ ok: false, error: "Not your campaign." }, { status: 403 });
  }

  setCampaignStatus(id, "cancelled");
  // Work still awaiting judgment can never be paid once the vault is revoked — resolve it with an
  // honest reason rather than leaving those testers reading "verifying" forever.
  const resolved = resolveStoppedCampaignSubmissions(id);
  return NextResponse.json({ ok: true, status: "cancelled", resolvedSubmissions: resolved });
}
