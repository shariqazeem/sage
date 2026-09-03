import { NextResponse } from "next/server";
import { workspaceContext } from "@/lib/workspaces/context";
import { listWorkspaceCampaigns } from "@/lib/db/workspaces";
import { listCampaigns } from "@/lib/db/campaigns";
import { sameFounder } from "@/lib/auth/founder";
import { laneFor, tapeFor } from "@/lib/lane/lane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the founder's settling lane across everything they own, and the tape it feeds. */
export async function GET() {
  const ctx = await workspaceContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const campaigns = ctx.owned ? listWorkspaceCampaigns(ctx.owned) : listCampaigns().filter((c) => sameFounder(c.posterWallet, ctx.address));
  const mine = campaigns.filter((c) => !c.sandbox);
  return NextResponse.json({ now: Math.floor(Date.now() / 1000), lane: laneFor(mine), tape: tapeFor(mine) });
}
