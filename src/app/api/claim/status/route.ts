import { NextResponse } from "next/server";

import { readClaim } from "@/lib/starknet/claims";
import { starknetConfigured } from "@/lib/starknet/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Is this link real, and is it still collectable?
 *
 * Takes the COMMITMENT, never the secret. The claim page derives the commitment in the browser, so
 * a worker can check their link without transmitting the thing that owns their money — not to a
 * log, not to a referrer header, and not to Sage. Answering this question is a public read of
 * public on-chain state; it discloses nothing the chain does not already show.
 */
export async function GET(req: Request) {
  if (!starknetConfigured()) {
    return NextResponse.json({ error: "Starknet settlement is not configured." }, { status: 503 });
  }

  const commitment = new URL(req.url).searchParams.get("commitment")?.trim();
  if (!commitment || !/^[0-9]+$/.test(commitment)) {
    return NextResponse.json({ error: "A decimal commitment is required." }, { status: 400 });
  }

  try {
    const claim = await readClaim(commitment);
    return NextResponse.json({
      exists: claim.exists,
      claimed: claim.claimed,
      amountBase: claim.amountBase.toString(),
      amountUsd: Number(claim.amountBase) / 1_000_000,
      expiry: claim.expiry,
    });
  } catch (err) {
    console.error("[api/claim/status] read failed:", err);
    return NextResponse.json({ error: "Could not reach Starknet." }, { status: 502 });
  }
}
