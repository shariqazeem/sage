import { describe, it, expect } from "vitest";
import { runPromotionEval, type CallOutcome, type Checkpoint, type PromotionRunnerOptions } from "./promotion-runner";

/**
 * The promotion runner's policy (Gate C item 6) — quota probe, valid-only quota, no-retry-of-model-failure,
 * bounded backoff with Retry-After, budget, checkpoint/resume — proven deterministically with an injected
 * clock, sleep, RNG, and scripted per-call outcomes. No network, no real time.
 */
function harness(outcomes: CallOutcome[], over: Partial<PromotionRunnerOptions> = {}) {
  let clock = 0;
  const sleeps: number[] = [];
  let saved: Checkpoint | null = null;
  let calls = 0;
  const opts: PromotionRunnerOptions = {
    fixtures: [{ id: "a" }, { id: "b" }],
    runsPerFixture: 1,
    runOne: async () => outcomes[calls++] ?? { kind: "valid", costUsd: 0.001 },
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    rng: () => 1, // full jitter → capped exp value (deterministic)
    checkpoint: { load: () => saved, save: (c) => { saved = JSON.parse(JSON.stringify(c)); } },
    ...over,
  };
  return { opts, sleeps: () => sleeps, saved: () => saved, calls: () => calls };
}

describe("promotion runner", () => {
  it("all VALID → conclusive with the full quota", async () => {
    const h = harness([{ kind: "valid", costUsd: 0.002 }, { kind: "valid", costUsd: 0.003 }]);
    const r = await runPromotionEval(h.opts);
    expect(r.status).toBe("conclusive");
    expect(r.conclusive).toBe(true);
    expect(r.validResponses).toBe(2);
    expect(r.requiredResponses).toBe(2);
    expect(r.costUsd).toBeCloseTo(0.005, 6);
  });

  it("QUOTA PROBE: the very first request being 429 stops immediately, no further calls", async () => {
    const h = harness([{ kind: "rate_limited", retryAfterMs: 42_000 }, { kind: "valid" }]);
    const r = await runPromotionEval(h.opts);
    expect(r.status).toBe("quota_blocked");
    expect(r.conclusive).toBe(false);
    expect(r.retryAfterMs).toBe(42_000);
    expect(h.calls()).toBe(1); // did not grind the loop
  });

  it("a later 429 is retried with backoff (honoring Retry-After), then succeeds → conclusive", async () => {
    const h = harness([{ kind: "valid" }, { kind: "rate_limited", retryAfterMs: 7_000 }, { kind: "valid" }]);
    const r = await runPromotionEval(h.opts);
    expect(r.status).toBe("conclusive");
    expect(h.sleeps()).toContain(7_000); // used the Retry-After hint, not the exp backoff
  });

  it("model_failure counts as ANSWERED but does NOT fill the valid quota → incomplete, and is NOT retried", async () => {
    const h = harness([{ kind: "model_failure" }, { kind: "model_failure" }]);
    const r = await runPromotionEval(h.opts);
    expect(r.status).toBe("incomplete");
    expect(r.validResponses).toBe(0);
    expect(r.modelFailures).toBe(2);
    expect(h.calls()).toBe(2); // exactly one call per slot — model failures are never retried
  });

  it("a slot that stays transient exhausts BOUNDED retries → incomplete (never infinite)", async () => {
    const many = Array.from({ length: 20 }, () => ({ kind: "transient" as const }));
    const h = harness(many, { maxRetriesPerSlot: 3 });
    const r = await runPromotionEval(h.opts);
    expect(r.status).toBe("incomplete");
    expect(h.calls()).toBe(4); // initial + 3 retries, then give up
  });

  it("respects a MAX-REQUEST budget", async () => {
    const h = harness([{ kind: "valid" }, { kind: "valid" }], { budget: { maxRequests: 1 } });
    const r = await runPromotionEval(h.opts);
    expect(r.status).toBe("budget_exhausted");
    expect(r.requests).toBe(1);
  });

  it("respects a MAX-COST budget", async () => {
    const h = harness([{ kind: "valid", costUsd: 0.5 }, { kind: "valid", costUsd: 0.5 }], { budget: { maxCostUsd: 0.4 } });
    const r = await runPromotionEval(h.opts);
    expect(r.status).toBe("budget_exhausted"); // after the first $0.5 exceeds $0.4, the second slot is blocked
    expect(r.validResponses).toBe(1);
  });

  it("RESUME skips slots already recorded in the checkpoint", async () => {
    const pre: Checkpoint = { done: [{ fixtureId: "a", run: 0, kind: "valid" }], requests: 1, costUsd: 0.001 };
    const h = harness([{ kind: "valid", costUsd: 0.002 }], { checkpoint: { load: () => pre, save: () => {} } });
    const r = await runPromotionEval(h.opts);
    expect(r.status).toBe("conclusive");
    expect(h.calls()).toBe(1); // only fixture "b" ran; "a" was resumed
    expect(r.validResponses).toBe(2);
  });

  it("checkpoints after every answered slot (so a crash resumes cleanly)", async () => {
    const h = harness([{ kind: "valid" }, { kind: "transient" }]);
    await runPromotionEval({ ...h.opts, maxRetriesPerSlot: 0, fixtures: [{ id: "a" }, { id: "b" }] });
    expect(h.saved()?.done).toEqual([{ fixtureId: "a", run: 0, kind: "valid" }]); // "a" persisted before "b" failed
  });

  it("enforces a minimum interval between requests", async () => {
    const h = harness([{ kind: "valid" }, { kind: "valid" }], { minIntervalMs: 5_000 });
    await runPromotionEval(h.opts);
    expect(h.sleeps()).toContain(5_000); // paced the second request
  });
});
