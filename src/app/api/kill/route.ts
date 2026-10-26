import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RETIRED (26 Oct 2026). The legacy console's live demo: anyone, signed in or not, could make the
 * operator send a transaction against a demo vault on Metis Sepolia, a test network that is gone from
 * every surface. An unauthenticated door that spends the operator's gas has no place beside real money,
 * so it answers in words now. The demo's receipts stay on the explorer.
 */
export async function POST() {
  return NextResponse.json({ error: "This demo ran on a retired test network and is closed. Sage runs on Metis now: post work at /launch." }, { status: 410 });
}
