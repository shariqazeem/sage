import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { llmCompleteJson } from "./complete";

/**
 * The budget guard, asserted AT THE WIRE. A provider profile that never reaches the request body is
 * decoration, so this reads `max_tokens` out of the actual JSON sent to the provider.
 *
 * This is the defect class it protects against: the mission architect asks for 4200 tokens of
 * answer. On a reasoning provider, up to ~2766 of those are spent thinking before the answer
 * starts, so a naive 4200 truncates the JSON mid-write — which is not a shorter mission, it is an
 * unparseable one. P-DIRECT caught exactly this on three campaigns.
 */
const realFetch = global.fetch;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const reply = { model: "m", choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: {} };

function captureBody() {
  const seen: { max_tokens?: number }[] = [];
  global.fetch = vi.fn(async (_u: unknown, init: { body?: string }) => {
    seen.push(JSON.parse(init.body ?? "{}"));
    return ok(reply);
  }) as unknown as typeof fetch;
  return seen;
}

describe("provider-aware max_tokens reaches the request body", () => {
  beforeEach(() => { process.env.LLM_API_KEY = "k"; });
  afterEach(() => {
    global.fetch = realFetch;
    for (const v of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "MISSION_API_KEY", "MISSION_BASE_URL", "MISSION_MODEL"]) delete process.env[v];
    vi.restoreAllMocks();
  });

  it("asks a REASONING provider for the answer PLUS its overhead", async () => {
    process.env.LLM_BASE_URL = "https://api.minimax.io/v1";
    process.env.LLM_MODEL = "MiniMax-M3";
    const seen = captureBody();
    await llmCompleteJson({ system: "s", user: "u", maxTokens: 4200 });
    expect(seen[0]?.max_tokens).toBeGreaterThan(4200 + 2_766);
  });

  it("asks a NON-reasoning provider for exactly what the caller declared", async () => {
    process.env.LLM_BASE_URL = "https://api.commonstack.ai/v1";
    process.env.LLM_MODEL = "anthropic/claude-haiku-4-5";
    const seen = captureBody();
    await llmCompleteJson({ system: "s", user: "u", maxTokens: 4200 });
    expect(seen[0]?.max_tokens).toBe(4200);
  });

  it("profiles the LANE's model, not the shared chain's, when a lane is configured", async () => {
    // The trap: shared chain says Anthropic, mission lane actually runs MiniMax. Budgeting from
    // the shared model would under-size the request that is really going to the reasoning model.
    process.env.LLM_BASE_URL = "https://api.commonstack.ai/v1";
    process.env.LLM_MODEL = "anthropic/claude-haiku-4-5";
    process.env.MISSION_API_KEY = "mk";
    process.env.MISSION_BASE_URL = "https://api.minimax.io/v1";
    process.env.MISSION_MODEL = "MiniMax-M3";
    const seen = captureBody();
    await llmCompleteJson({ system: "s", user: "u", maxTokens: 4200, lane: "MISSION" });
    expect(seen[0]?.max_tokens).toBeGreaterThan(4200 + 2_766);
  });
});
