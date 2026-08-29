import { NextResponse } from "next/server";

import { clearStarknetSession, getStarknetSessionAddress } from "@/lib/auth/starknet-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is signed in on the Starknet rail, if anyone.
 *
 * Exists so a returning tester is not shown a connect button and asked to sign again for a session
 * they already hold. Reads the signed cookie and nothing else — it establishes no session and
 * accepts no address.
 */
export async function GET(): Promise<NextResponse> {
  const address = await getStarknetSessionAddress();
  return NextResponse.json({ address });
}

export async function DELETE(): Promise<NextResponse> {
  await clearStarknetSession();
  return NextResponse.json({ ok: true });
}
