import { NextResponse } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import { getDeputyOverview } from "@/lib/campaigns/overview";
import { ensureDemoCampaign } from "@/lib/db/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in founder's Deputy overview — their campaigns, live counts, and
 * journal. Lets the app shell refresh its command center after a client-side
 * SIWE sign-in or a campaign action, without a full page reload. Empty overview
 * when not a signed-in poster (the UI shows a designed empty state).
 */
export async function GET() {
  ensureDemoCampaign();
  const wallet = await getSessionAddress();
  return NextResponse.json(getDeputyOverview(wallet));
}
