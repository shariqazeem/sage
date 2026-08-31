import { describe, expect, it } from "vitest";
import { splitForAdvance, WATERFALL_BPS_MAX } from "./waterfall";

const b = (n: number) => BigInt(n);

/** Money math: every property is an invariant, not an example. */
describe("splitForAdvance", () => {
  it("splits exactly — the two legs ARE the reward, to the base unit", () => {
    for (const [reward, out, bps] of [
      [1_000_000, 500_000, 5000],
      [333_333, 1_000_000, 3333],
      [1, 1, 10000],
      [999_999, 250_000, 2500],
      [500_000, 10_000_000, 10000],
    ] as const) {
      const s = splitForAdvance(b(reward), b(out), bps);
      expect(s.repayBase + s.workerBase).toBe(b(reward));
      expect(s.repayBase).toBeGreaterThanOrEqual(b(0));
      expect(s.workerBase).toBeGreaterThanOrEqual(b(0));
    }
  });

  it("never takes more than the outstanding balance — the last payout is not skimmed", () => {
    // $0.50 payout, only $0.10 left on the advance, 100% waterfall: pot gets exactly $0.10.
    const s = splitForAdvance(b(500_000), b(100_000), 10000);
    expect(s.repayBase).toBe(b(100_000));
    expect(s.workerBase).toBe(b(400_000));
    expect(s.remainingBase).toBe(b(0));
  });

  it("never exceeds the published fraction of one payout", () => {
    // 50% waterfall on a $1 payout with a huge balance: exactly half, never a unit more.
    const s = splitForAdvance(b(1_000_000), b(50_000_000), 5000);
    expect(s.repayBase).toBe(b(500_000));
  });

  it("rounding favours the WORKER — floor, so 'at most N%' stays true", () => {
    // 3333 bps of 100 base units = 33.33 → 33 to the pot, 67 to the worker.
    const s = splitForAdvance(b(100), b(1_000_000), 3333);
    expect(s.repayBase).toBe(b(33));
    expect(s.workerBase).toBe(b(67));
  });

  it("a cleared advance takes nothing", () => {
    const s = splitForAdvance(b(1_000_000), b(0), 10000);
    expect(s.repayBase).toBe(b(0));
    expect(s.workerBase).toBe(b(1_000_000));
  });

  it("remaining decreases by exactly what was repaid — repayments always converge", () => {
    let out = b(1_000_000); // $1 advance
    let rounds = 0;
    while (out > b(0) && rounds < 100) {
      const s = splitForAdvance(b(500_000), out, 5000);
      // Convergence needs a non-zero bite whenever balance and reward are non-zero…
      if (s.repayBase === b(0) && out > b(0)) break;
      expect(out - s.repayBase).toBe(s.remainingBase);
      out = s.remainingBase;
      rounds++;
    }
    expect(out).toBe(b(0));
    expect(rounds).toBeLessThan(10);
  });

  it("refuses the shapes that cannot be money", () => {
    expect(() => splitForAdvance(b(-1), b(0), 5000)).toThrow();
    expect(() => splitForAdvance(b(1), b(-1), 5000)).toThrow();
    expect(() => splitForAdvance(b(1), b(1), 0)).toThrow();
    expect(() => splitForAdvance(b(1), b(1), WATERFALL_BPS_MAX + 1)).toThrow();
    expect(() => splitForAdvance(b(1), b(1), 12.5)).toThrow();
  });
});
