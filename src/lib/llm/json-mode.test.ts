import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { llmCompleteJson } from "./complete";

/**
 * A declared capability that never reaches the request is not a capability — it is a comment.
 *
 * `responseSchema` was sent as strict `json_schema` to EVERY provider. MiniMax does not implement
 * it (measured: given a strict {supported, reason} schema it returned a <think> block, a fence, and
 * invented field names), and the grounded architect's larger nested schema drew `llm_status_400` —
 * non-retryable, so one rejection killed the grounded plan and the weaker legacy plan shipped.
 */
const realFetch = global.fetch;
const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as unknown as Response;
const reply = { model: "m", choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: {} };
const SCHEMA = { name: "draft", schema: { type: "object", properties: {} } };

function capture() {
  const seen: { response_format?: { type: string } }[] = [];
  global.fetch = vi.fn(async (_u: unknown, init: { body?: string }) => {
    seen.push(JSON.parse(init.body ?? "{}"));
    return ok(reply);
  }) as unknown as typeof fetch;
  return seen;
}

describe("response_format follows the provider's declared jsonMode", () => {
  beforeEach(() => { process.env.LLM_API_KEY = "k"; });
  afterEach(() => {
    global.fetch = realFetch;
    for (const v of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"]) delete process.env[v];
    vi.restoreAllMocks();
  });

  it("does NOT send json_schema to a provider that cannot honour it", async () => {
    process.env.LLM_BASE_URL = "https://api.minimax.io/v1";
    process.env.LLM_MODEL = "MiniMax-M3";
    const seen = capture();
    await llmCompleteJson({ system: "s", user: "u", responseSchema: SCHEMA });
    expect(seen[0]?.response_format?.type).toBe("json_object");
  });

  /** The Gemini family DOES honour it — and json_object measurably broke strict parsing there,
   *  which json_schema fixed. That fix must survive this change. */
  it("still sends json_schema to a provider that honours it", async () => {
    process.env.LLM_BASE_URL = "https://generativelanguage.example/v1";
    process.env.LLM_MODEL = "google/gemini-3.1-flash-lite";
    const seen = capture();
    await llmCompleteJson({ system: "s", user: "u", responseSchema: SCHEMA });
    expect(seen[0]?.response_format?.type).toBe("json_schema");
  });

  it("falls back conservatively for an UNKNOWN provider", async () => {
    process.env.LLM_BASE_URL = "https://api.brand-new.example/v1";
    process.env.LLM_MODEL = "who-knows";
    const seen = capture();
    await llmCompleteJson({ system: "s", user: "u", responseSchema: SCHEMA });
    expect(seen[0]?.response_format?.type).toBe("json_object");
  });

  it("still asks for JSON when no schema was supplied", async () => {
    process.env.LLM_BASE_URL = "https://api.minimax.io/v1";
    process.env.LLM_MODEL = "MiniMax-M3";
    const seen = capture();
    await llmCompleteJson({ system: "s", user: "u" });
    expect(seen[0]?.response_format?.type).toBe("json_object");
  });
});
