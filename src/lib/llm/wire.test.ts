import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postChat, priorityForLane, refusedParameter, resetWireMemory, responseFormatFor, shapeRequest, statedCap, withSlot } from "./wire";
import { profileFor } from "./provider-profile";

/**
 * THE WIRE — one place a model request is shaped, queued and sent (wire.ts).
 *
 * Measured 5 Nov 2026 on Anthropic's own endpoint: `temperature` and `response_format: json_object`, both
 * sent on every Sage call, were each refused with a 400. These tests hold the properties that make
 * the next provider switch a configuration change: the request adapts to what the provider takes,
 * learns what it refuses, never runs more than the key allows, and lets the waiting person go first.
 */
const P = { endpoint: "https://api.example.test/v1/chat/completions", key: "k-1", model: "some-model", host: "api.example.test" };
const realFetch = global.fetch;

beforeEach(() => {
  resetWireMemory();
  delete process.env.LLM_MAX_CONCURRENCY;
});
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.LLM_MAX_CONCURRENCY;
  vi.restoreAllMocks();
});

const okBody = JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });

describe("shaping a request for its provider", () => {
  it("never sends a temperature to a model that refuses one", () => {
    const direct = profileFor("claude-sonnet-5-5", "https://api.anthropic.com/v1");
    expect(direct.id).toBe("anthropic-direct");
    expect(shapeRequest({ host: "api.anthropic.com", model: "claude-sonnet-5-5" }, direct, { temperature: 0.2, model: "m" })).not.toHaveProperty("temperature");
    // through a gateway too: current Claude models take no temperature anywhere
    const viaGateway = profileFor("anthropic/claude-opus-5-5", "https://api.commonstack.ai/v1");
    expect(viaGateway.id).toBe("anthropic-adaptive");
    expect(viaGateway.acceptsTemperature).toBe(false);
  });

  it("keeps the temperature for a model that takes one", () => {
    const old = profileFor("anthropic/claude-haiku-4-5", "https://api.commonstack.ai/v1");
    expect(shapeRequest({ host: "h", model: "anthropic/claude-haiku-4-5" }, old, { temperature: 0.3 })).toMatchObject({ temperature: 0.3 });
  });

  it("asks Anthropic's endpoint for json_schema or nothing — never json_object, which it refuses", () => {
    const direct = profileFor("claude-haiku-5-5", "https://api.anthropic.com/v1");
    expect(responseFormatFor(direct, undefined)).toBeUndefined();
    expect(responseFormatFor(direct, { name: "s", schema: { type: "object" } })).toMatchObject({ type: "json_schema" });
  });

  it("keeps the measured modes for the providers Sage already runs on", () => {
    expect(responseFormatFor(profileFor("MiniMax-M3", ""), { name: "s", schema: {} })).toEqual({ type: "json_object" });
    expect(responseFormatFor(profileFor("google/gemini-3.1-flash-lite", ""), { name: "s", schema: {} })).toMatchObject({ type: "json_schema" });
    // DeepSeek has its own profile now (it used to be read as Gemini because its name has "flash" in it)
    expect(profileFor("deepseek/deepseek-v4-flash", "").id).toBe("deepseek");
  });
});

