import { describe, expect, it } from "vitest";

import { normalizeForChain, sameChainAddress } from "./chain-address";
import { STARKNET_MAINNET_KEY, GOAT_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";

/**
 * GRANTS AND GIGS PAY A NAMED PERSON, so the allowlist is the one gate standing between that
 * person and their money.
 *
 * Membership was a raw string match and the tester binding ran viem's `getAddress`. Both are right
 * for EVM and wrong for a felt: the same Starknet address has many spellings differing only in
 * leading zeros, so an invited recipient would be refused from the very grant they were named on —
 * and `getAddress` would have thrown before even that. The failure lands on the person who did the
 * work, not the founder who set it up.
 */

const EVM = "0x3a60aF43c67dd9D552f180d30d9A042948078341";
const SN_PADDED = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";
const SN_BARE = "0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

/** How the allowlist is stored, and how membership is tested — the two must agree. */
const store = (w: string, chainId: number) => {
  try {
    return normalizeForChain(w, chainId);
  } catch {
    return w.toLowerCase();
  }
};
const isMember = (list: string[], w: string) => list.some((a) => sameChainAddress(a, w));

describe("an invited Starknet recipient", () => {
  it("is admitted when their wallet returns the other padding", () => {
    const list = [store(SN_PADDED, STARKNET_MAINNET_KEY)];
    expect(isMember(list, SN_BARE)).toBe(true);
    expect(isMember(list, SN_PADDED)).toBe(true);
  });

  it("is admitted when the founder NAMED the unpadded form", () => {
    const list = [store(SN_BARE, STARKNET_MAINNET_KEY)];
    expect(isMember(list, SN_PADDED)).toBe(true);
  });

  it("can have a claim built for them at all", () => {
    // viem throws here; that was the first thing to fail, before the allowlist even mattered.
    expect(() => normalizeForChain(SN_PADDED, STARKNET_MAINNET_KEY)).not.toThrow();
  });
});

describe("the gate still holds", () => {
  it("refuses a wallet that is not on the list", () => {
    const list = [store(SN_PADDED, STARKNET_MAINNET_KEY)];
    expect(isMember(list, SN_BARE.replace(/8$/, "9"))).toBe(false);
    expect(isMember(list, EVM)).toBe(false);
  });

  it("refuses everyone when the list is a single unrelated address", () => {
    expect(isMember([store(EVM, GOAT_MAINNET_CHAIN_ID)], SN_PADDED)).toBe(false);
  });

  it("never admits a malformed value", () => {
    expect(isMember(["not-an-address"], "not-an-address")).toBe(false);
    expect(isMember([""], "")).toBe(false);
  });
});

describe("EVM grants are unchanged", () => {
  it("stores and matches an EVM recipient exactly as before", () => {
    const list = [store(EVM, GOAT_MAINNET_CHAIN_ID)];
    expect(list[0]).toBe(EVM); // checksummed by viem, as it always was
    expect(isMember(list, EVM)).toBe(true);
    expect(isMember(list, EVM.toLowerCase())).toBe(true);
  });
});
