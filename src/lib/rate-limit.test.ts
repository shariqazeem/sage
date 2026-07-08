import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows up to the limit, then blocks within the window", () => {
    const t = 1_000;
    const rl = new RateLimiter(3, 1_000, () => t);
    expect(rl.hit("a").ok).toBe(true); // 1
    expect(rl.hit("a").ok).toBe(true); // 2
    const third = rl.hit("a"); // 3
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
    expect(rl.hit("a").ok).toBe(false); // 4 → blocked
  });

  it("resets after the window elapses", () => {
    let t = 0;
    const rl = new RateLimiter(1, 1_000, () => t);
    expect(rl.hit("a").ok).toBe(true);
    expect(rl.hit("a").ok).toBe(false);
    t = 1_000; // window boundary
    expect(rl.hit("a").ok).toBe(true);
  });

  it("keys are independent", () => {
    const t = 0;
    const rl = new RateLimiter(1, 1_000, () => t);
    expect(rl.hit("a").ok).toBe(true);
    expect(rl.hit("b").ok).toBe(true);
    expect(rl.hit("a").ok).toBe(false);
  });

  it("sweep drops expired buckets", () => {
    let t = 0;
    const rl = new RateLimiter(1, 1_000, () => t);
    rl.hit("a");
    t = 2_000;
    rl.sweep();
    // after sweep the key is fresh again
    expect(rl.hit("a").ok).toBe(true);
  });
});
