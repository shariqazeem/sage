import { NextResponse } from "next/server";

import { getFounderAddress } from "@/lib/auth/founder";
import { signInEmailOfWallet } from "@/lib/auth/privy-login";
import { builderEmailState, muteBuilderEmail, setBuilderEmail } from "@/lib/builder-updates/email";
import { emailConfigured } from "@/lib/builder-updates/email-core";
import { settleBaseline } from "@/lib/builder-updates/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "private, no-store" };

/**
 * EMAIL UPDATES FOR A BUILDER'S TESTS (src/lib/builder-updates/email-core.ts).
 *
 * POST    turn them on. The address is the one this builder's own sign-in carries, read from Privy on the
 *         server; the request names no address and none is accepted from it.
 * DELETE  turn them off. The row stays, so turning them on again is one tap.
 *
 * With email not set up on this server both answer 404, as if the door were not there. The address is
 * answered only masked, and is never logged.
 */
export async function POST() {
  if (!emailConfigured()) return NextResponse.json({ error: "Not found." }, { status: 404, headers: noStore });
  const me = await getFounderAddress();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  const email = await signInEmailOfWallet(me);
  if (!email || !setBuilderEmail(me, email)) {
    return NextResponse.json(
      { error: "Sage has no email for this sign-in: you signed in with a wallet. Get updates in Telegram instead, or sign in with your email.", code: "no_email" },
      { status: 409, headers: noStore },
    );
  }
  // what is already true on their tests is not news: only what happens from here is emailed
  settleBaseline(me, undefined, "email");
  return NextResponse.json({ ok: true, ...builderEmailState(me) }, { headers: noStore });
}

export async function DELETE() {
  if (!emailConfigured()) return NextResponse.json({ error: "Not found." }, { status: 404, headers: noStore });
  const me = await getFounderAddress();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  muteBuilderEmail(me);
  return NextResponse.json({ ok: true, ...builderEmailState(me) }, { headers: noStore });
}
