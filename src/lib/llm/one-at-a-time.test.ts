import { describe, it, expect } from "vitest";

/**
 * THE CAP-1 QUEUE — the gateway key answers a second concurrent request with
 * 429 "Access key quota exceeded (cap 1)". This mirrors the queue in complete.ts so the ordering
 * guarantee is covered without reaching the network.
 */
function makeQueue() {
  let chain: Promise<unknown> = Promise.resolve();
  return function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
}

describe("one LLM request at a time", () => {
  it("never runs two callers concurrently", async () => {
    const q = makeQueue();
    let inFlight = 0;
    let maxInFlight = 0;
    const call = () =>
      q(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return true;
      });
    await Promise.all([call(), call(), call(), call()]);
    expect(maxInFlight).toBe(1);
  });

  it("preserves call order", async () => {
    const q = makeQueue();
    const seen: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) => q(async () => { await new Promise((r) => setTimeout(r, 6 - n)); seen.push(n); })),
    );
    expect(seen).toEqual([1, 2, 3]);
  });

  it("a failure releases the slot instead of wedging the queue", async () => {
    const q = makeQueue();
    await expect(q(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(q(async () => "recovered")).resolves.toBe("recovered");
  });
});
