import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { METIS_SWAP_VENUE, SWAP_DEADLINE_SECONDS, swapPath } from "@/lib/treasury/swap-venue";
import { SWAP_METIS_FOR_TOKENS_ABI, SWAP_TOKENS_FOR_METIS_ABI } from "@/lib/privy/swap-policy";
import { ownWalletSwapCalls, parseSwapAmount, swapQuoteJson } from "./swap";

/**
 * Swapping from your own wallet: the calls pay only the person who signs them, the router enforces the
 * quoted minimum, and the amount typed is read exactly or not at all.
 */

const ME = "0x5555555555555555555555555555555555555555";
const NOW = 1_795_000_000;
const ONE_METIS = BigInt("1000000000000000000");

describe("parseSwapAmount", () => {
  it("reads METIS in 18 decimals and USDC in 6", () => {
    expect(parseSwapAmount("metis_to_usdc", "1.5")).toBe(ONE_METIS + ONE_METIS / BigInt(2));
    expect(parseSwapAmount("usdc_to_metis", "20")).toBe(BigInt(20_000_000));
    expect(parseSwapAmount("usdc_to_metis", "0.10")).toBe(BigInt(100_000));
  });

  it("refuses what it can't read exactly", () => {
    for (const bad of ["", "abc", "-1", "1e3", "0", "0.0", "1.2.3", " ", "1.1234567"]) {
      expect(parseSwapAmount("usdc_to_metis", bad)).toBeNull();
    }
    expect(parseSwapAmount("metis_to_usdc", 5 as unknown as string)).toBeNull();
  });
});

describe("ownWalletSwapCalls", () => {
  it("METIS to USDC: one router call that sends the METIS and pays only the signer", () => {
    const calls = ownWalletSwapCalls({ side: "metis_to_usdc", amountIn: ONE_METIS, minOut: BigInt(17_000_000) }, ME, NOW);
    expect(calls).toHaveLength(1);
    const [swap] = calls;
    expect(swap.to).toBe(METIS_SWAP_VENUE.router);
    expect(swap.value).toBe(ONE_METIS);
    const d = decodeFunctionData({ abi: SWAP_METIS_FOR_TOKENS_ABI, data: swap.data });
    expect(d.functionName).toBe("swapExactMetisForTokens");
    const [minOut, path, to, deadline] = d.args as readonly [bigint, readonly string[], string, bigint];
    expect(minOut).toBe(BigInt(17_000_000));
    expect(path).toEqual(swapPath("metis_to_usdc"));
    expect(to.toLowerCase()).toBe(ME);
    expect(deadline).toBe(BigInt(NOW + SWAP_DEADLINE_SECONDS));
  });

  it("USDC to METIS: approve exactly the amount to the router, then swap to the signer", () => {
    const calls = ownWalletSwapCalls({ side: "usdc_to_metis", amountIn: BigInt(5_000_000), minOut: ONE_METIS / BigInt(4) }, ME, NOW);
    expect(calls.map((c) => c.label)).toEqual(["approve", "swap"]);
    const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0].data });
    expect(calls[0].to).toBe(METIS_SWAP_VENUE.usdc);
    expect(approve.args).toEqual([METIS_SWAP_VENUE.router, BigInt(5_000_000)]);
    const swap = decodeFunctionData({ abi: SWAP_TOKENS_FOR_METIS_ABI, data: calls[1].data });
    const [amountIn, minOut, , to] = swap.args as readonly [bigint, bigint, readonly string[], string, bigint];
    expect(amountIn).toBe(BigInt(5_000_000));
    expect(minOut).toBe(ONE_METIS / BigInt(4));
    expect(to.toLowerCase()).toBe(ME);
    expect(calls.every((c) => c.value === BigInt(0))).toBe(true);
  });

  it("refuses a recipient that is not an address", () => {
    expect(() => ownWalletSwapCalls({ side: "metis_to_usdc", amountIn: ONE_METIS, minOut: BigInt(1) }, "not-an-address", NOW)).toThrow();
  });
});

describe("swapQuoteJson", () => {
  it("writes every amount as a decimal string", () => {
    const j = swapQuoteJson({ side: "metis_to_usdc", amountIn: ONE_METIS, amountOut: BigInt(18_000_000), minOut: BigInt(17_820_000), slippageBps: 100, priceImpactBps: 12, metisPriceUsdcBase: BigInt(18_100_000), feeWei: BigInt(1000), venue: "Netswap" });
    expect(j).toMatchObject({ amountIn: ONE_METIS.toString(), minOut: "17820000", feeWei: "1000", venue: "Netswap" });
  });
});
