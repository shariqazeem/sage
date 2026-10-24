import { NextResponse, type NextRequest } from "next/server";
import { parseUnits } from "viem";
import { getFounderAddress } from "@/lib/auth/founder";
import { getWebTreasuryOn } from "@/lib/treasury/web";
import { treasuryChainId } from "@/lib/privy/onboarding";
import { rateLimit } from "@/lib/rate-limit";
import { quoteAccountSwap, swapFromAccount, type SwapQuote } from "@/lib/treasury/swap";
import { isSwapSide, type SwapSide } from "@/lib/treasury/swap-venue";
import { formatNative } from "@/lib/treasury/gas-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * SWAP INSIDE THE ACCOUNT (Metis): GET quotes, POST swaps what the founder confirmed.
 *
 * Amounts travel as decimal strings in the input asset ("5.25" USDC, "1.5" METIS) and are parsed
 * exactly (parseUnits), never through a float. The quote's `minOut` comes back as base units; the
 * founder confirms it, and the POST sends it back as the least they agreed to receive.
 */

const DECIMALS: Record<SwapSide, number> = { usdc_to_metis: 6, metis_to_usdc: 18 };
const OUT_DECIMALS: Record<SwapSide, number> = { usdc_to_metis: 18, metis_to_usdc: 6 };

function parseAmount(side: SwapSide, raw: unknown): bigint | null {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  try {
    const v = parseUnits(s, DECIMALS[side]);
    return v > BigInt(0) ? v : null;
  } catch {
    return null;
  }
}

const fmt = (v: bigint, decimals: number) => (decimals === 6 ? (Number(v) / 1e6).toFixed(2) : formatNative(v));

function view(q: SwapQuote) {
  const inDec = DECIMALS[q.side];
  const outDec = OUT_DECIMALS[q.side];
  return {
    side: q.side,
    amountIn: q.amountIn.toString(),
    amountOut: q.amountOut.toString(),
    minOut: q.minOut.toString(),
    amountInText: fmt(q.amountIn, inDec),
    amountOutText: fmt(q.amountOut, outDec),
    minOutText: fmt(q.minOut, outDec),
    feeMetis: formatNative(q.feeWei),
    metisPriceUsd: Number(q.metisPriceUsdcBase) / 1e6,
    priceImpactPct: q.priceImpactBps / 100,
    slippagePct: q.slippageBps / 100,
    venue: q.venue,
  };
}

async function account(req: NextRequest, chainIdRaw: unknown) {
  const founder = await getFounderAddress();
  if (!founder) return { error: NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 }) };
  const chainId = typeof chainIdRaw === "number" && Number.isFinite(chainIdRaw) ? chainIdRaw : Number(chainIdRaw) || treasuryChainId();
  const wallet = getWebTreasuryOn(founder, chainId);
  if (!wallet) return { error: NextResponse.json({ ok: false, error: "There is no account on that network yet." }, { status: 404 }) };
  return { founder, wallet };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const a = await account(req, sp.get("chainId"));
  if ("error" in a) return a.error;
  const side = sp.get("side");
  if (!isSwapSide(side)) return NextResponse.json({ ok: false, error: "Say which way: usdc_to_metis or metis_to_usdc." }, { status: 400 });
  const amountIn = parseAmount(side, sp.get("amount"));
  if (amountIn === null) return NextResponse.json({ ok: false, error: "Give an amount to swap." }, { status: 400 });
  if (!rateLimit("swapQuote", a.founder.toLowerCase()).ok) return NextResponse.json({ ok: false, error: "Too many quotes at once. Give it a second." }, { status: 429 });
  const check = await quoteAccountSwap(a.wallet, side, amountIn);
  if (!check.ok) return NextResponse.json({ ok: false, code: check.code, error: check.message }, { status: 400 });
  return NextResponse.json({ ok: true, quote: view(check.quote) });
}

export async function POST(req: NextRequest) {
  let body: { chainId?: unknown; side?: unknown; amount?: unknown; minOut?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const a = await account(req, body.chainId);
  if ("error" in a) return a.error;
  if (!isSwapSide(body.side)) return NextResponse.json({ ok: false, error: "Say which way: usdc_to_metis or metis_to_usdc." }, { status: 400 });
  const side = body.side;
  const amountIn = parseAmount(side, body.amount);
  if (amountIn === null) return NextResponse.json({ ok: false, error: "Give an amount to swap." }, { status: 400 });
  const minOutRaw = typeof body.minOut === "string" && /^\d+$/.test(body.minOut) ? BigInt(body.minOut) : null;
  if (minOutRaw === null || minOutRaw <= BigInt(0)) return NextResponse.json({ ok: false, error: "Confirm the quote first: the swap needs the least you agreed to receive." }, { status: 400 });
  if (!rateLimit("accountMove", a.founder.toLowerCase()).ok) return NextResponse.json({ ok: false, error: "One move at a time. Give it a moment." }, { status: 429 });
  const r = await swapFromAccount(a.founder, a.wallet, side, amountIn, minOutRaw);
  if (!r.ok) return NextResponse.json({ ok: false, code: r.code, error: r.message }, { status: r.code === "busy" ? 409 : 400 });
  return NextResponse.json({
    ok: true,
    side: r.side,
    amountInText: fmt(r.amountIn, DECIMALS[side]),
    amountOutText: fmt(r.amountOut, OUT_DECIMALS[side]),
    txHash: r.txHash,
    approveTxHash: r.approveTxHash,
    explorerUrl: r.explorerUrl,
  });
}
