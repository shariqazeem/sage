import { NextResponse, type NextRequest } from "next/server";

import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { claimInspectionJob, getInspectionJob } from "@/lib/db/inspection";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/t/<inspection id>/claim
 *
 * MAKE A TEST NOBODY OWNS MINE, at the money moment. A plan handed over without a sign-in belongs to
 * nobody; the first signed-in person to pay for it takes it, by the same atomic move the plan claim
 * uses (`claimInspectionJob`), which moves a plan only from nobody and never from a wallet.
 *
 * A test a tag on X started is NOT this door's: it has its own (`/api/launch/<id>/claim-x`), which
 * checks the X account the server verified at sign-in. A plan another wallet owns answers 403.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const rl = rateLimit("auth", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const { id } = await ctx.params;
  const job = getInspectionJob(id);
  if (!job) return NextResponse.json({ ok: false, error: "Test not found." }, { status: 404 });
  const session = await getFounderAddress();
  if (!session) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  if (sameFounder(job.founderWallet, session)) return NextResponse.json({ ok: true, claimed: false });
  if (job.founderWallet !== "anonymous") {
    return NextResponse.json({ ok: false, error: "This test belongs to the person who started it." }, { status: 403 });
  }
  const r = claimInspectionJob(id, session);
  if (!r.ok) return NextResponse.json({ ok: false, error: "Someone else has already taken this test." }, { status: 409 });
  return NextResponse.json({ ok: true, claimed: true });
}
