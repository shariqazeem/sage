import { NextResponse } from "next/server";

import { verifyAndCreateStarknetSession } from "@/lib/auth/starknet-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verify a Starknet wallet's signature and mint a session.
 *
 * The address this returns becomes the PAYOUT address for anything submitted in this session, so
 * the only thing that may establish it is a signature the account itself validated. The nonce
 * comes from the httpOnly cookie rather than the body, so a captured signature cannot be replayed
 * against an attacker-chosen nonce.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: { address?: unknown; signature?: unknown; issuedAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const address = typeof body.address === "string" ? body.address : "";
  const issuedAt = typeof body.issuedAt === "number" ? body.issuedAt : NaN;
  const signature = Array.isArray(body.signature)
    ? body.signature.filter((s): s is string => typeof s === "string")
    : [];

  if (!address || !signature.length || !Number.isFinite(issuedAt)) {
    return NextResponse.json({ error: "address, signature and issuedAt are required" }, { status: 400 });
  }

  const verified = await verifyAndCreateStarknetSession({ address, signature, issuedAt });
  if (!verified) {
    // One message for every failure: a wrong signature, a stale nonce and an undeployed account
    // are all "not signed in", and distinguishing them would tell a prober which part to change.
    return NextResponse.json({ error: "could not verify that signature" }, { status: 401 });
  }
  return NextResponse.json({ address: verified });
}
