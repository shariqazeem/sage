import { describe, expect, it } from "vitest";
import { decideSwap, maxMetisToSwap, swapAmountsFromLogs } from "./swap";
import { METIS_SWAP_VENUE } from "./swap-venue";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";

/**
 * THE SWAP DECISION, every branch. The pool numbers are the real pool's (24 Oct 2026); the founder
 * reads each refusal, so each is checked for the words that let them act on it.
 */
const GWEI = BigInt(1_000_000_000);
const pool = (amountOut: bigint) => ({
  amountOut,
  reserveIn: BigInt("81186112117"),
  reserveOut: BigInt("21994462839853926227868"),
  metisPrice: BigInt(3_691_200),
  gasPrice: BigInt(12) * GWEI,
});
const METIS = (n: number) => BigInt(Math.round(n * 1e6)) * BigInt(1e12);

describe("decideSwap", () => {
  it("quotes a USDC → METIS swap with the worst case the founder confirms", () => {
    const r = decideSwap({ chainId: 1088, side: "usdc_to_metis", amountIn: BigInt(5_000_000), usdcBase: BigInt(20_000_000), metisWei: METIS(0.05), pool: pool(METIS(1.35)) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.minOut).toBe((METIS(1.35) * BigInt(9_900)) / BigInt(10_000));
    expect(r.quote.venue).toBe("Netswap");
    expect(r.quote.feeWei).toBe((BigInt(320_000) * BigInt(12) * GWEI * BigInt(12)) / BigInt(10));
  });

  it("refuses off Metis, in words", () => {
    const r = decideSwap({ chainId: 5042, side: "usdc_to_metis", amountIn: BigInt(5_000_000), usdcBase: BigInt(20_000_000), metisWei: BigInt(0), pool: pool(BigInt(1)) });
    expect(r).toMatchObject({ ok: false, code: "not_here" });
    expect((r as { message: string }).message).toContain("Metis only");
  });

  it("refuses dust, a balance it doesn't have, and a swap it can't pay the fee for", () => {
    expect(decideSwap({ chainId: 1088, side: "usdc_to_metis", amountIn: BigInt(50_000), usdcBase: BigInt(20_000_000), metisWei: METIS(1), pool: pool(METIS(0.01)) })).toMatchObject({ ok: false, code: "too_small" });
    expect(decideSwap({ chainId: 1088, side: "usdc_to_metis", amountIn: BigInt(30_000_000), usdcBase: BigInt(20_000_000), metisWei: METIS(1), pool: pool(METIS(8)) })).toMatchObject({ ok: false, code: "insufficient" });
    const gas = decideSwap({ chainId: 1088, side: "usdc_to_metis", amountIn: BigInt(5_000_000), usdcBase: BigInt(20_000_000), metisWei: BigInt(0), pool: pool(METIS(1.35)) });
    expect(gas).toMatchObject({ ok: false, code: "gas" });
    expect((gas as { message: string }).message).toContain("Binance");
  });

  it("METIS → USDC leaves room for the fee, and says the most that can be swapped", () => {
    const r = decideSwap({ chainId: 1088, side: "metis_to_usdc", amountIn: METIS(1), usdcBase: BigInt(0), metisWei: METIS(1), pool: pool(BigInt(3_600_000)) });
    expect(r).toMatchObject({ ok: false, code: "insufficient" });
    expect((r as { message: string }).message).toMatch(/the most you can swap is 0\.99/);
  });

  it("refuses a swap that would move the price more than 3%", () => {
    // $10,000 into the $81k side returns far less than the mid price
    const r = decideSwap({ chainId: 1088, side: "usdc_to_metis", amountIn: BigInt(10_000_000_000), usdcBase: BigInt(10_000_000_000), metisWei: METIS(1), pool: pool(METIS(2_400)) });
    expect(r).toMatchObject({ ok: false, code: "impact" });
  });
});

describe("swap all", () => {
  it("keeps this swap's fee and a launch's worth of METIS", () => {
    const fee = METIS(0.005);
    expect(maxMetisToSwap(METIS(1), fee, 1088)).toBe(METIS(1) - fee - METIS(0.05));
    expect(maxMetisToSwap(METIS(0.04), fee, 1088)).toBe(BigInt(0));
  });
});

describe("what actually moved", () => {
  const SWAP = parseAbi(["event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)"]);
  const log = (a0In: bigint, a1In: bigint, a0Out: bigint, a1Out: bigint, address: string = METIS_SWAP_VENUE.pair) => ({
    address,
    topics: encodeEventTopics({ abi: SWAP, eventName: "Swap", args: { sender: METIS_SWAP_VENUE.router, to: METIS_SWAP_VENUE.router } }) as `0x${string}`[],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [a0In, a1In, a0Out, a1Out]),
  });

  it("reads the pair's own Swap event (token0 METIS, token1 USDC) in both directions", () => {
    expect(swapAmountsFromLogs("usdc_to_metis", [log(BigInt(0), BigInt(5_000_000), METIS(1.34), BigInt(0))])).toEqual({ amountIn: BigInt(5_000_000), amountOut: METIS(1.34) });
    expect(swapAmountsFromLogs("metis_to_usdc", [log(METIS(1), BigInt(0), BigInt(0), BigInt(3_650_000))])).toEqual({ amountIn: METIS(1), amountOut: BigInt(3_650_000) });
  });

  it("ignores another contract's event of the same shape", () => {
    expect(swapAmountsFromLogs("usdc_to_metis", [log(BigInt(0), BigInt(1), BigInt(2), BigInt(0), "0x9999999999999999999999999999999999999999")])).toBeNull();
  });
});
