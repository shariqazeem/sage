import { NextResponse, type NextRequest } from "next/server";
import { verifyAndCreateSession, verifyAndBindToSession } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verify a SIWE-lite signature and mint a session. The nonce is bound server-
 * side (httpOnly cookie), so the body only carries the address, signature, and
 * issuedAt — all of which are covered by the signed message.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit("auth", clientIp(req.headers));
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let body: { address?: unknown; signature?: unknown; issuedAt?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (
    typeof body.address !== "string" ||
    typeof body.signature !== "string" ||
    typeof body.issuedAt !== "string"
  ) {
    return NextResponse.json({ error: "address, signature, issuedAt required." }, { status: 400 });
  }

  /*
    TWO USES OF ONE PROOF. `mode: "bind"` joins the proven wallet to the account already signed in
    and leaves the session alone; anything else is a sign-in, which replaces it — unchanged.
  */
  if (body.mode === "bind") {
    const r = await verifyAndBindToSession({ address: body.address, signature: body.signature, issuedAt: body.issuedAt });
    if (!r.ok) {
      return r.reason === "no_session"
        ? NextResponse.json({ error: "Sign in first — there is no account to add this wallet to." }, { status: 401 })
        : NextResponse.json({ error: "Signature did not verify." }, { status: 401 });
    }
    return NextResponse.json({ ok: true, address: r.account, bound: r.bound });
  }
  const address = await verifyAndCreateSession({
    address: body.address,
    signature: body.signature,
    issuedAt: body.issuedAt,
  });
  if (!address) {
    return NextResponse.json({ error: "Signature did not verify." }, { status: 401 });
  }
  return NextResponse.json({ ok: true, address });
}
