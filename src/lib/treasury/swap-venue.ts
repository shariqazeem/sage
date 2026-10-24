import { getAddress, type Address } from "viem";
import { METIS_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";

/**
 * WHERE THE ACCOUNT SWAPS: USDC ⇄ METIS on Metis Andromeda, through ONE pool, read before it was chosen.
 *
 * Measured 24 Oct 2026 (DexScreener across every m.USDC pool on Metis, then the pool itself by eth_call):
 * Netswap's METIS/m.USDC pair is the deepest by far, about 22,000 METIS against 81,000 m.USDC ($162k), and
 * 1,132 swaps in its last 20,000 blocks, 590 of them through the Netswap router below. Tethys is next at
 * $35k; Hercules' WMETIS/m.USDC pools hold under $7k. At that depth a $10 swap moves the price about
 * 0.01% and a $100 swap about 0.12%, on top of the pool's fee.
 *
 * Why a router call that Sage builds itself, and not an aggregator: the calldata is ours, so the
 * permit that lets the account sign it can pin every part of it that matters (the router, the amount,
 * the recipient being the account itself). An aggregator's calldata is opaque, and a permit cannot
 * check where opaque calldata sends the money.
 *
 * On Metis the native token is ALSO an ERC-20 at 0xDeadDeAd…0000 (the pair's token0): the router takes
 * native METIS as `msg.value` (swapExactMetisForTokens) and pays native METIS out (swapExactTokensForMetis)
 * with a plain value call. A native transfer emits no log on Metis (measured: four plain METIS sends,
 * zero logs), so the USDC leg is the one the account's activity can read from the chain.
 */
export const METIS_SWAP_VENUE = {
  chainId: METIS_MAINNET_CHAIN_ID,
  name: "Netswap",
  router: getAddress("0x1E876cCe41B7b844FDe09E38Fa1cf00f213bFf56"),
  pair: getAddress("0x5Ae3ee7fBB3Cb28C17e7ADc3a6Ae605ae2465091"),
  /** the native token's ERC-20 face; the router's `Metis()` and the pair's token0 */
  metis: getAddress("0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000"),
  usdc: getAddress("0xEA32A96608495e54156Ae48931A7c20f0dcc1a21"),
} as const satisfies { chainId: number; name: string; router: Address; pair: Address; metis: Address; usdc: Address };

export type SwapSide = "usdc_to_metis" | "metis_to_usdc";

export function isSwapSide(v: unknown): v is SwapSide {
  return v === "usdc_to_metis" || v === "metis_to_usdc";
}

/** Whether the account on this chain can swap inside Sage. Metis only: the one chain whose gas is not USDC and that Sage opens accounts on. */
export function swapsOn(chainId: number): boolean {
  return chainId === METIS_SWAP_VENUE.chainId;
}

/** The route: the direct pair, in the direction of the swap. */
export function swapPath(side: SwapSide): [Address, Address] {
  return side === "usdc_to_metis" ? [METIS_SWAP_VENUE.usdc, METIS_SWAP_VENUE.metis] : [METIS_SWAP_VENUE.metis, METIS_SWAP_VENUE.usdc];
}

/** What a swap promises at worst: 1% under the quote by default. The founder sees this number before confirming. */
export const DEFAULT_SLIPPAGE_BPS = 100;
/** A swap that would move the price more than this is refused: it means the pool is thinner than measured. */
export const MAX_PRICE_IMPACT_BPS = 300;
/** Smallest swaps worth a network fee. */
export const MIN_SWAP_USDC_BASE = BigInt(100_000); // 0.10 USDC
export const MIN_SWAP_METIS_WEI = BigInt("20000000000000000"); // 0.02 METIS
/** How long a signed swap stays valid on chain. */
export const SWAP_DEADLINE_SECONDS = 600;

/** The least the swap may return: the quote less the slippage. Rounded down, so the promise is never above the quote. */
export function minimumOut(quotedOut: bigint, slippageBps: number = DEFAULT_SLIPPAGE_BPS): bigint {
  const bps = BigInt(Math.max(0, Math.min(5_000, Math.round(slippageBps))));
  return (quotedOut * (BigInt(10_000) - bps)) / BigInt(10_000);
}

/**
 * How far the swap moves the price, in basis points, fee included: 1 − (what you get per unit) ÷ (what
 * a unit is worth in the pool right now). Pure arithmetic on the pool's reserves and the router's quote.
 */
export function priceImpactBps(input: { amountIn: bigint; amountOut: bigint; reserveIn: bigint; reserveOut: bigint }): number {
  if (input.amountIn <= BigInt(0) || input.reserveIn <= BigInt(0) || input.reserveOut <= BigInt(0)) return 10_000;
  // out/in ÷ reserveOut/reserveIn = out·reserveIn ÷ (in·reserveOut)
  const num = input.amountOut * input.reserveIn * BigInt(10_000);
  const den = input.amountIn * input.reserveOut;
  const ratio = Number(num / den); // in bps of the mid price
  return Math.max(0, 10_000 - ratio);
}

/** The pool's mid price of one METIS in USDC, in USDC base units (6 dp) per 1e18 wei, from its reserves. */
export function metisPriceUsdcBase(reserveMetisWei: bigint, reserveUsdcBase: bigint): bigint {
  if (reserveMetisWei <= BigInt(0)) return BigInt(0);
  return (reserveUsdcBase * BigInt(10) ** BigInt(18)) / reserveMetisWei;
}

/** METIS (wei) → USD, at a price in USDC base units per METIS. */
export function metisToUsd(wei: bigint, priceUsdcBase: bigint): number {
  return Number((wei * priceUsdcBase) / BigInt(10) ** BigInt(18)) / 1e6;
}
