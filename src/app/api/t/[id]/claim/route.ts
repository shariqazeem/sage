import { NextResponse, type NextRequest } from "next/server";

import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { resolvePrivyX } from "@/lib/auth/privy-login";
import { claimInspectionJob, getInspectionJob } from "@/lib/db/inspection";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { claimXDraft, xDraftFor } from "@/lib/x/drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/t/<inspection id>/claim  { privyToken? }
 *
 * MAKE THIS TEST MINE, at the money moment. Three cases, and the session's own wallet in all of them:
 *
 *   - it is already yours: nothing to do;
 *   - nobody owns it yet (a plan handed over without a sign-in): it becomes the session's, by the same
 *     atomic move the plan claim uses (`claimInspectionJob`), which takes a plan only from nobody;
 *   - a tag on X started it: only the X account that tagged Sage may take it. The account is read from
 *     Privy for the caller's verified sign-in token, the token must hold the wallet the session is
 *     signed in with, and what is compared is X's USER ID, never a handle and never anything this
 *     request says about who is asking (`claimXDraft`'s contract).
 *
 * A plan another wallet owns answers 403 and is never moved.
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

  if (job.founderWallet === "anonymous") {
    const r = claimInspectionJob(id, session);
    if (!r.ok) return NextResponse.json({ ok: false, error: "Someone else has already taken this test." }, { status: 409 });
    return NextResponse.json({ ok: true, claimed: true });
  }

  const draft = xDraftFor(id);
  if (!draft || !draft.unclaimed) {
    return NextResponse.json({ ok: false, error: "This test belongs to the person who started it." }, { status: 403 });
  }
  let token = "";
  try {
    const body = (await req.json()) as { privyToken?: unknown };
    token = typeof body.privyToken === "string" ? body.privyToken : "";
  } catch {
    /* no body: answered below */
  }
  const who = draft.username ? `@${draft.username}` : "the account that tagged Sage";
  const needX = `This test was started by a tag on X. Sign in with X as ${who} to pay for it.`;
  if (!token) return NextResponse.json({ ok: false, needsX: true, error: needX }, { status: 403 });
  const x = await resolvePrivyX(token);
  if (!x.ok) {
    return NextResponse.json(
      { ok: false, needsX: true, error: x.reason === "invalid_token" ? "Your sign-in has expired. Sign in with X again." : "Sage couldn't check your X account just now. Try again in a moment." },
      { status: x.reason === "invalid_token" ? 401 : 503 },
    );
  }
  // the token must be the same person as the session it arrived with
  if (!x.wallets.some((w) => sameFounder(w, session))) {
    return NextResponse.json({ ok: false, needsX: true, error: "That sign-in isn't the one you're signed in to Sage with. Sign out and sign in with X." }, { status: 403 });
  }
  if (!x.xUserId) return NextResponse.json({ ok: false, needsX: true, error: needX }, { status: 403 });
  const r = claimXDraft(id, x.xUserId, session);
  if (!r.ok) {
    const error =
      r.reason === "not_your_draft"
        ? `This test was started by ${who} on X, and you're signed in with a different X account.`
        : r.reason === "already_claimed"
          ? "This test has already been taken by its owner's wallet."
          : needX;
    return NextResponse.json({ ok: false, needsX: r.reason === "not_your_draft", error }, { status: 403 });
  }
  return NextResponse.json({ ok: true, claimed: true });
}
