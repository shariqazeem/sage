import { NextResponse } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import { personIdentitiesOf } from "@/lib/db/person-identities";
import { claimXDraft, xDraftFor } from "@/lib/x/drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CLAIM A TEST THAT A TAG ON X STARTED (relaunch, 20 Nov 2026).
 *
 * Someone tagged @sagepaysai with their product link, and Sage drafted a test owned by that X account
 * (`src/lib/x/drafts.ts`). Anyone may look at the draft; only the person who tagged may own it and pay
 * for it. The proof is the X account the server verified at sign-in (`person_identities`, written from
 * Privy's own user record), bound to this session's wallet. The X user id is never read from the
 * request: a handle can be renamed and re-registered, and a body can say anything.
 *
 * GET says whether this id is an X draft and whether this session may claim it; POST claims it.
 */
type Ctx = { params: Promise<{ id: string }> };

function verifiedXOf(wallet: string): string | null {
  return personIdentitiesOf(wallet).find((p) => p.provider === "x")?.subject ?? null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const draft = xDraftFor(id);
  if (!draft) return NextResponse.json({ xDraft: false });
  const wallet = await getSessionAddress();
  const mine = wallet ? verifiedXOf(wallet) === draft.xUserId : false;
  return NextResponse.json({ xDraft: true, username: draft.username, unclaimed: draft.unclaimed, yours: mine });
}

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const wallet = await getSessionAddress();
  if (!wallet) return NextResponse.json({ error: "Sign in with the X account that tagged Sage to claim this test." }, { status: 401 });
  const xUserId = verifiedXOf(wallet);
  if (!xUserId) return NextResponse.json({ error: "Sign in with X to claim this test: it belongs to the X account that tagged Sage." }, { status: 403 });
  const r = claimXDraft(id, xUserId, wallet);
  if (r.ok) return NextResponse.json({ ok: true });
  const words: Record<typeof r.reason, [number, string]> = {
    not_an_x_draft: [404, "This test wasn't started by a tag on X."],
    not_your_draft: [403, "This test belongs to the X account that tagged Sage, and that's a different account."],
    bad_wallet: [400, "That wallet can't own a test."],
    already_claimed: [409, "This test has already been claimed."],
  };
  const [status, error] = words[r.reason];
  return NextResponse.json({ error, reason: r.reason }, { status });
}
