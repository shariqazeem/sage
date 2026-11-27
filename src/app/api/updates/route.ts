import { NextResponse } from "next/server";

import { getFounderAddress } from "@/lib/auth/founder";
import { builderEmailState } from "@/lib/builder-updates/email";
import { builderUpdatesState, mintUpdatesToken, muteChannel } from "@/lib/builder-updates/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The same bot the work alerts link opens (src/app/api/roster/route.ts). */
const BOT = "sagedeputybot";
const noStore = { "cache-control": "private, no-store" };

/**
 * UPDATES FOR A BUILDER'S TESTS, ON TELEGRAM (src/lib/builder-updates/).
 *
 * GET     whether this signed-in builder hears about their tests: Telegram connected, muted or off, and
 *         email on, off or unavailable (the address only masked). Email's own door is /api/updates/email.
 * POST    a single-use link (15 minutes) that binds the Telegram chat that opens it to this builder.
 * DELETE  stop the messages. The chat stays on record, so a fresh link starts them again.
 *
 * Signed-in only: the link is proof that the person in the chat is the person who was signed in here.
 */
export async function GET() {
  const me = await getFounderAddress();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  return NextResponse.json({ telegram: builderUpdatesState(me), ...builderEmailState(me) }, { headers: noStore });
}

export async function POST() {
  const me = await getFounderAddress();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  return NextResponse.json({ url: `https://t.me/${BOT}?start=${mintUpdatesToken(me)}`, telegram: builderUpdatesState(me) }, { headers: noStore });
}

export async function DELETE() {
  const me = await getFounderAddress();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  muteChannel(me);
  return NextResponse.json({ telegram: builderUpdatesState(me) }, { headers: noStore });
}
