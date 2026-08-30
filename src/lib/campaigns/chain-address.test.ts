import { describe, expect, it } from "vitest";

import { isChainAddress, normalizeForChain, sameChainAddress } from "./chain-address";
import { GOAT_MAINNET_CHAIN_ID, STARKNET_MAINNET_KEY } from "@/lib/deputy/networks";

const EVM = "0x3a60aF43c67dd9D552f180d30d9A042948078341";
const SN = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";
const SN_BARE = "0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

describe("normalizeForChain", () => {
  it("checksums an EVM address, exactly as before", () => {
    expect(normalizeForChain(EVM.toLowerCase(), GOAT_MAINNET_CHAIN_ID)).toBe(EVM);
  });

  it("canonicalises a felt instead of rejecting it", () => {
    // viem's getAddress throws here, which is the single incompatibility that forked the rail.
    expect(normalizeForChain(SN, STARKNET_MAINNET_KEY)).toBe(SN_BARE);
    expect(normalizeForChain(SN_BARE, STARKNET_MAINNET_KEY)).toBe(SN_BARE);
  });

  it("still refuses nonsense on both families", () => {
    expect(() => normalizeForChain("nope", GOAT_MAINNET_CHAIN_ID)).toThrow();
    expect(() => normalizeForChain("nope", STARKNET_MAINNET_KEY)).toThrow();
    expect(() => normalizeForChain(`0x${"f".repeat(64)}`, STARKNET_MAINNET_KEY)).toThrow();
  });

  it("does not accept a felt as an EVM address", () => {
    expect(() => normalizeForChain(SN, GOAT_MAINNET_CHAIN_ID)).toThrow();
  });
});

describe("sameChainAddress", () => {
  it("matches a felt across paddings — the comparison eqAddr got wrong", () => {
    expect(sameChainAddress(SN, SN_BARE)).toBe(true);
  });

  it("behaves identically to a lower-cased compare for EVM addresses", () => {
    expect(sameChainAddress(EVM, EVM.toLowerCase())).toBe(true);
    expect(sameChainAddress(EVM, "0x0000000000000000000000000000000000000001")).toBe(false);
  });

  it("keeps the zero address comparable, which the guardian check needs", () => {
    expect(sameChainAddress("0x0000000000000000000000000000000000000000", "0x0")).toBe(true);
  });

  it("never says two absent values are the same account", () => {
    expect(sameChainAddress(null, null)).toBe(false);
    expect(sameChainAddress(undefined, undefined)).toBe(false);
    expect(sameChainAddress("nonsense", "nonsense")).toBe(false);
  });
});

describe("isChainAddress", () => {
  it("answers for both families without throwing", () => {
    expect(isChainAddress(EVM, GOAT_MAINNET_CHAIN_ID)).toBe(true);
    expect(isChainAddress(SN, STARKNET_MAINNET_KEY)).toBe(true);
    expect(isChainAddress("nope", STARKNET_MAINNET_KEY)).toBe(false);
    expect(isChainAddress(SN, GOAT_MAINNET_CHAIN_ID)).toBe(false);
  });
});
