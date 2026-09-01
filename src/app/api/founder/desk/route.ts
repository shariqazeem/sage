import { NextResponse } from "next/server";

import { getFounderAddress } from "@/lib/auth/founder";
import { loadFounderDesk } from "@/lib/campaigns/founder-activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE DESK, LIVE. The dashboard's "Sage at work" register was a server snapshot: a founder
 * watching their own home saw a submission judged and paid only if they thought to reload.
 * The campaign console already polls its activity strip (`SageActivity`); this is the same
 * discipline for the cross-campaign desk — the agent's work made observable, which is the
 * product's whole argument. Watch, don't chat.
 *
 * Founder-scoped by construction: `loadFounderDesk` filters by `sameFounder` and builds on
 * the per-campaign safe projection (an aggregation of safe rows is safe). An anonymous
 * caller gets an empty desk and the loader is never consulted.
 */
export async function GET(): Promise<NextResponse> {
  const founder = await getFounderAddress();
  if (!founder) {
    return NextResponse.json({ ok: true, desk: { events: [], lastWorkedAt: null } });
  }
  return NextResponse.json({ ok: true, desk: loadFounderDesk(founder, 8) });
}
