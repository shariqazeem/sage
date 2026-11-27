import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { mintAlertToken, rosterFor } from "@/lib/db/roster";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOT = "sagedeputybot";

/**
 * A person's own link into the roster. It mints a short-lived token and hands back a Telegram deep link;
 * opening it is what binds the chat to the wallet.
 *
 * WHOSE WALLET (27 Nov 2026). The roster now carries a person's own news as well as new tests (what happened
 * to their answer: src/lib/tester-updates/), so a link is minted only for the SIGNED-IN wallet. Anyone could
 * once mint a link for any address and take over its alerts; that was bounded while alerts held only public
 * board news, and it is not now.
 *
 * WHO MAY JOIN (27 Nov 2026). Anyone signed in, by their own tap. It used to take a first payout, so the roster
 * was people who had done the work; but the crowd is what fills a test, and a newcomer's first test should be
 * one message away. Joining is still opt-in, every message keeps the cooldown and the "stop" word, and being
 * paid is still not consent (src/lib/roster/alerts.ts).
 */
export async function POST(req: NextRequest) {
  if (!rateLimit("submit", clientIp(req.headers)).ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const session = await getFounderAddress();
  if (!session) return NextResponse.json({ error: "Sign in first, and Sage can tell you when a test opens." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const asked = typeof body.wallet === "string" ? body.wallet.trim() : "";
  if (asked && !sameFounder(asked, session)) {
    return NextResponse.json({ error: "Alerts go to the wallet you are signed in with." }, { status: 403 });
  }
  if (!/^0x[0-9a-fA-F]{20,64}$/.test(session)) {
    return NextResponse.json({ error: "Alerts need an Ethereum-style wallet." }, { status: 400 });
  }
  const token = mintAlertToken(session);
  const row = rosterFor(session);
  return NextResponse.json({ ok: true, url: `https://t.me/${BOT}?start=${token}`, alreadyOn: row !== null && !row.mutedAt });
}
