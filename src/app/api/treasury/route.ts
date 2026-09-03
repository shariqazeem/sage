import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress, founderChain } from "@/lib/auth/founder";
import { createWebTreasury } from "@/lib/treasury/web";
import { webTreasuryStatus } from "@/lib/treasury/launch";
import { privyConfigured } from "@/lib/privy/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the founder's treasury, or { linked: false }. */
export async function GET() {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const status = await webTreasuryStatus(founder);
  return NextResponse.json(status ? { linked: true, ...status } : { linked: false, available: privyConfigured() && founderChain(founder) === "evm" });
}

/** POST { perCampaignCapUsd } — create the treasury (once). */
export async function POST(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (founderChain(founder) !== "evm") return NextResponse.json({ error: "The treasury launches on GOAT, so it binds to an Ethereum account — sign in with one (an email account works)." }, { status: 400 });
  if (!privyConfigured()) return NextResponse.json({ error: "Treasuries aren't configured on this deployment." }, { status: 503 });
  let body: { perCampaignCapUsd?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const cap = typeof body.perCampaignCapUsd === "number" && Number.isFinite(body.perCampaignCapUsd) ? body.perCampaignCapUsd : 50;
  try {
    await createWebTreasury(founder, cap);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "Could not create the treasury." }, { status: 500 });
  }
  const status = await webTreasuryStatus(founder);
  return NextResponse.json({ ok: true, ...status });
}
