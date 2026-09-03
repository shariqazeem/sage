import { NextResponse, type NextRequest } from "next/server";
import { createSessionForVerifiedAddress } from "@/lib/auth/session";
import { resolvePrivyLogin } from "@/lib/auth/privy-login";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { token } — a Privy access token from the browser becomes a Sage session for the person's embedded wallet. */
export async function POST(req: NextRequest) {
  const rl = rateLimit("auth", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "token required." }, { status: 400 });
  const r = await resolvePrivyLogin(token);
  if (!r.ok) {
    if (r.reason === "no_wallet_yet") return NextResponse.json({ error: "Your wallet is still being created — one moment.", retryable: true }, { status: 409 });
    if (r.reason === "not_configured") return NextResponse.json({ error: "Email sign-in isn't configured on this deployment." }, { status: 503 });
    return NextResponse.json({ error: "That sign-in couldn't be verified. Try again." }, { status: 401 });
  }
  const address = await createSessionForVerifiedAddress(r.address);
  if (!address) return NextResponse.json({ error: "That wallet address is not valid." }, { status: 400 });
  return NextResponse.json({ ok: true, address });
}
