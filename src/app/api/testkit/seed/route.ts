import { NextResponse } from "next/server";

import { e2eEnabled, seedApprovedPlan } from "@/lib/launch/testkit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/testkit/seed — E2E ONLY. Seeds a real approved, deployment-ready plan so the
 * injected-wallet browser test can drive the actual deployment flow. Returns 404 in any
 * normal run (SAGE_E2E must be "1"). Never part of a production surface.
 */
export async function POST(): Promise<NextResponse> {
  if (!e2eEnabled()) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const seeded = seedApprovedPlan();
    return NextResponse.json({ ok: true, ...seeded });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "seed failed" }, { status: 500 });
  }
}
