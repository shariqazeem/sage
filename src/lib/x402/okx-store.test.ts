import { describe, expect, it } from "vitest";

import { claimPayment } from "./okx-store";
import type { PaymentAuthorization } from "./okx";

/**
 * ONE AUTHORIZATION BUYS ONE CALL.
 *
 * An EIP-3009 authorization is redeemable exactly once on-chain, so it must buy exactly once here.
 * If it did not, a buyer would pay for a single call and then replay the same signed header
 * indefinitely, which is the cheapest possible way to empty a paid service.
 *
 * Runs against real in-memory SQLite (vitest sets SAGE_DB_PATH=":memory:"), so the primary-key
 * conflict that enforces this is proven by the engine rather than by a read-then-write check that
 * two concurrent requests could both pass.
 */

const auth = (over: Partial<PaymentAuthorization> = {}): PaymentAuthorization => ({
  from: `0x${"a".repeat(40)}`,
  to: `0x${"b".repeat(40)}`,
  value: "50000",
  validAfter: "0",
  validBefore: "1900000000",
  ...over,
});

const claim = (nonce: string, tool = "sage_first_look") =>
  claimPayment({
    nonce,
    tool,
    payer: `0x${"a".repeat(40)}`,
    payTo: `0x${"b".repeat(40)}`,
    auth: auth({ nonce }),
    signature: `0x${"c".repeat(130)}`,
  });

describe("claiming a payment", () => {
  it("succeeds the first time", () => {
    expect(claim(`0x${"01".repeat(32)}`)).toEqual({ claimed: true });
  });

  it("refuses the same authorization a second time, and says why", () => {
    const nonce = `0x${"02".repeat(32)}`;
    expect(claim(nonce).claimed).toBe(true);
    const again = claim(nonce);
    expect(again.claimed).toBe(false);
    if (again.claimed) return;
    expect(again.reason).toMatch(/already been used/i);
  });

  it("refuses a replay even against a different service", () => {
    // Otherwise one authorization would buy every tool in the catalogue.
    const nonce = `0x${"03".repeat(32)}`;
    expect(claim(nonce, "sage_first_look").claimed).toBe(true);
    expect(claim(nonce, "sage_start_inspection").claimed).toBe(false);
  });

  it("lets distinct authorizations each buy their own call", () => {
    expect(claim(`0x${"04".repeat(32)}`).claimed).toBe(true);
    expect(claim(`0x${"05".repeat(32)}`).claimed).toBe(true);
  });
});
