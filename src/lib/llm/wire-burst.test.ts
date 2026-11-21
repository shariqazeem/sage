import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BURST_RETRIES, CAP_RETRIES, closedProviders, postChat, resetWireMemory, withSlot } from "./wire";

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

  it("a key at its stated cap (calls in flight) is learned AND waited out, longer than a burst", async () => {
    resetWireMemory();
    const capped = () => new Response(JSON.stringify({ error: { message: "Access key quota exceeded (cap 3)" } }), { status: 429, headers: { "retry-after": "0" } });
    const s = sequence(capped, capped, capped, capped, ok);
    const r = await postChat(P, { messages: [{ role: "user", content: "hi" }] }, { timeoutMs: 120_000, fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(true);
    expect(s.calls()).toBe(CAP_RETRIES + 1);
    // and the wire never runs more than the stated cap at once from then on
    let inFlight = 0;
    let max = 0;
    await Promise.all(Array.from({ length: 6 }, () => withSlot(P, "background", async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((res) => setTimeout(res, 5));
      inFlight--;
    })));
    expect(max).toBe(3);
  });

  it("a key still at its cap after every wait is SPENT: closed, 402 now, and 402 at once after", async () => {
    resetWireMemory();
    const capped = () => new Response(JSON.stringify({ error: { message: "Access key quota exceeded (cap 3)" } }), { status: 429, headers: { "retry-after": "0" } });
    const s = sequence(capped);
    const r = await postChat(P, { messages: [{ role: "user", content: "design the missions" }] }, { timeoutMs: 600_000, fetchImpl: s.fetchImpl });
    expect(r.status).toBe(402);
    expect(r.outOfCredit).toBe(true);
    expect(s.calls()).toBe(CAP_RETRIES + 1);
    expect(closedProviders()).toEqual([expect.objectContaining({ host: P.host, message: "Access key quota exceeded (cap 3)" })]);
    // the next caller is answered from memory: no network call, no minutes spent waiting
    const again = await postChat(P, { messages: [{ role: "user", content: "judge this" }] }, { timeoutMs: 600_000, fetchImpl: s.fetchImpl });
    expect(again.status).toBe(402);
    expect(s.calls()).toBe(CAP_RETRIES + 1);
  });

  it("a call whose budget cut the waits short concludes nothing: its 429, and the key stays open", async () => {
    resetWireMemory();
    const capped = () => new Response(JSON.stringify({ error: { message: "Access key quota exceeded (cap 3)" } }), { status: 429 });
    const s = sequence(capped);
    const r = await postChat(P, { messages: [{ role: "user", content: "hi" }] }, { timeoutMs: 6_000, fetchImpl: s.fetchImpl });
    expect(r.status).toBe(429);
    expect(s.calls()).toBe(1);
    expect(closedProviders()).toEqual([]);
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
