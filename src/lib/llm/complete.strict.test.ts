import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { llmCompleteJson } from "./complete";

// STRICT raw-completion boundary — tested at the REAL llmCompleteJson by mocking the fetch/raw provider
// response, NOT by mocking llmCompleteJson. Proves the strict policy fails closed on anything a tolerant
// parser would salvage, and that the DEFAULT repair policy is unchanged for every legacy caller.

const realFetch = global.fetch;
const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
function providerResponse(content: string, finish_reason: string | null = "stop", message: Record<string, unknown> = {}) {
  return { model: "prov/model-x", choices: [{ message: { content, ...message }, finish_reason }], usage: { prompt_tokens: 3, completion_tokens: 5 } };
}
const mockFetch = (body: unknown) => { global.fetch = vi.fn(async () => okResponse(body)) as unknown as typeof fetch; };

describe("llmCompleteJson — strict raw-completion boundary (fetch mocked, not llmCompleteJson)", () => {
  beforeEach(() => { process.env.LLM_API_KEY = "test-key"; process.env.LLM_BASE_URL = "https://prov.test/v1"; });
  afterEach(() => { global.fetch = realFetch; delete process.env.LLM_API_KEY; delete process.env.LLM_BASE_URL; vi.restoreAllMocks(); });

  it("clean JSON + finish_reason stop → PASSES with strict provenance (repaired=false)", async () => {
    mockFetch(providerResponse('{"missions":[{"k":1}]}', "stop"));
    const r = await llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict" });
    expect(r.json).toEqual({ missions: [{ k: 1 }] });
    expect(r.parsePolicy).toBe("strict");
    expect(r.repaired).toBe(false);
    expect(r.finishReason).toBe("stop");
    expect(r.responseModel).toBe("prov/model-x"); // actual provider model recorded
  });

  // Everything a tolerant parser would rescue must FAIL under strict.
  const rejects: Array<[string, unknown]> = [
    ["fenced JSON", providerResponse('```json\n{"a":1}\n```', "stop")],
    ["prose-wrapped JSON", providerResponse('Here is my answer: {"a":1}', "stop")],
    ["trailing comma", providerResponse('{"a":1,}', "stop")],
    ["truncated JSON (no closing brace)", providerResponse('{"a":1', "stop")],
    ["repairable unterminated tail", providerResponse('{"a":[1,2', "stop")],
    ["array output", providerResponse('[{"a":1}]', "stop")],
    ["empty content", providerResponse("", "stop")],
    ["missing finish_reason", providerResponse('{"a":1}', null)],
    ["finish_reason length", providerResponse('{"a":1}', "length")],
    ["finish_reason max_tokens", providerResponse('{"a":1}', "max_tokens")],
    ["finish_reason content_filter", providerResponse('{"a":1}', "content_filter")],
    ["finish_reason tool_calls", providerResponse('{"a":1}', "tool_calls")],
    ["finish_reason unknown", providerResponse('{"a":1}', "banana")],
    ["message.refusal present", providerResponse('{"a":1}', "stop", { refusal: "I can't help with that" })],
    ["message.tool_calls present", providerResponse('{"a":1}', "stop", { tool_calls: [{ id: "call_1" }] })],
    ["two choices (not exactly one)", { model: "m", choices: [{ message: { content: '{"a":1}' }, finish_reason: "stop" }, { message: { content: "{}" }, finish_reason: "stop" }] }],
  ];
  for (const [name, body] of rejects) {
    it(`strict REJECTS: ${name}`, async () => {
      mockFetch(body);
      await expect(llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict" })).rejects.toThrow();
    });
  }

  it("DEFAULT policy (no parsePolicy) is UNCHANGED — fenced JSON still parses via repair", async () => {
    mockFetch(providerResponse('```json\n{"a":1}\n```', "stop"));
    const r = await llmCompleteJson({ system: "s", user: "u" });
    expect(r.json).toEqual({ a: 1 });
    expect(r.parsePolicy).toBe("repair");
  });

  it("DEFAULT policy (no parsePolicy) STILL salvages a truncated tail (repaired=true)", async () => {
    mockFetch(providerResponse('{"a":[1,2', "stop"));
    const r = await llmCompleteJson({ system: "s", user: "u" });
    expect(r.json).toEqual({ a: [1, 2] });
    expect(r.repaired).toBe(true);
  });

  it("DEFAULT policy ignores finish_reason (a legacy caller with finish length still parses)", async () => {
    mockFetch(providerResponse('{"a":1}', "length"));
    const r = await llmCompleteJson({ system: "s", user: "u" });
    expect(r.json).toEqual({ a: 1 }); // repair path never consulted finish_reason — behavior preserved
  });
});
