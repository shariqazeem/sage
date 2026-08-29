import { NextResponse } from "next/server";

import { getFounderIdentity } from "@/lib/auth/founder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is signed in as a founder, from EITHER session.
 *
 * Separate from `/api/auth/session`, which answers a narrower and still-necessary question: is
 * there an EVM session matching the wallet currently connected in this browser. That one gates
 * EVM chain work and must keep meaning exactly what it meant. This one answers "whose account is
 * this", which is the question the launch flow actually asks.
 */
export async function GET(): Promise<NextResponse> {
  const identity = await getFounderIdentity();
  return NextResponse.json(identity ?? { address: null, chain: null });
}
