import { NextResponse, type NextRequest } from "next/server";
import { getCampaign } from "@/lib/db/campaigns";
import { walletGraphFor } from "@/lib/graph/wallet-graph";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the campaign's wallet graph. Public: every edge is an on-chain fact or a recorded link; cached ten minutes. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rl = rateLimit("submit", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign || campaign.sandbox) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await walletGraphFor(campaign));
}
