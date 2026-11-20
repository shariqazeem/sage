import { NextResponse, type NextRequest } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import { METIS_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";
import { ownWalletSwapCalls, parseSwapAmount, swapQuoteJson } from "@/lib/own-wallet/swap";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { quoteSwapFor } from "@/lib/treasury/swap";
import { isSwapSide } from "@/lib/treasury/swap-venue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SWAP FROM YOUR OWN WALLET, THE QUOTE (relaunch, 20 Nov 2026). The signed-in person's own wallet, on
 * Metis: the pool's quote with every check the swap runs, and the exact router calls their wallet will
 * sign. Nothing moves here and Sage signs nothing: the person's wallet sends the calls itself, and the
 * router refuses anything below the quoted minimum. `src/lib/own-wallet/swap.ts`.
 *
 * Body: `{ side: "metis_to_usdc" | "usdc_to_metis", amount: "1.5" }` (the amount in the input token).
 */
export async function POST(req: NextRequest) {
  if (!rateLimit("swapQuote", clientIp(req.headers)).ok) {
    return NextResponse.json({ error: "Too many quotes. Wait a minute and try again." }, { status: 429 });
  }
  const owner = await getSessionAddress();
  if (!owner) return NextResponse.json({ error: "Sign in first: the swap runs from the wallet you signed in with." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { side?: unknown; amount?: unknown } | null;
  const side = body?.side;
  if (!isSwapSide(side)) return NextResponse.json({ error: "Say which way to swap: METIS to USDC, or USDC to METIS." }, { status: 400 });
  const amountIn = parseSwapAmount(side, body?.amount);
  if (amountIn === null) return NextResponse.json({ error: "That amount isn't a number Sage can read." }, { status: 400 });

  const check = await quoteSwapFor(owner, METIS_MAINNET_CHAIN_ID, side, amountIn, { holder: "wallet" });
  if (!check.ok) return NextResponse.json({ error: check.message, code: check.code }, { status: 422 });

  const calls = ownWalletSwapCalls(check.quote, owner, Math.floor(Date.now() / 1000)).map((c) => ({ ...c, value: c.value.toString() }));
  return NextResponse.json({ ok: true, owner, chainId: METIS_MAINNET_CHAIN_ID, quote: swapQuoteJson(check.quote), calls });
}
