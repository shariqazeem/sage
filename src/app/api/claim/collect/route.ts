import { NextResponse } from "next/server";

import { claimCommitment } from "@/lib/starknet/claim-link";
import { readClaim, relayClaim } from "@/lib/starknet/claims";
import { starknetConfigured } from "@/lib/starknet/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Collect a payout, with Sage paying the gas.
 *
 * There is no session and no signature here, and that is the design rather than an oversight: the
 * contract itself is ungated because the preimage is the authority. A worker who has never used
 * Starknet, holds no token, and whose account is not deployed can still be paid — which is the
 * entire point of the rail. Sage relaying is a convenience; the same call works from any wallet.
 *
 * Sage seeing the secret discloses nothing new — Sage minted it. What the URL-fragment design
 * protects against is everyone ELSE: access logs, referrer headers, and anything sitting between.
 *
 * THE ON-CHAIN READ BEFORE RELAYING IS NOT A FORMALITY. Without it, anyone could spend Sage's gas
 * by posting garbage secrets and watching the transactions revert. Reading first means Sage only
 * ever pays for a transaction that will succeed.
 */
export async function POST(req: Request) {
  if (!starknetConfigured()) {
    return NextResponse.json({ error: "Starknet settlement is not configured." }, { status: 503 });
  }

  let body: { secret?: unknown; recipient?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  const recipient = typeof body.recipient === "string" ? body.recipient.trim() : "";

  if (!/^0x[0-9a-fA-F]{1,64}$/.test(secret)) {
    return NextResponse.json({ error: "That is not a valid claim link." }, { status: 400 });
  }
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(recipient)) {
    return NextResponse.json(
      { error: "Enter a Starknet address, starting with 0x." },
      { status: 400 },
    );
  }

  try {
    const claim = await readClaim(claimCommitment(secret));
    if (!claim.exists) {
      return NextResponse.json(
        { error: "No payout is waiting behind this link." },
        { status: 404 },
      );
    }
    if (claim.claimed) {
      // Distinguished from "never existed" because they mean different things to the person
      // reading it: one is a used link, the other is a wrong one.
      return NextResponse.json({ error: "This payout has already been collected." }, { status: 409 });
    }

    const txHash = await relayClaim(secret, recipient);
    return NextResponse.json({
      txHash,
      recipient,
      amountBase: claim.amountBase.toString(),
      amountUsd: Number(claim.amountBase) / 1_000_000,
    });
  } catch (err) {
    console.error("[api/claim/collect] relay failed:", err);
    return NextResponse.json({ error: "The collection could not be submitted." }, { status: 502 });
  }
}
