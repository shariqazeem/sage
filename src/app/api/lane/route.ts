import { NextResponse } from "next/server";
import { workspaceContext } from "@/lib/workspaces/context";
import { listWorkspaceCampaigns } from "@/lib/db/workspaces";
import { listCampaigns } from "@/lib/db/campaigns";
import { sameFounder } from "@/lib/auth/founder";
import { laneFor, tapeFor } from "@/lib/lane/lane";
import type { Campaign } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the founder's settling lane across everything they own, and the tape it feeds. */
export async function GET() {
  const ctx = await workspaceContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  // everything the founder runs: the workspace's campaigns AND the ones posted before workspaces existed
  const byId = new Map<string, Campaign>();
  for (const c of ctx.owned ? listWorkspaceCampaigns(ctx.owned) : []) byId.set(c.id, c);
  for (const c of listCampaigns()) if (sameFounder(c.posterWallet, ctx.address)) byId.set(c.id, c);
  const mine = [...byId.values()].filter((c) => !c.sandbox);
  return NextResponse.json({ now: Math.floor(Date.now() / 1000), lane: laneFor(mine), tape: tapeFor(mine) });
}
