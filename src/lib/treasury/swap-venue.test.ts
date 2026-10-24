import { describe, expect, it } from "vitest";
import { METIS_SWAP_VENUE, metisPriceUsdcBase, metisToUsd, minimumOut, priceImpactBps, swapPath, swapsOn } from "./swap-venue";

/**
 * THE SWAP'S ARITHMETIC. Every number a founder confirms comes from here or from the router itself,
 * and the reserves below are the pool's own, read 24 Oct 2026 (21,994.46 METIS / 81,186.11 m.USDC).
 */
const RESERVE_METIS = BigInt("21994462839853926227868");
const RESERVE_USDC = BigInt("81186112117");

/** UniswapV2's own getAmountOut at a 0.3% fee: the router's formula, to check the impact math against. */
function v2Out(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = 30): bigint {
  const inWithFee = amountIn * BigInt(10_000 - feeBps);
  return (inWithFee * reserveOut) / (reserveIn * BigInt(10_000) + inWithFee);
}

describe("swap venue", () => {
  it("routes the direct pair, in the swap's direction, on Metis only", () => {
    expect(swapPath("usdc_to_metis")).toEqual([METIS_SWAP_VENUE.usdc, METIS_SWAP_VENUE.metis]);
    expect(swapPath("metis_to_usdc")).toEqual([METIS_SWAP_VENUE.metis, METIS_SWAP_VENUE.usdc]);
    expect(swapsOn(1088)).toBe(true);
    expect(swapsOn(2345)).toBe(false);
    expect(swapsOn(5042)).toBe(false);
  });

  it("promises at worst the quote less the slippage, rounded down, never above the quote", () => {
    expect(minimumOut(BigInt(1_000_000))).toBe(BigInt(990_000)); // 1% default
    expect(minimumOut(BigInt(1_000_000), 50)).toBe(BigInt(995_000));
    expect(minimumOut(BigInt(999), 100)).toBe(BigInt(989)); // floor, not round
    expect(minimumOut(BigInt(1_000_000), -5)).toBe(BigInt(1_000_000)); // a negative tolerance is no tolerance
  });

  it("prices METIS from the pool's reserves", () => {
    const price = metisPriceUsdcBase(RESERVE_METIS, RESERVE_USDC);
    // 81,186.11 / 21,994.46 ≈ 3.6912 USDC per METIS
    expect(Number(price) / 1e6).toBeCloseTo(3.6912, 3);
    expect(metisToUsd(BigInt("50000000000000000"), price)).toBeCloseTo(0.1846, 3); // 0.05 METIS
    expect(metisPriceUsdcBase(BigInt(0), RESERVE_USDC)).toBe(BigInt(0));
  });

  it("measures price impact including the pool fee: a $10 swap is about the fee, a pool-sized one is refused territory", () => {
    const ten = BigInt(10_000_000);
    const small = priceImpactBps({ amountIn: ten, amountOut: v2Out(ten, RESERVE_USDC, RESERVE_METIS), reserveIn: RESERVE_USDC, reserveOut: RESERVE_METIS });
    expect(small).toBeGreaterThanOrEqual(30); // the 0.3% fee
    expect(small).toBeLessThanOrEqual(32); // plus ~0.01% of depth
    const huge = BigInt(20_000_000_000); // $20k into an $81k side
    const big = priceImpactBps({ amountIn: huge, amountOut: v2Out(huge, RESERVE_USDC, RESERVE_METIS), reserveIn: RESERVE_USDC, reserveOut: RESERVE_METIS });
    expect(big).toBeGreaterThan(1_500);
    expect(priceImpactBps({ amountIn: BigInt(0), amountOut: BigInt(0), reserveIn: RESERVE_USDC, reserveOut: RESERVE_METIS })).toBe(10_000);
  });
});
