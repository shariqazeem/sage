import { describe, it, expect } from "vitest";
import { campaignFeeBase, isSelfFunded, CAMPAIGN_FEE_PCT } from "./campaign-fee";

const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));

/**
 * THE FIRST MONEY SAGE CHARGES FOR ITSELF.
 *
 * Every other fee in this system was Sage paying its own wallet, so a rounding bug cost nothing. A
 * founder-facing take-rate is different: it is charged to someone else, it appears on their
 * transaction, and it is the number reported as revenue. So the math is integer-only and pinned
 * here before anything that moves money is allowed to depend on it.
 */
describe("campaignFeeBase", () => {
  it("is ten percent of the budget", () => {
    expect(campaignFeeBase(usdc(10))).toBe(usdc(1));
    expect(campaignFeeBase(usdc(50))).toBe(usdc(5));
    expect(campaignFeeBase(usdc(250))).toBe(usdc(25));
  });

  it("matches the declared percentage rather than a hardcoded 10", () => {
    // if someone changes the constant, this stays true — the test tracks intent, not a magic number
    expect(campaignFeeBase(usdc(100))).toBe((usdc(100) * BigInt(CAMPAIGN_FEE_PCT)) / BigInt(100));
  });

  it("never charges below the facilitator's 0.1 USDC minimum", () => {
    // 10% of $0.50 is $0.05, which GOAT physically will not accept — the launch would fail at the
    // payment step for a reason the founder could do nothing about.
    expect(campaignFeeBase(usdc(0.5))).toBe(usdc(0.1));
    expect(campaignFeeBase(usdc(1))).toBe(usdc(0.1)); // exactly the minimum, from both directions
    expect(campaignFeeBase(BigInt(1))).toBe(usdc(0.1));
  });

  it("charges nothing on a zero or negative budget instead of the minimum", () => {
    expect(campaignFeeBase(BigInt(0))).toBe(BigInt(0));
    expect(campaignFeeBase(BigInt(-1))).toBe(BigInt(0));
  });

  it("rounds DOWN, so a rounding error can only ever favour the founder", () => {
    // $10.000009 → 10% is 1.0000009, which cannot be expressed in 6dp. Truncation must not round up.
    const odd = usdc(10) + BigInt(9);
    expect(campaignFeeBase(odd)).toBe((odd * BigInt(10)) / BigInt(100));
    expect(campaignFeeBase(odd)).toBeLessThanOrEqual((odd * BigInt(10)) / BigInt(100));
  });

  it("loses no cent to floating point at awkward budgets", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; this is why the money path is integer-only.
    for (const dollars of [3.33, 7.77, 19.99, 33.31, 99.99]) {
      const b = usdc(dollars);
      expect(campaignFeeBase(b)).toBe(b / BigInt(10));
    }
  });

  it("scales exactly with budget — no drift at large amounts", () => {
    expect(campaignFeeBase(usdc(1_000_000))).toBe(usdc(100_000));
  });
});

describe("isSelfFunded — keeping the revenue number honest", () => {
  const OPS = ["0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3", "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6"];

  it("flags the operator's own wallets", () => {
    expect(isSelfFunded(OPS[0], OPS)).toBe(true);
    expect(isSelfFunded(OPS[1], OPS)).toBe(true);
  });

  it("does NOT flag a third party — this is the revenue that actually counts", () => {
    expect(isSelfFunded("0x1111111111111111111111111111111111111111", OPS)).toBe(false);
  });

  it("ignores case and stray whitespace, because a silent mismatch would book self-funding as revenue", () => {
    expect(isSelfFunded(OPS[0].toLowerCase(), OPS)).toBe(true);
    expect(isSelfFunded(OPS[0].toUpperCase(), OPS)).toBe(true);
    expect(isSelfFunded(`  ${OPS[0]}  `, OPS)).toBe(true);
  });

  it("treats a missing payer as third-party rather than quietly self-funded", () => {
    // erring the other way would let an unattributed payment vanish from the revenue line
    expect(isSelfFunded(null, OPS)).toBe(false);
    expect(isSelfFunded(undefined, OPS)).toBe(false);
    expect(isSelfFunded("", OPS)).toBe(false);
  });

  it("is false when no operator wallets are configured", () => {
    expect(isSelfFunded(OPS[0], [])).toBe(false);
  });
});
