import { describe, expect, it } from "vitest";
import { founderAddressForm, founderStorageKey, normalizeFounder, sameFounder } from "./founder";

/**
 * ONE PERSON, ONE KEY.
 *
 * `normalizeFounder` is the COMPARISON form and strips leading zeros — right when both sides are
 * stripped together, wrong the moment the result becomes a database key. About one EVM address in
 * sixteen begins with `0x0`, and the session resolver was handing the stripped 39-digit string to
 * `founderStorageKey`, which is written specifically to preserve EVM padding and so never saw it.
 *
 * Measured on prod 2026-09-05: a workspace owned by `0x4ca1a9d6…` whose owner is really
 * `0x04ca1a9d6…`, and one operator wallet filed under BOTH `0x0def3d…` and `0xdef3d…`.
 */
const PADDED = "0x04ca1a9d6d6a118cdf9f116087b90d6192c99237";
const FELT = "0x04f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";

describe("founderAddressForm — the form a key is written in", () => {
  it("keeps an EVM address whole, leading zeros and all", () => {
    expect(founderAddressForm(PADDED)).toBe(PADDED);
    expect(founderAddressForm(PADDED.toUpperCase().replace("0X", "0x"))).toBe(PADDED);
  });

  it("is what founderStorageKey needs, so the round trip is the address itself", () => {
    expect(founderStorageKey(founderAddressForm(PADDED)!)).toBe(PADDED);
  });

  it("still canonicalises a felt, which genuinely has no fixed width", () => {
    expect(founderAddressForm(FELT)).toBe(normalizeFounder(FELT));
    expect(founderAddressForm(FELT)).toBe(`0x${FELT.slice(2).replace(/^0+/, "")}`);
  });

  it("rejects what normalizeFounder rejects — validation is unchanged", () => {
    for (const bad of ["", "not-an-address", "0x", "0xzz", null, undefined, `0x${"f".repeat(70)}`]) {
      expect(founderAddressForm(bad)).toBeNull();
    }
  });

  it("comparison is untouched: the two spellings are still the same founder", () => {
    expect(sameFounder(PADDED, "0x4ca1a9d6d6a118cdf9f116087b90d6192c99237")).toBe(true);
  });

  it("the old behaviour is the bug: the stripped form is not a 20-byte address", () => {
    const stripped = normalizeFounder(PADDED)!;
    expect(stripped).not.toBe(PADDED);
    expect(stripped.slice(2)).toHaveLength(39);
    // and it is what would have been written as the key
    expect(founderStorageKey(stripped)).not.toBe(PADDED);
  });
});
