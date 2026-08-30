import { describe, expect, it } from "vitest";
import { markerVariants } from "./verifiers";

/**
 * The marker is the ONLY thing binding an artifact to its author on a mission with an empty
 * allow-list, so this is a money check: too strict refuses genuine work, too loose lets one
 * worker claim another's page.
 */
describe("markerVariants", () => {
  const STORED = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
  const PADDED = "0x04F1f6530F84e4A1DB7fa35bAFc313174A2482A54c775C4321487Eb0fE91f434";

  it("matches a felt written either way — the live defect", () => {
    // The wallet shows PADDED; the session stores STORED. Both are one account.
    expect(markerVariants(STORED)).toContain(PADDED.toLowerCase());
    expect(markerVariants(PADDED)).toContain(STORED);
  });

  it("is case-insensitive", () => {
    expect(markerVariants(PADDED).every((v) => v === v.toLowerCase())).toBe(true);
  });

  it("never returns a spelling of a DIFFERENT account", () => {
    const other = "0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";
    for (const v of markerVariants(STORED)) expect(other.includes(v)).toBe(false);
    for (const v of markerVariants(other)) expect(STORED.includes(v)).toBe(false);
  });

  it("leaves a short marker alone — no broad match from a stubby string", () => {
    expect(markerVariants("0x00ab")).toEqual(["0x00ab"]);
    expect(markerVariants("0x0")).toEqual(["0x0"]);
  });

  it("leaves a non-hex marker (handle, nonce) exactly as written", () => {
    expect(markerVariants("sage-nonce-77")).toEqual(["sage-nonce-77"]);
    expect(markerVariants("@someone")).toEqual(["@someone"]);
  });

  it("does not manufacture a 64-char spelling of a 40-char EVM address", () => {
    const evm = "0x0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
    expect(markerVariants(evm).some((v) => v.length === 66)).toBe(false);
    expect(markerVariants(evm)).toContain(evm);
  });
});
