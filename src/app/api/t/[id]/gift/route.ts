import { NextResponse, type NextRequest } from "next/server";

import { getFounderAddress } from "@/lib/auth/founder";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site";
import { makeGift } from "@/lib/test-page/gift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * POST /api/t/<inspection id>/gift — THE OWNER OF A FINISHED, UNPAID PLAN ASKS FOR A LINK THAT GIVES IT AWAY.
 *
 * The link opens the plan with Sage's first look for whoever holds it, and the first person to sign in with
 * it takes the plan (`claimGift` at /api/t/<id>/claim). It works once, for 7 days, and never after the plan is
 * paid for. `via=gift` lets Sage count builders who arrived through one.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const rl = rateLimit("auth", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ ok: false, error: "Test not found." }, { status: 404 });
  const session = await getFounderAddress();
  if (!session) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const gift = makeGift(id, session);
  if (gift.ok) {
    const url = `${siteUrl()}/t/${encodeURIComponent(id)}?claim=${encodeURIComponent(gift.code)}&via=gift`;
    return NextResponse.json({ ok: true, url, expires: gift.expires });
  }
  switch (gift.reason) {
    case "no_such_job":
    case "not_yours":
      return NextResponse.json({ ok: false, error: "Only the person who started this test can give it." }, { status: 404 });
    case "launched":
      return NextResponse.json({ ok: false, error: "This test is already paid for, so it can't be given away." }, { status: 409 });
    case "no_secret":
      return NextResponse.json({ ok: false, error: "Gift links aren't switched on here." }, { status: 503 });
    default:
      return NextResponse.json({ ok: false, error: "Only a finished test that nobody has paid for can be given." }, { status: 409 });
  }
}
