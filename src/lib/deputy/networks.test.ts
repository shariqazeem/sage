import { describe, expect, it } from "vitest";
import {
  chainConfig,
  chainLabel,
  DEFAULT_CHAIN_ID,
  explorerAddressUrl,
  explorerTxUrl,
  GOAT_USDC,
  isSupportedChain,
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