describe("learning what a provider refuses", () => {
  it("reads the refused parameter from the provider's own words", () => {
    expect(refusedParameter(400, '{"error":{"message":"`temperature` is deprecated for this model."}}', { temperature: 0.2 })).toBe("temperature");
    expect(refusedParameter(400, "response_format.type: Input should be 'json_schema'", { response_format: { type: "json_object" } })).toBe("jsonObject");
    expect(refusedParameter(400, "response_format not supported", { response_format: { type: "json_schema" } })).toBe("responseFormat");
    // a real error is not a parameter refusal: re-sending cannot help, so it surfaces
    expect(refusedParameter(400, "invalid api key", { temperature: 0 })).toBeNull();
    expect(refusedParameter(500, "temperature", { temperature: 0 })).toBeNull();
    // never blame a parameter that was not sent
    expect(refusedParameter(400, "temperature", {})).toBeNull();
  });

  it("re-sends at once without the refused parameter, and remembers it for the next call", async () => {
    const bodies: Record<string, unknown>[] = [];
    global.fetch = vi.fn(async (_u: unknown, init: { body?: string }) => {
      const b = JSON.parse(init.body ?? "{}");
      bodies.push(b);
      if ("temperature" in b) return new Response('{"error":{"message":"`temperature` is deprecated for this model."}}', { status: 400 });
      return new Response(okBody, { status: 200 });
    }) as unknown as typeof fetch;
    const profile = profileFor("unknown-model", "https://api.example.test/v1");
    const first = await postChat(P, { model: P.model, temperature: 0.2, messages: [] }, { timeoutMs: 5_000, profile });
    expect(first.ok).toBe(true);
    expect(bodies).toHaveLength(2); // one refusal, one success
    const second = await postChat(P, { model: P.model, temperature: 0.2, messages: [] }, { timeoutMs: 5_000, profile });
    expect(second.ok).toBe(true);
    expect(bodies).toHaveLength(3); // learned: no refusal round trip the second time
    expect(bodies[2]).not.toHaveProperty("temperature");
  });

  it("does not loop on a provider that refuses something it was never sent", async () => {
    global.fetch = vi.fn(async () => new Response("temperature is broken today", { status: 400 })) as unknown as typeof fetch;
    const profile = profileFor("unknown-model", "https://api.example.test/v1");
    const res = await postChat(P, { model: P.model, temperature: 0.2 }, { timeoutMs: 5_000, profile });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect((global.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });
});

describe("queueing per provider key", () => {
  it("runs up to the configured number in parallel, never more", async () => {
    process.env.LLM_MAX_CONCURRENCY = "3";
    let inFlight = 0;
    let max = 0;
    const job = () => withSlot(P, "background", async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    });
    await Promise.all(Array.from({ length: 9 }, job));
    expect(max).toBe(3);
  });

  it("LLM_MAX_CONCURRENCY=1 restores the old single lane, in order", async () => {
    process.env.LLM_MAX_CONCURRENCY = "1";
    const seen: number[] = [];
    let inFlight = 0;
    let max = 0;
    await Promise.all([1, 2, 3].map((n) => withSlot(P, "background", async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 6 - n));
      seen.push(n);
      inFlight--;
    })));
    expect(max).toBe(1);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("lets the person who is waiting go first when the key is busy", async () => {
    process.env.LLM_MAX_CONCURRENCY = "1";
    const order: string[] = [];
    let release!: () => void;
    const blocker = withSlot(P, "background", () => new Promise<void>((r) => { release = r; }));
    // queued while the slot is taken, in this order: background, judgment, interactive
    const a = withSlot(P, "background", async () => { order.push("mission design"); });
    const b = withSlot(P, "judgment", async () => { order.push("payout judge"); });
    const c = withSlot(P, "interactive", async () => { order.push("founder's draft"); });
    release();
    await Promise.all([blocker, a, b, c]);
    expect(order).toEqual(["founder's draft", "payout judge", "mission design"]);
  });

  it("a failure releases the slot instead of wedging the queue", async () => {
    process.env.LLM_MAX_CONCURRENCY = "1";
    await expect(withSlot(P, "background", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withSlot(P, "background", async () => "recovered")).resolves.toBe("recovered");
  });

  it("separate keys never wait on each other", async () => {
    process.env.LLM_MAX_CONCURRENCY = "1";
    let release!: () => void;
    const busy = withSlot(P, "background", () => new Promise<void>((r) => { release = r; }));
    const other = await withSlot({ ...P, key: "a-different-key" }, "background", async () => "ran");
    expect(other).toBe("ran");
    release();
    await busy;
  });

  it("reads a cap the provider states in a 429, and never runs above it again", async () => {
    expect(statedCap('{"code":"rate_limit_exceeded","message":"Access key quota exceeded (cap 1)"}')).toBe(1);
    expect(statedCap("too many requests")).toBeNull();
    process.env.LLM_MAX_CONCURRENCY = "4";
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      return calls === 1
        ? new Response('{"message":"Access key quota exceeded (cap 1)"}', { status: 429 })
        : new Response(okBody, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await postChat(P, { model: P.model }, { timeoutMs: 5_000 });
    expect(r.status).toBe(429);
    let inFlight = 0;
    let max = 0;
    await Promise.all(Array.from({ length: 4 }, () => withSlot(P, "background", async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((res) => setTimeout(res, 5));
      inFlight--;
    })));
    expect(max).toBe(1);
  });
});

describe("lane priorities", () => {
  it("puts the founder's waiting moments first and background design last", () => {
    expect(priorityForLane("DRAFT")).toBe("interactive");
    expect(priorityForLane("CONCIERGE")).toBe("interactive");
    expect(priorityForLane("PAYOUT")).toBe("judgment");
    expect(priorityForLane("OBS_JUDGE")).toBe("judgment");
    expect(priorityForLane("MISSION")).toBe("background");
    expect(priorityForLane(undefined)).toBe("background");
  });
});
