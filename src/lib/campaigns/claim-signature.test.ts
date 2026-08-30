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

  it("accepts felts written without the 0x prefix, which some wallets return", () => {
    expect(readClaimSignature("starknet", ["1a2b", "3c4d"])?.signature).toEqual(["1a2b", "3c4d"]);
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
    expect(readClaimSignature("starknet", ["0x1", 2])).toBeNull();
    expect(readClaimSignature("starknet", ["0x1", "0x" + "f".repeat(65)])).toBeNull();
    expect(readClaimSignature("starknet", ["0x1", "not-hex"])).toBeNull();
  });

  it("refuses an EVM signature that is not hex at all", () => {
    expect(readClaimSignature("evm", "deadbeef")).toBeNull();
    expect(readClaimSignature("evm", "0xzz")).toBeNull();
  });
});
