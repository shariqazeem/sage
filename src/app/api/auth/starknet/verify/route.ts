import { NextResponse } from "next/server";

import { verifyStarknetSignIn } from "@/lib/auth/starknet-session";

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

  const result = await verifyStarknetSignIn({ address, signature, issuedAt });
  if (!result.address) {
    // A WALLET THAT IS NOT ON CHAIN YET IS THE ONE FAILURE WITH A DIFFERENT REMEDY, and saying so
    // leaks nothing: whether an address has code is public. A brand-new Starknet wallet is
    // counterfactual — it has an address and no contract — so no signature it makes can verify,
    // and "try again" would be advice that can never work. Every other failure stays one message,
    // because distinguishing a stale nonce from a bad signature tells a prober which to change.
    if (result.reason === "undeployed") {
      return NextResponse.json(
        {
          error:
            "This wallet has no account contract on Starknet mainnet yet, so there is nothing that can check a signature. RECEIVING FUNDS DOES NOT DEPLOY IT — the account is created when the wallet SENDS its first transaction, and most wallets offer to deploy or activate it then. Do that once, then sign in. (If the wallet is set to a different network, it looks the same from here — check that too.)",
          reason: "undeployed",
        },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: "could not verify that signature" }, { status: 401 });
  }
  return NextResponse.json({ address: result.address });
}
