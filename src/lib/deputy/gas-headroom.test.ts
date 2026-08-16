import { describe, it, expect } from "vitest";

/**
 * NEVER BROADCAST A PAYOUT AT THE BARE ESTIMATE.
 *
 * `requestPayout` writes storage behind a reentrancy guard whose sentry is charged LAST, so an
 * estimate that is even slightly low does not cost extra gas — it REVERTS the payout with "out of
 * gas: not enough gas for reentrancy sentry". Measured on prod 2026-08-16, tx 0x378bf6…4138: a
 * tester who had cleared the bar went unpaid for exactly that, because the estimate came from an
 * endpoint whose numbers ran low.
 *
 * Estimates vary by node, by state, and by whether a storage slot is cold. Treating one as exact is
 * the mistake; unused gas is refunded, so headroom costs nothing but an inflated limit.
 */
const withHeadroom = (est: bigint) => (est * BigInt(3)) / BigInt(2);

describe("gas headroom on vault writes", () => {
  it("adds 50% to the estimate", () => {
    expect(withHeadroom(BigInt(100_000))).toBe(BigInt(150_000));
  });

  it("the measured failure would now pass: a 20% under-estimate still clears the true cost", () => {
    const actuallyNeeded = BigInt(120_000);
    const lowEstimate = BigInt(100_000); // what the low-balling endpoint returned
    expect(lowEstimate < actuallyNeeded).toBe(true); // this is what reverted
    expect(withHeadroom(lowEstimate) >= actuallyNeeded).toBe(true); // this does not
  });

  it("rounds down rather than up — never inflates beyond the multiplier", () => {
    expect(withHeadroom(BigInt(3))).toBe(BigInt(4));
  });

  it("is monotonic: a bigger estimate never yields a smaller limit", () => {
    let prev = BigInt(0);
    for (const e of [1_000, 21_000, 100_000, 5_000_000].map(BigInt)) {
      const g = withHeadroom(e);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
  });
});
