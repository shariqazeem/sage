import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Agent } from "undici";
import { postChat, resetWireMemory } from "./wire";

/**
 * Node's fetch cuts a call off when the response headers take more than 300 s, whatever the caller's
 * timer says, and a long reasoning call sends nothing until it is done: a founder's test died that way on
 * 20 Nov 2026. Every chat call carries a dispatcher whose own limits sit above any budget, so the caller's
 * timer is the only clock.
 */
const P = { endpoint: "https://api.example.test/v1/chat/completions", key: "k-1", model: "some-model", host: "api.example.test" };

describe("the long-call dispatcher", () => {
  it("rides on every chat call, and is the same one each time", async () => {
    resetWireMemory();
    const seen: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.push((init as { dispatcher?: unknown } | undefined)?.dispatcher);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await postChat(P, { messages: [{ role: "user", content: "hi" }] }, { timeoutMs: 1000, fetchImpl });
    await postChat(P, { messages: [{ role: "user", content: "hi again" }] }, { timeoutMs: 1000, fetchImpl });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeInstanceOf(Agent);
    expect(seen[1]).toBe(seen[0]);
  });
});
