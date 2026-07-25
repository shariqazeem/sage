import { describe, it, expect, vi } from "vitest";
import {
  isTransientLlmError,
  backoffMs,
  withTransientRetry,
  RETRY_BUDGET_MS,
} from "./retry";

/**
 * REGRESSION — production job K5ZGo-QdaUfV. Sage browsed yara.garden for 73 seconds, captured nine
 * real states, and then one model call caught a transient provider error. The founder was shown
 * "Sage couldn't finish this one" and every bit of that work was discarded.
 *
 * The brain did retry — five times across about three seconds, which cannot outlive an outage worth
 * waiting for. These tests pin the two halves of the fix: wait properly for the failures that are
 * worth waiting for, and never wait for the ones that aren't.
 */

const err = (msg: string) => new Error(msg);

describe("which failures are worth waiting for", () => {
  it.each([
    "llm_status_429",
    "llm_status_500",
    "llm_status_502",
    "llm_status_503",
    "llm_status_408",
    "The operation was aborted",
    "fetch failed",
    "socket hang up",
    "ECONNRESET",
  ])("%s is transient", (m) => {
    expect(isTransientLlmError(err(m))).toBe(true);
  });

  it.each([
    "llm_status_400",
    "llm_status_401",
    "llm_status_403",
    "llm_unparseable",
    "llm_empty",
    "llm_not_configured",
  ])("%s is NOT transient — waiting cannot fix it", (m) => {
    expect(isTransientLlmError(err(m))).toBe(false);
  });
});

describe("backoff", () => {
  const rand = () => 0;

  it("waits real seconds for a hiccup, growing each time", () => {
    const e = err("llm_status_503");
    expect(backoffMs(0, e, rand)).toBe(1_000);
    expect(backoffMs(1, e, rand)).toBe(3_000);
    expect(backoffMs(2, e, rand)).toBe(7_000);
    // the old ladder spent ~3s across FIVE attempts; one wait now outlasts that
    expect(backoffMs(1, e, rand)).toBeGreaterThan(3_000 - 1);
  });

  it("keeps the old short jitter for a shape failure", () => {
    const e = err("llm_unparseable");
    expect(backoffMs(0, e, rand)).toBe(0);
    expect(backoffMs(1, e, rand)).toBe(250);
    expect(backoffMs(3, e, rand)).toBe(750);
  });

  it("honours a provider's own Retry-After over the schedule", () => {
    const e = Object.assign(err("llm_status_429"), { retryAfterMs: 2_500 });
    expect(backoffMs(0, e, rand)).toBe(2_500);
  });

  it("never waits longer than the ladder's whole budget", () => {
    const e = Object.assign(err("llm_status_429"), { retryAfterMs: 10 * RETRY_BUDGET_MS });
    expect(backoffMs(0, e, rand)).toBeLessThanOrEqual(RETRY_BUDGET_MS);
  });
});

describe("withTransientRetry", () => {
  it("survives a hiccup that would have failed the inspection", async () => {
    let calls = 0;
    const out = await withTransientRetry(
      async () => {
        calls++;
        if (calls < 3) throw err("llm_status_503");
        return "the plan";
      },
      { attempts: 3, budgetMs: 60_000, now: () => 0 },
    );
    expect(out).toBe("the plan");
    expect(calls).toBe(3);
  });

  it("does not retry a failure that waiting cannot fix", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(async () => {
        calls++;
        throw err("llm_unparseable");
      }),
    ).rejects.toThrow("llm_unparseable");
    expect(calls).toBe(1);
  });

  it("surfaces the LAST error, so the founder-facing reason stays truthful", async () => {
    await expect(
      withTransientRetry(
        async () => {
          throw err("llm_status_503");
        },
        { attempts: 2, budgetMs: 60_000, now: () => 0 },
      ),
    ).rejects.toThrow("llm_status_503");
  });

  it("stops when the time budget would be exceeded rather than hanging", async () => {
    let calls = 0;
    // starts at 0, and by the first failure the ladder has nearly spent its budget
    const ticks = [0, 19_500];
    let i = 0;
    const clock = vi.fn(() => ticks[Math.min(i++, ticks.length - 1)]!);
    await expect(
      withTransientRetry(
        async () => {
          calls++;
          throw err("llm_status_503");
        },
        { attempts: 5, budgetMs: RETRY_BUDGET_MS, now: clock },
      ),
    ).rejects.toThrow("llm_status_503");
    expect(calls).toBe(1); // it gave up instead of sleeping past the budget
  });

  it("returns immediately on success — no added latency for the healthy path", async () => {
    let calls = 0;
    const out = await withTransientRetry(async () => {
      calls++;
      return 42;
    });
    expect(out).toBe(42);
    expect(calls).toBe(1);
  });
});
