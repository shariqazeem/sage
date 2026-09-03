import { NextResponse, type NextRequest } from "next/server";
import { getCampaign } from "@/lib/db/campaigns";
import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { laneFor, tapeFor } from "@/lib/lane/lane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — one campaign's lane. Owner only: the lane names wallets and reasons before they are final. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  const founder = await getFounderAddress();
  if (!founder || !sameFounder(founder, campaign.posterWallet)) return NextResponse.json({ error: "owner only" }, { status: 403 });
  return NextResponse.json({ now: Math.floor(Date.now() / 1000), lane: laneFor([campaign]), tape: tapeFor([campaign]) });
}
