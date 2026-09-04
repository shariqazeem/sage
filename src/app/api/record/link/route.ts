import { NextResponse } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import { getStarknetSessionAddress } from "@/lib/auth/starknet-session";
import { linkWallets, linkedWalletsOf } from "@/lib/campaigns/wallet-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * LINK THE WALLETS YOU ARE SIGNED IN WITH — nothing else can be linked.
 *
 * Proof of control is the sign-in itself: an EVM session (SIWE) and a Starknet session (SNIP-12)
 * each already prove their wallet, so a link between exactly those two claims nothing new. No
 * address is accepted from the body; a caller holding one session cannot attach a stranger's
 * wallet to their record.
 */
export async function POST(): Promise<NextResponse> {
  const [evm, starknet] = await Promise.all([getSessionAddress(), getStarknetSessionAddress()]);
  if (!evm || !starknet) {
    return NextResponse.json(
      { ok: false, error: "Sign in with both wallets — the Ethereum one and the Starknet one — then link them from either record." },
      { status: 401 },
    );
  }
  /*
    DECLARED, not discovered. The person is holding two proven sessions and asking for their rails to
    be one record — that is a disclosure, and standing must not read it as the wallet rotation the
    consolidation watch looks for. Measured on prod 2026-09-05: the operator's own bound pair came
    back "linked on-chain to 1 other that took paid work here" and was locked out of the paid tiers.
  */
  const { linked } = linkWallets(evm, starknet, Math.floor(Date.now() / 1000), "declared");
  return NextResponse.json({ ok: true, linked, wallets: linkedWalletsOf(evm) });
}
