import { describe, expect, it } from "vitest";
import { isTestnetChain, reward } from "@/lib/format";
import {
  chainConfig,
  chainLabel,
  DEFAULT_CHAIN_ID,
  explorerAddressUrl,
  explorerTxUrl,
  GOAT_USDC,
  isSupportedChain,
  evmChains,
  STARKNET_MAINNET_KEY,
  CHAINS,
  viemChainFor,
} from "./networks";

describe("networks — chainId registry", () => {
  it("resolves Metis Sepolia (59902) and GOAT mainnet (2345)", () => {
    expect(chainConfig(59902).key).toBe("metis-sepolia");
    expect(chainConfig(59902).isMainnet).toBe(false);
    expect(chainConfig(59902).gas).toBe("legacy");

    const goat = chainConfig(2345);
    expect(goat.key).toBe("goat");
    expect(goat.isMainnet).toBe(true);
    expect(goat.chipLabel).toBe("GOAT Mainnet");
    expect(goat.gas).toBe("eip1559-fallback");
    expect(goat.nativeSymbol).toBe("BTC");
    expect(goat.usdcAddress).toBe(GOAT_USDC);
  });

  it("falls back to 59902 for unknown / missing chainId", () => {
    expect(DEFAULT_CHAIN_ID).toBe(59902);
    expect(chainConfig(undefined).chainId).toBe(59902);
    expect(chainConfig(null).chainId).toBe(59902);
    expect(chainConfig(999999).chainId).toBe(59902);
    expect(isSupportedChain(2345)).toBe(true);
    expect(isSupportedChain(999999)).toBe(false);
  });

  it("builds explorer links per chain (tx + address)", () => {
    expect(explorerTxUrl(2345, "0xabc")).toBe("https://explorer.goat.network/tx/0xabc");
    expect(explorerAddressUrl(2345, "0xdef")).toBe(
      "https://explorer.goat.network/address/0xdef",
    );
    expect(explorerTxUrl(59902, "0x1")).toBe(
      "https://sepolia-explorer.metisdevops.link/tx/0x1",
    );
    // unknown chain → default (Sepolia) explorer
    expect(explorerTxUrl(undefined, "0x1")).toContain("sepolia-explorer.metisdevops.link");
  });

  it("labels the network chip per chain", () => {
    expect(chainLabel(2345)).toBe("GOAT Mainnet");
    expect(chainLabel(59902)).toBe("Metis Sepolia");
    expect(chainLabel(undefined)).toBe("Metis Sepolia");
  });

  it("builds a viem chain with the right id + native symbol", () => {
    expect(viemChainFor(2345).id).toBe(2345);
    expect(viemChainFor(2345).nativeCurrency.symbol).toBe("BTC");
    expect(viemChainFor(59902).id).toBe(59902);
    expect(viemChainFor(59902).nativeCurrency.symbol).toBe("METIS");
  });
});

describe("Starknet in the registry", () => {
  /**
   * THE BUG THIS EXISTS FOR. A campaign settled on Starknet used to inherit the Metis Sepolia
   * default, so a real USDC payout rendered as "0.10 test mUSDC" — telling a worker the money they
   * had actually been paid was a valueless test token.
   */
  it("renders real Starknet payouts as money, not test tokens", () => {
    expect(isTestnetChain(STARKNET_MAINNET_KEY)).toBe(false);
    expect(chainConfig(STARKNET_MAINNET_KEY).isMainnet).toBe(true);
    // The exact string a worker saw: $0.10 of real USDC, not "0.10 test mUSDC".
    expect(reward(100_000, STARKNET_MAINNET_KEY)).toBe("$0.10");
    expect(reward(100_000, 59902)).toBe("0.10 test mUSDC");
  });

  /**
   * It is in the registry for amounts, labels and explorer links — NOT as somewhere viem can go.
   * Anything reaching for a client must filter on `evm`, or it will build one against a Starknet
   * RPC and fail in a way that looks like a network problem.
   */
  it("is marked non-EVM, and every other chain is marked EVM", () => {
    expect(chainConfig(STARKNET_MAINNET_KEY).evm).toBe(false);
    for (const c of Object.values(CHAINS)) {
      if (c.key !== "starknet") expect(c.evm).toBe(true);
    }
  });

  it("is excluded from the EVM chain list a picker or a client would use", () => {
    expect(evmChains().some((c) => c.key === "starknet")).toBe(false);
    expect(evmChains().length).toBe(Object.keys(CHAINS).length - 1);
  });

  it("points at a Starknet explorer, so a receipt link actually resolves", () => {
    // Starkscan, not Voyager, since 2026-08-30: Sage's own mainnet transactions are linked from
    // there — including the hackathon leaderboard entries — so a receipt and the record it belongs
    // to point at the same explorer rather than two. The check that MATTERS is unchanged: this is
    // a Starknet explorer, not an EVM one, so the link resolves at all.
    const url = chainConfig(STARKNET_MAINNET_KEY).explorerUrl;
    expect(url).toBe("https://starkscan.co");
    expect(url).not.toContain("etherscan");
  });
});
