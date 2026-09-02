import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackLlm, llmCompleteJson } from "./complete";

/**
 * P-GEN 47, motherfuckingwebsite.com: the MiniMax mission architect crossed a 300s timeout twice
 * on a one-page site while answering a trivial prompt in two seconds. The founder's launch died
 * with `LLM_FALLBACK_*` (a fast second provider) configured and idle. `useFallback` is the door
 * the ladder walks through after the second timeout — and ONLY then.
 */
const VARS = ["LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "MISSION_API_KEY", "MISSION_BASE_URL", "MISSION_MODEL"];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = {};
  for (const k of VARS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.LLM_API_KEY = "primary-key";
  process.env.LLM_BASE_URL = "https://primary.example.com/v1";
  process.env.LLM_MODEL = "primary-model";
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.unstubAllGlobals();
});

describe("the secondary provider", () => {
  it("is absent unless ALL THREE fallback vars are set — never merged with the primary", () => {
    expect(fallbackLlm()).toBeNull();
    process.env.LLM_FALLBACK_API_KEY = "fb-key";
    process.env.LLM_FALLBACK_BASE_URL = "https://fallback.example.com/v1/";
    expect(fallbackLlm()).toBeNull(); // model missing → absent
    process.env.LLM_FALLBACK_MODEL = "fast-model";
    expect(fallbackLlm()).toMatchObject({ key: "fb-key", model: "fast-model", endpoint: "https://fallback.example.com/v1/chat/completions" });
  });

  it("useFallback routes the call to the fallback endpoint with the fallback key, not the lane's", async () => {
    process.env.MISSION_API_KEY = "mission-key";
    process.env.MISSION_BASE_URL = "https://minimax.example.com/v1";
    process.env.MISSION_MODEL = "MiniMax-M3";
    process.env.LLM_FALLBACK_API_KEY = "fb-key";
    process.env.LLM_FALLBACK_BASE_URL = "https://fallback.example.com/v1";
    process.env.LLM_FALLBACK_MODEL = "fast-model";
    const calls: { url: string; auth: string; model: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, auth: init.headers.Authorization ?? init.headers.authorization, model: JSON.parse(init.body).model });
      return new Response(JSON.stringify({ model: "fast-model", choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: {} }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await llmCompleteJson({ system: "s", user: "u", lane: "MISSION", model: "MiniMax-M3", useFallback: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://fallback.example.com/v1/chat/completions", auth: "Bearer fb-key", model: "fast-model" });
  });

  it("useFallback with no fallback configured fails closed — it never silently re-runs the primary", async () => {
    await expect(llmCompleteJson({ system: "s", user: "u", useFallback: true })).rejects.toThrow(/llm_not_configured/);
  });
});
