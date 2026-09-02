import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { llmCompleteJson } from "./complete";
import { outputBudget, profileFor } from "./provider-profile";

/**
 * P-GEN 46–48 (2026-09-02): one-page sites died `provider_timeout` while the provider answered a
 * trivial prompt in two seconds. Two causes, both ours:
 *  1. the abort timer started when a call JOINED the process-wide queue, not when it reached the
 *     provider — a call behind two 130s generations had spent its timeout before it started;
 *  2. the timeout was a flat provider number, below the time the token budget we asked for takes
 *     to produce on a model that fills its budget.
 */
const VARS = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "MISSION_API_KEY", "MISSION_BASE_URL", "MISSION_MODEL", "LLM_TIMEOUT_MS"];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = {};
  for (const k of VARS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.MISSION_API_KEY = "mission-key";
  process.env.MISSION_BASE_URL = "https://api.minimax.io/v1";
  process.env.MISSION_MODEL = "MiniMax-M3";
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.unstubAllGlobals();
});

describe("the abort timer and the token budget", () => {
  it("starts the timer inside the queue slot — structural, the only place the order is visible", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/llm/complete.ts"), "utf8");
    const queued = src.indexOf("await oneAtATime(() => {");
    const armed = src.indexOf("timer = setTimeout(() => controller.abort(), budgetMs);");
    expect(queued).toBeGreaterThan(0);
    expect(armed).toBeGreaterThan(queued); // armed AFTER the slot is taken
    expect(src).not.toMatch(/const timer = setTimeout\(\(\) => controller\.abort\(\), budgetMs\);\s*try \{\s*const res = await oneAtATime/);
  });

  it("sends the provider-aware budget as max_tokens, and the timeout formula covers producing it", async () => {
    const bodies: { max_tokens: number }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ model: "MiniMax-M3", choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: {} }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await llmCompleteJson({ system: "s", user: "u", lane: "MISSION", maxTokens: 11_000 });
    const profile = profileFor("MiniMax-M3", "https://api.minimax.io/v1/chat/completions");
    expect(bodies[0].max_tokens).toBe(outputBudget(11_000, profile, 0));
    // the formula, pinned: max(default, provider, tokens ÷ floor-rate + grace) — an 11k answer on a
    // filling reasoning model is minutes of generation and must never be aborted for being that long
    const src = readFileSync(resolve(process.cwd(), "src/lib/llm/complete.ts"), "utf8");
    expect(src).toMatch(/Math\.max\(TIMEOUT_MS, profile\.timeoutMs, Math\.ceil\(maxOut \/ MIN_TOKENS_PER_SEC\) \* 1000 \+ QUEUE_GRACE_MS\)/);
    const rate = Number(src.match(/const MIN_TOKENS_PER_SEC = ([\d_]+)/)?.[1]?.replace(/_/g, ""));
    expect(rate).toBeGreaterThanOrEqual(30);
    expect(rate).toBeLessThanOrEqual(60); // measured 57 tok/s on MiniMax-M3, 2026-09-02
  });
});
