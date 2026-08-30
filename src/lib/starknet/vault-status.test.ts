import { describe, expect, it } from "vitest";
import { CairoCustomEnum } from "starknet";

import { decodeVaultStatus } from "./vault";

/**
 * EVERY VAULT READ AS PAUSED, ALWAYS.
 *
 * The decoder answered 0 — "paused" — for anything arriving as an object, and starknet.js returns
 * a Cairo enum as exactly that. Measured on a real funded vault: `CairoCustomEnum { variant:
 * { Active: {} } }`, decoded as paused, so attach refused a vault the founder had just funded
 * correctly — and the settlement pre-flight would have held every payout for the same reason.
 * One branch closed the entire rail, while blaming the founder's vault.
 */
describe("decodeVaultStatus", () => {
  it("reads the real shape starknet.js returns — the defect", () => {
    // Exactly what the live vault returned.
    expect(decodeVaultStatus(new CairoCustomEnum({ Active: {} }))).toBe(1);
    expect(decodeVaultStatus(new CairoCustomEnum({ Paused: {} }))).toBe(0);
    expect(decodeVaultStatus(new CairoCustomEnum({ Revoked: {} }))).toBe(2);
  });

  it("reads a plain variant map, for older client shapes", () => {
    expect(decodeVaultStatus({ variant: { Active: {} } })).toBe(1);
    expect(decodeVaultStatus({ variant: { Revoked: {} } })).toBe(2);
    // Undefined keys are the inactive variants and must be skipped, not counted.
    expect(decodeVaultStatus({ variant: { Paused: undefined, Active: {}, Revoked: undefined } })).toBe(1);
  });

  it("reads a bare index, which is the wire encoding", () => {
    expect(decodeVaultStatus(BigInt(0))).toBe(0);
    expect(decodeVaultStatus(BigInt(1))).toBe(1);
    expect(decodeVaultStatus(2)).toBe(2);
  });

  it("NEVER guesses paused for something it cannot read", () => {
    // Guessing zero is what caused this: indistinguishable from a genuine refusal, so a broken
    // read looked exactly like a correctly-stopped vault.
    for (const junk of [null, undefined, "nonsense", {}, { variant: {} }, { variant: { Wat: {} } }]) {
      expect(decodeVaultStatus(junk), String(junk)).toBe(-1);
    }
  });

  it("never guesses ACTIVE either — unreadable must not mean permission to pay", () => {
    expect(decodeVaultStatus({ variant: { Unknown: {} } })).not.toBe(1);
  });
});
