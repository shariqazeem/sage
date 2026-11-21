// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armCreditAlerts, modelAlertText, probeBrokenModels, resetCreditAlerts } from "./credit-alert";
import { llmCompleteJson } from "./complete";
import { completeSteadily } from "./steady";
import { BROKEN_AFTER, BROKEN_FOR_MS, brokenModelList, isModelBroken, postChat, resetWireMemory, type WireProvider } from "./wire";

/**
 * A MODEL THAT ANSWERS 5xx TO EVERY CALL IS PASSED OVER (wire.ts, section 4b).
 *
 * Measured 21 Nov 2026: DeepSeek V4 Flash on CommonStack answered 500 to 8 of 8 calls and nothing remembered
 * it, so every job paid three tries and their waits before its fallback. These pin the breaker: it opens
 * after five in a row, answers at once without the network, lets one probe through after cooling, closes on
 * an answer, tells the operator once, and never touches another model on the same key.
 */
const P: WireProvider = { endpoint: "https://gw.example.test/v1/chat/completions", key: "k1", model: "deepseek/deepseek-v4-flash", host: "gw.example.test" };
const OTHER: WireProvider = { ...P, model: "openai/gpt-5.4-mini" };
const BODY = { model: P.model, max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: {} }), { status: 200 });
const err = (status = 500) => new Response("upstream error", { status });

let status: "down" | "up" = "down";
let calls = 0;
const fetchImpl = (async () => {
  calls++;
  return status === "down" ? err() : ok();
}) as unknown as typeof fetch;
const ask = (p: WireProvider = P, extra: { probe?: boolean } = {}) => postChat(p, { ...BODY, model: p.model }, { timeoutMs: 5_000, fetchImpl, ...extra });

beforeEach(() => {
  resetWireMemory();
  resetCreditAlerts();
  status = "down";
  calls = 0;
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetCreditAlerts();
  for (const k of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_MODEL", "LLM_RETRY_MAX_WAIT_MS"]) delete process.env[k];
});

describe("the per-model breaker", () => {
  it("opens after five 5xx in a row, then answers 503 at once without touching the network", async () => {
    for (let i = 0; i < BROKEN_AFTER; i++) expect((await ask()).status).toBe(500);
    expect(calls).toBe(BROKEN_AFTER);
    expect(isModelBroken(P)).toBe(true);
    const refused = await ask();
    expect(refused).toMatchObject({ ok: false, status: 503, modelBroken: true });
    expect(calls).toBe(BROKEN_AFTER); // no sixth call
    expect(brokenModelList()).toMatchObject([{ host: P.host, model: P.model, status: 500 }]);
  });

  it("an answer in between resets the count: a model that fails four calls in nine is never passed over", async () => {
    for (let i = 0; i < 20; i++) {
      status = i % 5 === 4 ? "up" : "down";
      await ask();
    }
    expect(isModelBroken(P)).toBe(false);
    expect(calls).toBe(20);
  });

  it("another model on the same key is not touched", async () => {
    for (let i = 0; i < BROKEN_AFTER; i++) await ask();
    status = "up";
    expect((await ask(OTHER)).ok).toBe(true);
    expect(isModelBroken(OTHER)).toBe(false);
    expect(isModelBroken(P)).toBe(true);
  });

  it("after cooling ONE call goes through as the probe: an answer closes it, another 5xx doubles the wait", async () => {
    for (let i = 0; i < BROKEN_AFTER; i++) await ask();
    await vi.advanceTimersByTimeAsync(BROKEN_FOR_MS + 1);
    expect(isModelBroken(P)).toBe(false); // cooled: the next caller is the probe
    expect((await ask()).status).toBe(500); // the probe failed
    expect(calls).toBe(BROKEN_AFTER + 1);
    await vi.advanceTimersByTimeAsync(BROKEN_FOR_MS + 1);
    expect((await ask()).modelBroken).toBe(true); // still cooling: twice as long now
    await vi.advanceTimersByTimeAsync(BROKEN_FOR_MS);
    status = "up";
    expect((await ask()).ok).toBe(true); // the second probe answered
    expect(brokenModelList()).toEqual([]);
    expect((await ask()).ok).toBe(true);
  });

  it("the operator hears it once when it breaks and once when it is back; the sweep's probe finds the recovery", async () => {
    process.env.LLM_API_KEY = P.key;
    process.env.LLM_BASE_URL = "https://gw.example.test/v1";
    process.env.LLM_MODEL = P.model;
    const sent: string[] = [];
    armCreditAlerts(async (t) => void sent.push(t));
    for (let i = 0; i < BROKEN_AFTER + 3; i++) await ask();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("failing every call");
    expect(sent[0]).toContain(P.model);
    expect(sent[0]).not.toContain(P.key);
    // still down: the sweep's probe is sent even while the model cools, and changes nothing
    expect(await probeBrokenModels({ fetchImpl })).toEqual({ probed: 1, recovered: 0 });
    status = "up";
    expect(await probeBrokenModels({ fetchImpl })).toEqual({ probed: 1, recovered: 1 });
    expect(isModelBroken(P)).toBe(false);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("answers again");
    expect(await probeBrokenModels({ fetchImpl })).toEqual({ probed: 0, recovered: 0 }); // healthy: no call
    expect(modelAlertText({ kind: "broken", host: "h", keyId: "x", model: "m", since: 0, status: 502 }, 0)).toContain("502");
  });

  it("a job whose primary is broken goes straight to a different fallback: no call, no retries, no waits", async () => {
    process.env.LLM_API_KEY = P.key;
    process.env.LLM_BASE_URL = "https://gw.example.test/v1";
    process.env.LLM_MODEL = P.model;
    process.env.LLM_FALLBACK_API_KEY = "k2";
    process.env.LLM_FALLBACK_BASE_URL = "https://other.example.test/v1";
    process.env.LLM_FALLBACK_MODEL = "openai/gpt-5.4-mini";
    const hosts: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const host = new URL(url).host;
      hosts.push(host);
      return host === "gw.example.test" ? err() : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: {} }), { status: 200 });
    });
    for (let i = 0; i < BROKEN_AFTER; i++) await llmCompleteJson({ system: "s", user: "u" }).catch(() => undefined);
    hosts.length = 0;
    const started = Date.now();
    const r = await completeSteadily(llmCompleteJson, { system: "s", user: "u" });
    expect(r.json).toEqual({ ok: true });
    expect(hosts).toEqual(["other.example.test"]);
    expect(Date.now() - started).toBeLessThan(1_000);
    vi.unstubAllGlobals();
  });
});
