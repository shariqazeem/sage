import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { llmCompleteJson, LlmCompletionError } from "./complete";

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

describe("llmCompleteJson — provider-native structured output (json_schema) + sanitized failure provenance", () => {
  let lastBody: Record<string, unknown> | null = null;
  const capturingFetch = (body: unknown, opts: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) => {
    global.fetch = vi.fn(async (_url: unknown, init: { body?: string }) => {
      lastBody = init?.body ? JSON.parse(init.body) : null;
      return { ok: opts.ok ?? true, status: opts.status ?? 200, headers: { get: (k: string) => opts.headers?.[k.toLowerCase()] ?? null }, json: async () => body } as unknown as Response;
    }) as unknown as typeof fetch;
  };
  beforeEach(() => { process.env.LLM_API_KEY = "test-key"; process.env.LLM_BASE_URL = "https://prov.test/v1"; lastBody = null; });
  afterEach(() => { global.fetch = realFetch; delete process.env.LLM_API_KEY; delete process.env.LLM_BASE_URL; vi.restoreAllMocks(); });

  const SCHEMA = { name: "sage_test_v1", schema: { type: "object", additionalProperties: false, properties: { missions: { type: "array", items: { type: "string" } } }, required: ["missions"] } };

  it("WITHOUT responseSchema still sends response_format json_object (legacy unchanged)", async () => {
    capturingFetch(providerResponse('{"a":1}', "stop"));
    await llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict" });
    expect(lastBody?.response_format).toEqual({ type: "json_object" });
  });

  it("WITH responseSchema sends response_format json_schema + strict:true + the EXACT schema", async () => {
    capturingFetch(providerResponse('{"missions":[]}', "stop"));
    await llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict", responseSchema: SCHEMA });
    expect(lastBody?.response_format).toEqual({ type: "json_schema", json_schema: { name: "sage_test_v1", strict: true, schema: SCHEMA.schema } });
  });

  it("clean schema-shaped bare-object output passes strict parsing", async () => {
    capturingFetch(providerResponse('{"missions":["m1"]}', "stop"));
    const r = await llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict", responseSchema: SCHEMA });
    expect(r.json).toEqual({ missions: ["m1"] });
    expect(r.parsePolicy).toBe("strict");
    expect(r.repaired).toBe(false);
  });

  it("{\"missions\":[]} is transport-valid and parses (becomes honest v2_empty downstream)", async () => {
    capturingFetch(providerResponse('{"missions":[]}', "stop"));
    const r = await llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict", responseSchema: SCHEMA });
    expect(r.json).toEqual({ missions: [] });
  });

  for (const [name, content] of [["fenced", '```json\n{"missions":[]}\n```'], ["prose_wrapped", 'Here you go: {"missions":[]}'], ["truncated", '{"missions":[']] as const) {
    it(`structured output that is ${name} STILL fails strict (schema constrains generation, not the receiver)`, async () => {
      capturingFetch(providerResponse(content, "stop"));
      await expect(llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict", responseSchema: SCHEMA })).rejects.toBeInstanceOf(LlmCompletionError);
    });
  }

  it("a strict-parse failure preserves SAFE provenance (served model, usage, latency, contentShape) — no raw text", async () => {
    const raw = '```json\n{"missions":["SECRET_LEAK_TOKEN"]}\n```';
    capturingFetch(providerResponse(raw, "stop"));
    let err: LlmCompletionError | null = null;
    try { await llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict", responseSchema: SCHEMA }); } catch (e) { err = e as LlmCompletionError; }
    expect(err).toBeInstanceOf(LlmCompletionError);
    expect(err!.responseModel).toBe("prov/model-x");
    expect(err!.provider).toBe("prov.test");
    expect(err!.promptTokens).toBe(3);
    expect(err!.completionTokens).toBe(5);
    expect(err!.latencyMs).not.toBeNull();
    expect(err!.contentShape).toBe("fenced");
    expect(err!.responseSchemaName).toBe("sage_test_v1");
    expect(err!.parsePolicy).toBe("strict");
    // NO raw content anywhere in the error (message or any field).
    expect(err!.message).not.toContain("SECRET_LEAK_TOKEN");
    expect(JSON.stringify({ ...err })).not.toContain("SECRET_LEAK_TOKEN");
  });

  it("an HTTP 400 (schema incompatibility) surfaces httpStatus + retryAfterMs, no body text", async () => {
    capturingFetch({ error: { message: "json_schema not supported SECRET" } }, { ok: false, status: 400, headers: { "retry-after": "2" } });
    let err: LlmCompletionError | null = null;
    try { await llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict", responseSchema: SCHEMA }); } catch (e) { err = e as LlmCompletionError; }
    expect(err).toBeInstanceOf(LlmCompletionError);
    expect(err!.code).toBe("llm_status_400");
    expect(err!.httpStatus).toBe(400);
    expect(err!.retryAfterMs).toBe(2000);
    expect(err!.contentShape).toBe("unknown");
    expect(JSON.stringify({ ...err })).not.toContain("SECRET");
  });

  it("an HTTP 429 carries retryAfterMs for the runner to classify as quota_blocked", async () => {
    capturingFetch({}, { ok: false, status: 429, headers: { "retry-after": "30" } });
    let err: LlmCompletionError | null = null;
    try { await llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict", responseSchema: SCHEMA }); } catch (e) { err = e as LlmCompletionError; }
    expect(err!.code).toBe("llm_status_429");
    expect(err!.retryAfterMs).toBe(30000);
  });
});
