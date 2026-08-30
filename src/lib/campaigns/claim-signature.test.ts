import { describe, expect, it } from "vitest";
import { readClaimSignature } from "./claim-signature";

/**
 * The route required `typeof signature === "string"`, so an ARRAY — the only shape a Starknet
 * wallet can return — was rejected before any verifier ran, and the recipient was told "A signed
 * evidence commitment is required" about a commitment they had just signed correctly.
 */
describe("reading a claim signature per rail", () => {
  it("accepts the felt array a Starknet account returns", () => {
    expect(readClaimSignature("starknet", ["0x1a2b", "0x3c4d"])).toEqual({
      rail: "starknet",
      signature: ["0x1a2b", "0x3c4d"],
    });
  });

  it("accepts DECIMAL felts, which is what a Starknet wallet actually returns", () => {
    /**
     * THE ONE THAT BROKE THE FIRST REAL SUBMISSION. Ready displayed the commitment correctly, the
     * tester signed it, and the server answered "A signed evidence commitment is required" — the
     * check required hex, and a decimal felt runs to 76 digits, well past its 64-character cap.
     */
    const r = "3618502788666131213697322783095070105623107215331596699973092056135872020480";
    const sig = readClaimSignature("starknet", [r, "12345"]);
    expect(sig?.signature).toEqual([r, "12345"]);
    expect(r.length).toBeGreaterThan(64);
  });

  it("accepts bigints, however the wallet hands them over", () => {
    expect(readClaimSignature("starknet", [BigInt("0x1a2b"), BigInt(4660)])?.signature).toEqual([
      "6699",
      "4660",
    ]);
  });

  it("accepts 0x-prefixed hex too — which spelling arrives is the wallet's choice", () => {
    expect(readClaimSignature("starknet", ["0x1a2b", "0x3c4d"])?.signature).toEqual(["0x1a2b", "0x3c4d"]);
  });

  it("refuses BARE hex containing letters, because it is genuinely ambiguous", () => {
    // "12345" is a valid spelling of both hex and decimal, and reading a hex felt as decimal
    // silently produces a DIFFERENT number — a signature that verifies against nothing. A wallet
    // that means hex says 0x.
    expect(readClaimSignature("starknet", ["3c4d"])).toBeNull();
  });

  it("refuses a JS number — it cannot hold a felt without losing precision", () => {
    expect(readClaimSignature("starknet", [4660])).toBeNull();
  });

  it("refuses a value at or above the field prime — it is not a felt", () => {
    const prime = ((BigInt(1) << BigInt(251)) + BigInt(17) * (BigInt(1) << BigInt(192)) + BigInt(1)).toString();
    expect(readClaimSignature("starknet", [prime])).toBeNull();
  });

  it("accepts the hex string an EVM wallet returns", () => {
    const sig = `0x${"ab".repeat(32)}`;
    expect(readClaimSignature("evm", sig)).toEqual({ rail: "evm", signature: sig });
  });

  it("refuses the OTHER rail's shape on each rail", () => {
    expect(readClaimSignature("evm", ["0x1", "0x2"])).toBeNull();
    expect(readClaimSignature("starknet", "0xdeadbeef")).toBeNull();
  });

  it("refuses an empty or absent signature", () => {
    for (const v of [null, undefined, "", [], {}, 0]) {
      expect(readClaimSignature("starknet", v), `starknet ${String(v)}`).toBeNull();
      expect(readClaimSignature("evm", v), `evm ${String(v)}`).toBeNull();
    }
  });

  it("refuses an array padded with anything that is not a felt", () => {
    // A caller must not be able to hand the account contract a "signature" containing nulls,
    // numbers, or an oversized value.
    expect(readClaimSignature("starknet", ["0x1", null])).toBeNull();
    expect(readClaimSignature("starknet", ["0x1", "not-hex"])).toBeNull();
    expect(readClaimSignature("starknet", ["0x1", "-5"])).toBeNull();
    expect(readClaimSignature("starknet", ["0x1", "1.5"])).toBeNull();
    expect(readClaimSignature("starknet", ["0x1", " "])).toBeNull();
  });

  it("refuses an EVM signature that is not hex at all", () => {
    expect(readClaimSignature("evm", "deadbeef")).toBeNull();
    expect(readClaimSignature("evm", "0xzz")).toBeNull();
  });
});
