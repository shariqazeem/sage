import { NextResponse } from "next/server";

import { buildSignInTypedData, issueStarknetNonce } from "@/lib/auth/starknet-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issue a login nonce, and the exact typed data to sign.
 *
 * The nonce is stored httpOnly server-side; the copy in this body exists only so the wallet can
 * show it. THE TYPED DATA IS BUILT HERE rather than in the browser for the same reason the vault's
 * calls are: verification reconstructs this structure server-side and compares, so a second
 * implementation in the client is a second thing to drift. When it drifts every signature is
 * rejected as forged, and the person is simply unable to sign in with no way to tell why.
 *
 * The address is not known yet — the wallet supplies it — so the caller fills `message.wallet`
 * before signing. That single field is the only part the browser touches.
 */
export async function GET(): Promise<NextResponse> {
  const nonce = await issueStarknetNonce();
  const issuedAt = Date.now();
  return NextResponse.json({
    nonce,
    issuedAt,
    typedData: buildSignInTypedData({ address: "0x0", nonce, issuedAt }),
  });
}
