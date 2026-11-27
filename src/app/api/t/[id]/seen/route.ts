import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { getFounderAddress } from "@/lib/auth/founder";
import { ownsCampaign } from "@/lib/campaigns/review-actions";
import { hasMissionPlan } from "@/lib/campaigns/vault-kind";
import { getCampaign } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import { countVisits, recordVisit, visitorId, MAX_VISITORS_PER_TEST } from "@/lib/db/test-visits";
import { siteUrl } from "@/lib/site";
import { looksLikeBot, sourceOf, SAGE_HOSTS } from "@/lib/test-page/funnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/t/<campaign id>/seen: the test page says someone is looking at it (27 Nov 2026).
 *
 * Body `{ via?, ref?, step? }`: `via` is the word Sage's own links carry (`?via=x`), `ref` the page the
 * visitor came from, and `step: "opened"` means they clicked through to the product from the test's page.
 *
 * What is kept is in `test_visits`: a hash of a random first-party cookie, the first source, and three
 * times. No IP address and no user agent is stored; the user agent is read once, here, only to leave
 * crawlers and link previews out. Always 204: a visitor learns nothing from this door, and a draft, an
 * unknown test, the test's own builder and a bot write nothing.
 */
const COOKIE = "sg_v";
// first-party, one site, counts for one builder's test only: kept under 13 months, the usual bound for a
// visit-counting cookie that needs no banner (no IP, no user agent, never shared, never another site)
const COOKIE_MAX_AGE = 390 * 24 * 3600;
const COOKIE_SHAPE = /^[A-Za-z0-9_-]{16,64}$/;

const nothing = () => new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });

function ownHosts(): string[] {
  try {
    return [...SAGE_HOSTS, new URL(siteUrl()).hostname];
  } catch {
    return [...SAGE_HOSTS];
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (looksLikeBot(req.headers.get("user-agent"))) return nothing();
  const campaign = getCampaign(id);
  if (!campaign || !hasMissionPlan(campaign.vaultKind) || campaign.status === "draft" || campaign.sandbox) return nothing();
  const viewer = await getFounderAddress();
  if (ownsCampaign(campaign, viewer)) return nothing();

  const body = (await req.json().catch(() => ({}))) as { via?: unknown; ref?: unknown; step?: unknown };
  const via = typeof body.via === "string" ? body.via.slice(0, 24) : null;
  const ref = typeof body.ref === "string" ? body.ref.slice(0, 500) : null;
  const step = body.step === "opened" ? "opened" : "view";

  const res = nothing();
  let cookie = req.cookies.get(COOKIE)?.value ?? "";
  const fresh = !COOKIE_SHAPE.test(cookie);
  if (fresh) {
    cookie = randomBytes(16).toString("base64url");
    res.cookies.set(COOKIE, cookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }
  // A caller that never keeps the cookie is a new visitor every time: past this many, a test takes no new ones.
  if (fresh && countVisits(campaign.id) >= MAX_VISITORS_PER_TEST) return res;

  try {
    recordVisit({ campaignId: campaign.id, visitor: visitorId(cookie), source: sourceOf({ via, ref }, ownHosts()), wallet: viewer, step, now: nowSeconds() });
  } catch (e) {
    // counting a visit must never break the page that sent it
    console.error("[seen] visit not recorded:", e instanceof Error ? e.message : e);
  }
  return res;
}
