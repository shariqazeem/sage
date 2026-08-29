import { describe, expect, it } from "vitest";

import { MAX_BATCH, validateBatch, type PayoutLeg } from "./claims";

const leg = (over: Partial<PayoutLeg> = {}): PayoutLeg => ({
  claimCommitment: "111",
  refundCommitment: "222",
  amountBase: BigInt(1_400_000),
  ...over,
});

const NOW = 1_756_000_000;
const LATER = 1_756_600_000;

describe("batch rules", () => {
  it("accepts a refundable batch with a future expiry", () => {
    expect(() =>
      validateBatch([leg(), leg({ claimCommitment: "333", refundCommitment: "444" })], LATER, NOW),
    ).not.toThrow();
  });

  it("accepts an irrevocable batch with no expiry", () => {
    expect(() => validateBatch([leg({ refundCommitment: null })], 0, NOW)).not.toThrow();
  });

  it("refuses an empty batch", () => {
    expect(() => validateBatch([], 0, NOW)).toThrow(/nothing to escrow/);
  });

  it("refuses a batch over the contract's own limit", () => {
    const legs = Array.from({ length: MAX_BATCH + 1 }, (_, i) =>
      leg({ claimCommitment: String(i), refundCommitment: null }),
    );
    expect(() => validateBatch(legs, 0, NOW)).toThrow(/exceeds the 32-leg limit/);
    // The documented ceiling itself must pass — a limit that fails at its own boundary is an
    // off-by-one that would silently cap a real payout run at 31.
    expect(() => validateBatch(legs.slice(0, MAX_BATCH), 0, NOW)).not.toThrow();
  });

  it("refuses a zero or negative payout", () => {
    expect(() => validateBatch([leg({ amountBase: BigInt(0) })], LATER, NOW)).toThrow(
      /positive amount/,
    );
  });

  /**
   * Two legs sharing a commitment means two workers were handed the same link: whoever collects
   * first takes both payouts, and the second worker's evidence was judged and approved for nothing.
   * The contract reverts the batch; this names why.
   */
  it("refuses two payouts behind one commitment", () => {
    expect(() => validateBatch([leg(), leg({ refundCommitment: "999" })], LATER, NOW)).toThrow(
      /share a claim commitment/,
    );
  });

  /**
   * The contract takes one expiry for the whole batch, so mixing is not a style question: the
   * irrevocable legs would be handed the refundable legs' expiry.
   */
  it("refuses a batch that mixes refundable and irrevocable legs", () => {
    expect(() =>
      validateBatch([leg(), leg({ claimCommitment: "333", refundCommitment: null })], LATER, NOW),
    ).toThrow(/entirely refundable or entirely irrevocable/);
  });

  it("refuses an expiry that has already passed", () => {
    expect(() => validateBatch([leg()], NOW - 1, NOW)).toThrow(/expiry in the future/);
    expect(() => validateBatch([leg()], NOW, NOW)).toThrow(/expiry in the future/);
  });

  it("refuses an expiry on a batch that has no way back", () => {
    // Silently accepting this would look like a refund path that never opens.
    expect(() => validateBatch([leg({ refundCommitment: null })], LATER, NOW)).toThrow(
      /must pass expiry 0/,
    );
  });
});
