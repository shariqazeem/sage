import { describe, expect, it } from "vitest";

import { founderChain, founderStorageKey, normalizeFounder, sameFounder } from "./founder";

const EVM = "0x3a60aF43c67dd9D552f180d30d9A042948078341";
const SN = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";
const SN_UNPADDED = "0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

describe("sameFounder", () => {
  it("matches an EVM address however it is cased", () => {
    // The behaviour every existing ownership check relied on must survive unchanged.
    expect(sameFounder(EVM, EVM.toLowerCase())).toBe(true);
    expect(sameFounder(EVM.toUpperCase().replace("0X", "0x"), EVM)).toBe(true);
  });

  it("matches a Starknet address across paddings — the bug this exists to prevent", () => {
    // A wallet may return either spelling of the same felt. String equality would admit a founder
    // to their own campaign on Monday and lock them out on Tuesday.
    expect(sameFounder(SN, SN_UNPADDED)).toBe(true);
    expect(sameFounder(SN_UNPADDED, SN)).toBe(true);
    expect(sameFounder(`0x000${SN_UNPADDED.slice(2)}`, SN)).toBe(true);
  });

  it("does NOT match two different people", () => {
    expect(sameFounder(EVM, SN)).toBe(false);
    expect(sameFounder(SN, SN.replace(/8$/, "9"))).toBe(false);
  });

  it("refuses anything that is not an address, rather than matching loosely", () => {
    for (const bad of ["", "anonymous", "0x", "0xzz", "notanaddress", null, undefined]) {
      expect(sameFounder(bad, bad as string)).toBe(false);
    }
    // Two nulls are not "the same founder" — that would make an unauthenticated caller the owner.
    expect(sameFounder(null, null)).toBe(false);
    expect(sameFounder(undefined, undefined)).toBe(false);
  });

  it("refuses a value too wide to be a felt", () => {
    expect(normalizeFounder(`0x${"f".repeat(64)}`)).toBeNull();
    expect(sameFounder(`0x${"f".repeat(64)}`, `0x${"f".repeat(64)}`)).toBe(false);
  });

  it("ignores surrounding whitespace, which a paste can carry", () => {
    expect(sameFounder(`  ${EVM}  `, EVM)).toBe(true);
  });
});

describe("normalizeFounder", () => {
  it("produces one canonical spelling per address", () => {
    expect(normalizeFounder(SN)).toBe(normalizeFounder(SN_UNPADDED));
    expect(normalizeFounder(EVM)).toBe(EVM.toLowerCase());
  });

  it("never returns a value that could be mistaken for an absent one", () => {
    expect(normalizeFounder("0x0")).toBeNull(); // strips to nothing
    expect(normalizeFounder("0x")).toBeNull();
  });
});

describe("founderChain", () => {
  it("tells the two families apart for display", () => {
    expect(founderChain(EVM)).toBe("evm");
    expect(founderChain(SN)).toBe("starknet");
    expect(founderChain("nonsense")).toBeNull();
  });

  it("is a display hint only — authorisation never consults it", () => {
    // Pinned deliberately: if this ever became part of an ownership check, an address whose
    // padding changed its apparent family would change who owns a campaign.
    expect(sameFounder(SN, SN_UNPADDED)).toBe(true);
    expect(founderChain(SN)).toBe(founderChain(SN_UNPADDED));
  });
});

describe("founderStorageKey", () => {
  it("leaves an EVM address exactly as it was stored before — padding intact", () => {
    // The compatibility guarantee. Roughly one address in sixteen starts with a zero, and every
    // existing row was written with `toLowerCase()` only. Stripping now would orphan those jobs
    // behind an indexed lookup that no longer matches.
    const leadingZero = "0x0A60aF43c67dd9D552f180d30d9A042948078341";
    expect(founderStorageKey(leadingZero)).toBe(leadingZero.toLowerCase());
    expect(founderStorageKey(EVM)).toBe(EVM.toLowerCase());
  });

  it("canonicalises a Starknet address, so a padded and an unpadded write land on one row", () => {
    // An indexed equality matches bytes, so the two spellings must agree BEFORE they reach SQL.
    expect(founderStorageKey(SN)).toBe(founderStorageKey(SN_UNPADDED));
  });

  it("agrees with sameFounder — a stored key still matches the address it came from", () => {
    for (const a of [EVM, SN, SN_UNPADDED, "0x0A60aF43c67dd9D552f180d30d9A042948078341"]) {
      expect(sameFounder(founderStorageKey(a), a)).toBe(true);
    }
  });
});
