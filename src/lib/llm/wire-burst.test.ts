import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BURST_RETRIES, postChat, resetWireMemory } from "./wire";

/**
 * A provider's burst limit (CommonStack answers a quick run of calls with 429, then lets the next through)
 * is waited out and re-sent, at most BURST_RETRIES times and inside the call's budget. An empty account is
 * never retried, and a 429 that persists comes back as a 429.
 */
const P = { endpoint: "https://api.example.test/v1/chat/completions", key: "k-1", model: "some-model", host: "api.example.test" };
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
const burst = () => new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "retry-after": "0" } });

function sequence(...answers: (() => Response)[]) {
  let n = 0;
  const fetchImpl = (async () => (answers[Math.min(n++, answers.length - 1)] ?? ok)()) as unknown as typeof fetch;
  return { fetchImpl, calls: () => n };
}

describe("a burst 429", () => {
  it("is waited out and re-sent until the provider answers", async () => {
    resetWireMemory();
    const s = sequence(burst, burst, ok);
    const r = await postChat(P, { messages: [{ role: "user", content: "hi" }] }, { timeoutMs: 60_000, fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(true);
    expect(s.calls()).toBe(3);
  });

  it("comes back as a 429 after the last retry", async () => {
    resetWireMemory();
    const s = sequence(burst);
    const r = await postChat(P, { messages: [{ role: "user", content: "hi" }] }, { timeoutMs: 60_000, fetchImpl: s.fetchImpl });
    expect(r.status).toBe(429);
    expect(s.calls()).toBe(BURST_RETRIES + 1);
  });

  it("never retries an empty account", async () => {
    resetWireMemory();
    const empty = () => new Response(JSON.stringify({ error: { message: "Insufficient available balance: 0" } }), { status: 429 });
    const s = sequence(empty, ok);
    const r = await postChat(P, { messages: [{ role: "user", content: "hi" }] }, { timeoutMs: 60_000, fetchImpl: s.fetchImpl });
    expect(r.status).toBe(402);
    expect(s.calls()).toBe(1);
  });

  it("hands a quota (a long Retry-After) straight back, never sleeping on it", async () => {
    resetWireMemory();
    const quota = () => new Response("{}", { status: 429, headers: { "retry-after": "30" } });
    const s = sequence(quota, ok);
    const r = await postChat(P, { messages: [{ role: "user", content: "hi" }] }, { timeoutMs: 120_000, fetchImpl: s.fetchImpl });
    expect(r.status).toBe(429);
    expect(r.retryAfterMs).toBe(30_000);
    expect(s.calls()).toBe(1);
  });

  it("does not wait past the call's own budget", async () => {
    resetWireMemory();
    const slow = () => new Response("{}", { status: 429, headers: { "retry-after": "8" } });
    const s = sequence(slow, ok);
    const r = await postChat(P, { messages: [{ role: "user", content: "hi" }] }, { timeoutMs: 6_000, fetchImpl: s.fetchImpl });
    expect(r.status).toBe(429);
    expect(s.calls()).toBe(1);
  });
});
