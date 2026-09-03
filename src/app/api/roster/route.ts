import { NextResponse, type NextRequest } from "next/server";
import { listPaidSubmissionsByWallet } from "@/lib/db/campaigns";
import { mintAlertToken, rosterFor } from "@/lib/db/roster";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOT = "sagedeputybot";

/**
 * A worker's own link into the roster. It mints a short-lived token and hands back a Telegram deep
 * link; opening it is what binds the chat to the wallet.
 *
 * Only a wallet that has actually been PAID may be linked, so the roster is people who have done the
 * work, not addresses someone typed. The honest limit: possession of a fresh link is the proof of
 * ownership, so someone who minted a link for another person's wallet and opened it themselves would
 * receive that wallet's alerts and displace the real owner's chat. The harm is bounded — the alerts
 * carry only public board information, and the owner re-links in one click — and the alternative, a
 * wallet signature, is exactly the friction this product exists to remove.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit("submit", clientIp(req.headers)).ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
  if (!/^0x[0-9a-fA-F]{20,64}$/.test(wallet)) {
    return NextResponse.json({ error: "That doesn't look like a wallet address." }, { status: 400 });
  }
  const paid = listPaidSubmissionsByWallet(wallet).length > 0;
  if (!paid) {
    return NextResponse.json({ error: "Alerts are for people who have been paid for work here at least once." }, { status: 403 });
  }
  const token = mintAlertToken(wallet);
  return NextResponse.json({ ok: true, url: `https://t.me/${BOT}?start=${token}`, alreadyOn: rosterFor(wallet) !== null && !rosterFor(wallet)?.mutedAt });
}
