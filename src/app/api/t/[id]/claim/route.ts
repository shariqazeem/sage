import { NextResponse, type NextRequest } from "next/server";

import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { claimInspectionJob, getInspectionJob } from "@/lib/db/inspection";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { claimHandedOver } from "@/lib/telegram/handover-claim";
import { claimGift } from "@/lib/test-page/gift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/t/<inspection id>/claim  { claim? }
 *
 * MAKE A TEST NOBODY OWNS MINE, at the money moment. A plan handed over without a sign-in belongs to
 * nobody; the first signed-in person to pay for it takes it, by the same atomic move the plan claim
 * uses (`claimInspectionJob`), which moves a plan only from nobody and never from a wallet.
 *
 * A test planned in a Telegram chat belongs to that chat (`clawup:<ref>`), and its handover link
 * carries a signed code that expires (`/t/<id>?claim=<code>`). With that code the plan moves to the
 * signed-in wallet (`claimHandedOver`, atomic); without a good one it stays where it is.
 *
 * A test its owner GAVE to someone (`/api/t/<id>/gift`, 27 Nov 2026) carries a gift code in the same `claim`
 * field: signed over the plan and the owner who gave it, so it moves the plan once, atomically, and never a
 * plan that is already paid for (`claimGift`).
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
  if (job.founderWallet.startsWith("clawup:")) {
    const body = (await req.json().catch(() => null)) as { claim?: unknown } | null;
    const r = claimHandedOver(id, body?.claim, session);
    if (r.ok) return NextResponse.json({ ok: true, claimed: true });
    if (r.reason === "already_claimed") return NextResponse.json({ ok: false, error: "This test has already been claimed." }, { status: 409 });
    if (r.reason === "bad_code") return NextResponse.json({ ok: false, error: "This link has expired or isn't yours. Ask Sage in Telegram for a fresh one." }, { status: 403 });
    if (r.reason === "bad_wallet") return NextResponse.json({ ok: false, error: "Sign in with an email or MetaMask to take this test." }, { status: 400 });
    return NextResponse.json({ ok: false, error: "This test belongs to the person who started it." }, { status: 403 });
  }
  if (job.founderWallet !== "anonymous") {
    // a gift: the owner gave this plan away, and the link's code is the only key
    const body = (await req.json().catch(() => null)) as { claim?: unknown } | null;
    if (typeof body?.claim === "string" && body.claim.length > 0) {
      const g = claimGift(id, body.claim, session);
      if (g.ok) return NextResponse.json({ ok: true, claimed: true });
      if (g.reason === "already_claimed") return NextResponse.json({ ok: false, error: "This test has already been taken by the person it was given to." }, { status: 409 });
      if (g.reason === "launched") return NextResponse.json({ ok: false, error: "This test is already paid for, so it can't be given away." }, { status: 409 });
      if (g.reason === "bad_wallet") return NextResponse.json({ ok: false, error: "Sign in with an email or MetaMask to take this test." }, { status: 400 });
      if (g.reason === "bad_code") return NextResponse.json({ ok: false, error: "This link has expired or was already used. Ask whoever sent it for a fresh one." }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: "This test belongs to the person who started it." }, { status: 403 });
  }
  const r = claimInspectionJob(id, session);
  if (!r.ok) return NextResponse.json({ ok: false, error: "Someone else has already taken this test." }, { status: 409 });
  return NextResponse.json({ ok: true, claimed: true });
}
