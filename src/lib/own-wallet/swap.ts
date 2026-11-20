import { encodeFunctionData, erc20Abi, getAddress, parseUnits, type Address } from "viem";
import { METIS_SWAP_VENUE, SWAP_DEADLINE_SECONDS, swapPath, type SwapSide } from "@/lib/treasury/swap-venue";
import { SWAP_METIS_FOR_TOKENS_ABI, SWAP_TOKENS_FOR_METIS_ABI } from "@/lib/privy/swap-policy";
import type { SwapQuote } from "@/lib/treasury/swap";

/**
 * ADD MONEY IN ONE WITHDRAWAL (relaunch, 20 Nov 2026).
 *
 * A builder pays for a test from their own wallet on Metis, which needs m.USDC for the testers and a
 * little METIS for the network fee. Exchanges send METIS on the Metis network, so one withdrawal can
 * cover both: the builder swaps part of it to m.USDC through Netswap, the pool Sage's account already
 * uses (`swap-venue.ts`).
 *
 * Sage never holds this money. It reads the pool's quote (`quoteSwapFor`) and hands back the exact
 * router calls the person's own wallet signs: the router, the amount, the least they will receive
 * (the router refuses less) and their own address as the only recipient. Pure: no chain reads here.
 */
export interface OwnSwapCall {
  label: "approve" | "swap";
  to: Address;
  data: `0x${string}`;
  /** native METIS sent with the call: the amount for a METIS-to-USDC swap, zero otherwise */
  value: bigint;
}

/** The amount a person typed, in the token's own units: METIS (18 decimals) or m.USDC (6). Null when unreadable. */
export function parseSwapAmount(side: SwapSide, raw: unknown): bigint | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  const decimals = side === "metis_to_usdc" ? 18 : 6;
  if (!/^\d{1,12}(\.\d+)?$/.test(t)) return null;
  const fraction = t.split(".")[1] ?? "";
  if (fraction.length > decimals) return null;
  const amount = parseUnits(t, decimals);
  return amount > BigInt(0) ? amount : null;
}

/** The calls the wallet signs, in order. The quote's `minOut` is what the router enforces. */
export function ownWalletSwapCalls(quote: Pick<SwapQuote, "side" | "amountIn" | "minOut">, recipient: string, nowSec: number): OwnSwapCall[] {
  const to = getAddress(recipient);
  const deadline = BigInt(Math.floor(nowSec) + SWAP_DEADLINE_SECONDS);
  const path = swapPath(quote.side);
  if (quote.side === "metis_to_usdc") {
    return [
      {
        label: "swap",
        to: METIS_SWAP_VENUE.router,
        value: quote.amountIn,
        data: encodeFunctionData({ abi: SWAP_METIS_FOR_TOKENS_ABI, functionName: "swapExactMetisForTokens", args: [quote.minOut, path, to, deadline] }),
      },
    ];
  }
  return [
    {
      label: "approve",
      to: METIS_SWAP_VENUE.usdc,
      value: BigInt(0),
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [METIS_SWAP_VENUE.router, quote.amountIn] }),
    },
    {
      label: "swap",
      to: METIS_SWAP_VENUE.router,
      value: BigInt(0),
      data: encodeFunctionData({ abi: SWAP_TOKENS_FOR_METIS_ABI, functionName: "swapExactTokensForMetis", args: [quote.amountIn, quote.minOut, path, to, deadline] }),
    },
  ];
}

/** JSON-safe: every amount as a decimal string. */
export function swapQuoteJson(quote: SwapQuote): Record<string, string | number> {
  return {
    side: quote.side,
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    minOut: quote.minOut.toString(),
    slippageBps: quote.slippageBps,
    priceImpactBps: quote.priceImpactBps,
    feeWei: quote.feeWei.toString(),
    metisPriceUsdcBase: quote.metisPriceUsdcBase.toString(),
    venue: quote.venue,
  };
}
