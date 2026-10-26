import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RETIRED (26 Oct 2026). This created an "approval" job from the legacy console's form, on the
 * default chain: Metis Sepolia, a test network that is gone from every surface. Every job is posted
 * at /launch now and runs on Metis, so this answers in words instead of opening a job nobody can fund.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Jobs are posted at /launch now, and they run on Metis. This older way to create one used a retired test network and is closed." },
    { status: 410 },
  );
}
