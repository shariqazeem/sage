import { NextResponse, type NextRequest } from "next/server";

import { e2eEnabled, seedApprovedPlan, seedV2TesterCampaign } from "@/lib/launch/testkit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/testkit/seed — E2E ONLY. `?kind=tester` seeds a live V2 tester campaign (for
 * the tester board E2E); otherwise a deployment-ready approved plan (founder E2E). Returns
 * 404 in any normal run (SAGE_E2E must be "1"). Never part of a production surface.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!e2eEnabled()) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const kind = req.nextUrl.searchParams.get("kind");
    const seeded = kind === "tester" ? seedV2TesterCampaign() : seedApprovedPlan();
    return NextResponse.json({ ok: true, ...seeded });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "seed failed" }, { status: 500 });
  }
}
