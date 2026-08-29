import { NextResponse } from "next/server";

import { issueStarknetNonce } from "@/lib/auth/starknet-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issue a login nonce. Stored httpOnly server-side; the body copy is only for the wallet prompt. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ nonce: await issueStarknetNonce(), issuedAt: Date.now() });
}
