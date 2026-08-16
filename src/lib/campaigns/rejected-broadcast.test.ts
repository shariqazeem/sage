import { describe, it, expect } from "vitest";
import { definitivelyNotBroadcast } from "./vault-strategy";

/**
 * A REJECTED TRANSACTION IS NOT AN AMBIGUOUS ONE.
 *
 * Measured on prod 2026-08-16: six payouts settled in quick succession, a seventh had reserved
 * nonce 103 at preflight, and by the time it broadcast the account had moved past it. The node
 * refused it outright — "Nonce provided for the transaction (103) is lower than the current nonce
 * of the account" — yet the attempt was parked as ambiguous, and a tester who had cleared the bar
 * waited behind a nonce that no longer existed.
 *
 * The default must stay "assume it might have landed": paying somebody twice is far worse than
 * paying them late. So this is a small allowlist of refusals the node states plainly, and
 * everything else — including a bare timeout — remains ambiguous and gets reconciled.
 */
describe("definitivelyNotBroadcast", () => {
  it("recognises the exact error that parked a real payout", () => {
    expect(
      definitivelyNotBroadcast(
        new Error("Nonce provided for the transaction (103) is lower than the current nonce of the account."),
      ),
    ).toBe(true);
  });

  it("recognises the standard node phrasings", () => {
    for (const m of ["nonce too low", "replacement transaction underpriced", "transaction underpriced"]) {
      expect(definitivelyNotBroadcast(new Error(m))).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(definitivelyNotBroadcast(new Error("NONCE TOO LOW"))).toBe(true);
  });

  it("a TIMEOUT stays ambiguous — the tx may well have landed", () => {
    expect(definitivelyNotBroadcast(new Error("request timed out"))).toBe(false);
  });

  it("a generic RPC failure stays ambiguous", () => {
    expect(definitivelyNotBroadcast(new Error("RPC Request failed."))).toBe(false);
  });

  it("an out-of-gas revert stays ambiguous — that tx DID land", () => {
    expect(definitivelyNotBroadcast(new Error("out of gas: not enough gas for reentrancy sentry"))).toBe(false);
  });

  it("a non-Error value never throws and never claims certainty", () => {
    expect(definitivelyNotBroadcast(undefined)).toBe(false);
    expect(definitivelyNotBroadcast({ weird: true })).toBe(false);
  });
});
