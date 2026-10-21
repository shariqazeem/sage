import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { rateLimit } from "@/lib/rate-limit";
import { isPlanId, PLANS } from "@/lib/plans/catalog";
import { promoFor, redeemPromoDays } from "@/lib/plans/promo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?code=&plan=: what a promo code gives on this plan, for the checkout to show before anything is
 * paid. POST { code, plan }: redeem a free-days code (nothing is paid). Signed in only, and rate limited
 * per founder: a code is meant to be typed by a person, never guessed by a script.
 */
export async function GET(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  if (!rateLimit("promo", founder.toLowerCase()).ok) return NextResponse.json({ ok: false, error: "Too many tries. Wait a minute and try again." }, { status: 429 });
  const plan = req.nextUrl.searchParams.get("plan") ?? "";
  if (!isPlanId(plan)) return NextResponse.json({ ok: false, error: "Choose a plan." }, { status: 400 });
  const check = promoFor(founder, req.nextUrl.searchParams.get("code"), plan);
  if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 404 });
  const name = PLANS[check.plan].name;
  return NextResponse.json(
    check.kind === "days"
      ? { ok: true, code: check.code, kind: "days", plan: check.plan, days: check.days, label: `${check.days} days of ${name}, free` }
      : { ok: true, code: check.code, kind: "percent", plan: check.plan, percentOff: check.percentOff, priceUsd: check.priceUsd, discountedUsd: check.discountedUsd, label: `${check.percentOff}% off your first ${name} payment` },
  );
}

export async function POST(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  if (!rateLimit("promo", founder.toLowerCase()).ok) return NextResponse.json({ ok: false, error: "Too many tries. Wait a minute and try again." }, { status: 429 });
  let body: { code?: unknown; plan?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!isPlanId(body.plan)) return NextResponse.json({ ok: false, error: "Choose a plan." }, { status: 400 });
  const r = redeemPromoDays(founder, body.code, body.plan);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, plan: r.plan, planUntil: r.until, days: r.days });
}
