import { NextResponse, type NextRequest } from "next/server";
import { issueNonce } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issue a login nonce (also set as an httpOnly cookie) for the sign-in flow. */
export async function GET(req: NextRequest) {
  const rl = rateLimit("auth", clientIp(req.headers));
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const nonce = await issueNonce();
  return NextResponse.json({ nonce });
}
