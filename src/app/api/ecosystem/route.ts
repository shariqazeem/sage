import { NextResponse } from "next/server";

import { ecosystemStatus } from "@/lib/ecosystem/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ecosystem — the canonical, honest ecosystem-status model for judges + docs.
 * Every "live/verified/paid" is backed by real evidence (on-chain ownerOf, a settled x402
 * tx, the flagship campaign's network), never env-presence alone. Cached 60s.
 */
export async function GET(): Promise<NextResponse> {
  const status = await ecosystemStatus();
  return NextResponse.json(
    { ok: true, ...status },
    { headers: { "cache-control": "public, max-age=60, s-maxage=60" } },
  );
}
