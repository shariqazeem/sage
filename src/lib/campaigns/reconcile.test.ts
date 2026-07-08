import { describe, expect, it } from "vitest";
import { reconcileRange } from "./reconcile-range";

describe("reconcileRange", () => {
  it("returns null when nothing new (cursor at or past latest)", () => {
    expect(reconcileRange(100, 100)).toBeNull();
    expect(reconcileRange(120, 100)).toBeNull();
  });

  it("scans from cursor+1 to latest when within range", () => {
    const plan = reconcileRange(100, 150, 1000);
    expect(plan).toEqual({ fromBlock: 101, toBlock: 150, capped: false });
  });

  it("caps the span and flags more remaining", () => {
    const plan = reconcileRange(0, 10_000, 4_000);
    expect(plan).toEqual({ fromBlock: 1, toBlock: 4_000, capped: true });
  });

  it("reconciles incrementally across calls until caught up", () => {
    let cursor = 0;
    const latest = 9_500;
    const range = 4_000;
    const windows: Array<[number, number]> = [];
    for (let i = 0; i < 10; i++) {
      const plan = reconcileRange(cursor, latest, range);
      if (!plan) break;
      windows.push([plan.fromBlock, plan.toBlock]);
      cursor = plan.toBlock;
    }
    expect(windows).toEqual([
      [1, 4_000],
      [4_001, 8_000],
      [8_001, 9_500],
    ]);
    // and once caught up, no more work
    expect(reconcileRange(cursor, latest, range)).toBeNull();
  });

  it("handles the exact-boundary case (one block behind)", () => {
    expect(reconcileRange(99, 100)).toEqual({
      fromBlock: 100,
      toBlock: 100,
      capped: false,
    });
  });
});
