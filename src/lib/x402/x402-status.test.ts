import { describe, expect, it } from "vitest";
import {
  classifyX402Failure,
  deriveStoredX402Status,
  isX402Status,
  x402CountsAsSpend,
  x402StatusLabel,
  X402_STATUSES,
  type X402Status,
} from "./x402-status";

describe("classifyX402Failure — sanitized reason codes only", () => {
  it("maps messages to codes without leaking the raw error", () => {
    expect(classifyX402Failure("insufficient funds for transfer")).toBe(
      "insufficient_payer_balance",
    );
    expect(classifyX402Failure("payer USDC balance too low")).toBe(
      "insufficient_payer_balance",
    );
    expect(classifyX402Failure("request timed out after 30s")).toBe(
      "facilitator_timeout",
    );
    expect(classifyX402Failure("facilitator unavailable (503)")).toBe(
      "payment_unavailable",
    );
    expect(classifyX402Failure("fetch failed: ECONNREFUSED")).toBe(
      "payment_unavailable",
    );
    expect(classifyX402Failure("some weird thing happened")).toBe(
      "unknown_payment_failure",
    );
  });
});

describe("deriveStoredX402Status — legacy reconstruction", () => {
  it("an explicit persisted status passes through", () => {
    for (const s of X402_STATUSES) {
      expect(deriveStoredX402Status(s, null)).toBe(s);
    }
  });
  it("a historical row with a real tx → paid", () => {
    expect(deriveStoredX402Status(null, "0xabc")).toBe("paid");
  });
  it("a historical row with no tx → legacy_unknown (honest, not 'pending')", () => {
    expect(deriveStoredX402Status(null, null)).toBe("legacy_unknown");
  });
  it("an unrecognized stored value falls back to the tx-based derivation", () => {
    expect(deriveStoredX402Status("garbage", "0xabc")).toBe("paid");
    expect(deriveStoredX402Status("garbage", null)).toBe("legacy_unknown");
  });
});

describe("x402 spend accounting", () => {
  it("only a real paid verification counts as spend", () => {
    expect(x402CountsAsSpend("paid")).toBe(true);
    for (const s of ["live_fallback", "not_configured", "not_required", "legacy_unknown"] as X402Status[]) {
      expect(x402CountsAsSpend(s)).toBe(false);
    }
  });
});

describe("labels + guards", () => {
  it("every status has an honest label and none says 'pending merchant'", () => {
    for (const s of X402_STATUSES) {
      const label = x402StatusLabel(s);
      expect(label.length).toBeGreaterThan(0);
      expect(label.toLowerCase()).not.toContain("pending merchant");
    }
  });
  it("isX402Status guards correctly", () => {
    expect(isX402Status("paid")).toBe(true);
    expect(isX402Status("nope")).toBe(false);
    expect(isX402Status(null)).toBe(false);
  });
});
