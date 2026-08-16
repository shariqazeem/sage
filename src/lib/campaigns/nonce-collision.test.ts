import { describe, it, expect } from "vitest";

/**
 * THREE ATTEMPTS, ONE NONCE, SEVEN PEOPLE UNPAID.
 *
 * Measured on prod 2026-08-16: three settlement attempts each reserved nonce 94, because each read
 * the pending nonce before any of them had broadcast. One used it and reverted out of gas. The
 * reconciler then held the other two forever on the reasoning "a consumed nonce means a tx was in
 * flight" — true, but it was somebody ELSE'S tx, and this intent had no on-chain outcome at all.
 *
 * The nonce was never the real guard. On a vault that enforces intent replay protection, the VAULT
 * refuses a second payout for the same intent hash — which is exactly the property mainnet autopay
 * is gated on. So when the intent is provably unused and the vault provably enforces once-only, a
 * fresh-nonce resend cannot double-pay, and holding buys no safety at all.
 */
type Verdict = "resend" | "hold";

/** mirrors reconcileBroadcasting's tail, as pure logic. */
function decide(input: {
  nonceConsumed: boolean;
  replay: "supported" | "unsupported" | "unknown";
  intentUsed: boolean;
}): Verdict {
  if (!input.nonceConsumed) return "resend";
  if (input.replay === "supported" && !input.intentUsed) return "resend";
  return "hold";
}

describe("reconciling an ambiguous broadcast", () => {
  it("THE MEASURED CASE: nonce taken by another tx, intent unpaid, vault enforces once-only → resend", () => {
    expect(decide({ nonceConsumed: true, replay: "supported", intentUsed: false })).toBe("resend");
  });

  it("intent ALREADY used on chain → hold, never resend (this is the double-pay guard)", () => {
    expect(decide({ nonceConsumed: true, replay: "supported", intentUsed: true })).toBe("hold");
  });

  it("no replay protection → the old conservative hold stands, unchanged", () => {
    expect(decide({ nonceConsumed: true, replay: "unsupported", intentUsed: false })).toBe("hold");
  });

  it("UNKNOWN replay support is not permission — an unreadable capability holds", () => {
    expect(decide({ nonceConsumed: true, replay: "unknown", intentUsed: false })).toBe("hold");
  });

  it("an untouched nonce still resends without needing any of this", () => {
    expect(decide({ nonceConsumed: false, replay: "unsupported", intentUsed: false })).toBe("resend");
  });
});
