// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { llmCompleteJson, LlmCompletionError, thoughtOnly } from "./complete";
import { DEADLINE_CODE, deadlineRemainingMs, withDeadline } from "./deadline";
import { noteThinkOnly, resetModelHealth, thinkOnlyCoolingMs, thinksOnly } from "./model-health";
import { completeSteadily, hedged, isThinkOnlyError, primaryUnwell } from "./steady";
import { resetWireMemory } from "./wire";
import { wasTruncated } from "@/lib/launch/mission-brain";

/**
 * RAN OUT OF ROOM BEFORE ANY ANSWER is not CUT MID-ANSWER (22 Nov 2026).
 *
 * Measured 21 Nov 2026: MiniMax M3 spent all 14,000 completion tokens thinking on the architect prompt. The
 * empty answer was read as a truncation, so the same model was given more room and asked again, five times.
 */
const VARS = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_MODEL", "MISSION_API_KEY", "MISSION_BASE_URL", "MISSION_MODEL", "LLM_OVERTHINK_COOLING_MS", "LLM_TIMEOUT_MS"];
const reply = (content: string | null, finish: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ model: "m", choices: [{ message: { content, ...extra }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 14_000 } }), { status: 200 });

beforeEach(() => {
  for (const k of VARS) delete process.env[k];
  process.env.LLM_API_KEY = "k";
  process.env.LLM_BASE_URL = "https://primary.example.test/v1";
  process.env.LLM_MODEL = "minimax/minimax-m3";
  resetWireMemory();
  resetModelHealth();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  for (const k of VARS) delete process.env[k];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("telling a think-only answer from a cut one", () => {
  it("is think-only: finish length with nothing, an unclosed think block, or a closed one with no room left", () => {
    expect(thoughtOnly({ finish_reason: "length", message: { content: "" } })).toBe(true);
    expect(thoughtOnly({ finish_reason: "length", message: { content: null } })).toBe(true);
    expect(thoughtOnly({ finish_reason: "length", message: { content: "<think>\nstill going" } })).toBe(true);
    expect(thoughtOnly({ finish_reason: "length", message: { content: "<think>done</think>\n" } })).toBe(true);
  });
  it("is NOT think-only: an answer that started, a normal finish, a tool call", () => {
    expect(thoughtOnly({ finish_reason: "length", message: { content: '{"missions":[{"title":"a' } })).toBe(false);
    expect(thoughtOnly({ finish_reason: "length", message: { content: '<think>x</think>{"missions":[' } })).toBe(false);
    expect(thoughtOnly({ finish_reason: "stop", message: { content: "" } })).toBe(false);
    expect(thoughtOnly({ finish_reason: "length", message: { content: "", tool_calls: [{}] } })).toBe(false);
    expect(thoughtOnly(undefined)).toBe(false);
  });

  it("the completion names it, remembers it for that job only, and the ladder does not call it a truncation", async () => {
    vi.stubGlobal("fetch", async () => reply("", "length", { reasoning_content: "thinking…" }));
    const e = await llmCompleteJson({ system: "s", user: "u", tag: "architect@v1" }).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(LlmCompletionError);
    expect((e as LlmCompletionError).code).toBe("llm_think_only");
    expect((e as LlmCompletionError).finishReason).toBe("length");
    expect(isThinkOnlyError(e)).toBe(true);
    expect(wasTruncated(e)).toBe(false); // more room is not the fix
    const p = { host: "primary.example.test", model: "minimax/minimax-m3" };
    expect(thinksOnly(p, undefined, "architect@v1")).toBe(true);
    expect(thinksOnly(p, undefined, "critic@v1")).toBe(false); // another job on the same model is not condemned
    expect(thinksOnly(p, undefined, "architect@v2")).toBe(false); // a new prompt version is tried at once
  });

  it("a cut answer IS a truncation, and an unparseable one carries the provider's finish reason", async () => {
    vi.stubGlobal("fetch", async () => reply("not json at all", "length"));
    const e = await llmCompleteJson({ system: "s", user: "u" }).then(() => null, (x: unknown) => x);
    expect((e as LlmCompletionError).code).toBe("llm_unparseable");
    expect(wasTruncated(e)).toBe(true);
    vi.stubGlobal("fetch", async () => reply("not json at all", "stop"));
    const shape = await llmCompleteJson({ system: "s", user: "u" }).then(() => null, (x: unknown) => x);
    expect(wasTruncated(shape)).toBe(false); // a shape miss buys no room
  });

  it("the strict parse keeps its own code and still remembers the model", async () => {
    vi.stubGlobal("fetch", async () => reply("<think>\nplanning", "length"));
    const e = await llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict", lane: "MISSION", tag: "journey" }).then(() => null, (x: unknown) => x);
    expect((e as LlmCompletionError).code).toBe("llm_strict_finish_length");
    expect(isThinkOnlyError(e)).toBe(true);
  });

  it("the memory cools: after the period the model is asked again, and an answer clears it", async () => {
    const p = { host: "h", model: "m" };
    noteThinkOnly(p, "MISSION", "t", 1_000);
    expect(thinksOnly(p, "MISSION", "t", 1_000 + thinkOnlyCoolingMs() - 1)).toBe(true);
    expect(thinksOnly(p, "MISSION", "t", 1_000 + thinkOnlyCoolingMs())).toBe(false);
    // primaryUnwell needs a DIFFERENT fallback to route to: on prod the shared chain and the fallback are the same
    noteThinkOnly({ host: "primary.example.test", model: "minimax/minimax-m3" }, undefined, "t");
    expect(primaryUnwell({ tag: "t" })).toBe(false);
    process.env.LLM_FALLBACK_API_KEY = "k";
    process.env.LLM_FALLBACK_BASE_URL = "https://primary.example.test/v1";
    process.env.LLM_FALLBACK_MODEL = "minimax/minimax-m3";
    expect(primaryUnwell({ tag: "t" })).toBe(false);
    process.env.LLM_FALLBACK_MODEL = "openai/gpt-5.4-mini";
    expect(primaryUnwell({ tag: "t" })).toBe(true);
    vi.stubGlobal("fetch", async () => reply('{"ok":true}', "stop"));
    await llmCompleteJson({ system: "s", user: "u", tag: "t" });
    expect(primaryUnwell({ tag: "t" })).toBe(false);
  });

  it("steady work sends a think-only answer to the fallback at once, with no retry of the same model", async () => {
    process.env.LLM_FALLBACK_API_KEY = "k2";
    process.env.LLM_FALLBACK_BASE_URL = "https://fallback.example.test/v1";
    process.env.LLM_FALLBACK_MODEL = "openai/gpt-5.4-mini";
    const hosts: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      hosts.push(new URL(url).host);
      return hosts.length === 1 ? reply("", "length") : reply('{"ok":true}', "stop");
    });
    const r = await completeSteadily(llmCompleteJson, { system: "s", user: "u", tag: "job" });
    expect(r.json).toEqual({ ok: true });
    expect(hosts).toEqual(["primary.example.test", "fallback.example.test"]);
    // ...and the next one does not ask the thinker at all
    await completeSteadily(llmCompleteJson, { system: "s", user: "u", tag: "job" });
    expect(hosts).toEqual(["primary.example.test", "fallback.example.test", "fallback.example.test"]);
  });
});

describe("one clock for a whole piece of work", () => {
  it("a call inside a deadline gets at most what is left, and none once it is spent", async () => {
    vi.useFakeTimers();
    const timeouts: number[] = [];
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal!.addEventListener("abort", () => { timeouts.push(Date.now()); rej(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })); })));
    const started = Date.now();
    const run = withDeadline(20_000, async () => {
      expect(deadlineRemainingMs()).toBe(20_000);
      const first = await llmCompleteJson({ system: "s", user: "u" }).then(() => "answered", (e: Error) => e.name);
      const second = await llmCompleteJson({ system: "s", user: "u" }).then(() => "answered", (e: Error) => e.message);
      return { first, second };
    });
    await vi.advanceTimersByTimeAsync(30_000);
    const out = await run;
    expect(out.first).toBe("AbortError"); // the provider's own 300 s timeout was cut to the 20 s that were left
    expect(timeouts[0]! - started).toBe(20_000);
    expect(out.second).toBe(DEADLINE_CODE); // and the next call never reached the network
    expect(timeouts).toHaveLength(1);
    expect(deadlineRemainingMs()).toBeNull(); // outside, there is no clock
  });

  it("a nested deadline can only shorten the outer one, and maxWaitMs only shortens a call", async () => {
    await withDeadline(10_000, async () => {
      await withDeadline(60_000, async () => expect(deadlineRemainingMs()).toBeLessThanOrEqual(10_000));
      await withDeadline(2_000, async () => expect(deadlineRemainingMs()).toBeLessThanOrEqual(2_000));
    });
    vi.useFakeTimers();
    let aborted = 0;
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => { aborted = Date.now(); rej(Object.assign(new Error("aborted"), { name: "AbortError" })); })));
    const started = Date.now();
    const p = llmCompleteJson({ system: "s", user: "u", maxWaitMs: 7_000 }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(8_000);
    await p;
    expect(aborted - started).toBe(7_000);
  });
});

describe("first valid answer of two", () => {
  const later = <T,>(ms: number, v: T, signal?: AbortSignal) => new Promise<T>((res, rej) => { const t = setTimeout(() => res(v), ms); signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); }); });
  beforeEach(() => vi.useFakeTimers());

  it("a primary that answers before the mark never starts the secondary", async () => {
    const secondary = vi.fn(async () => "b");
    const p = hedged((s) => later(1_000, "a", s), secondary, 5_000);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await p).toBe("a");
    expect(secondary).not.toHaveBeenCalled();
  });
  it("a primary still silent at the mark is joined; the first answer wins and the other is aborted", async () => {
    let primaryAborted = false;
    const p = hedged((s) => { s.addEventListener("abort", () => { primaryAborted = true; }); return later(60_000, "a", s); }, (s) => later(1_000, "b", s), 5_000);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await p).toBe("b");
    expect(primaryAborted).toBe(true);
  });
  it("a primary failure the other model can fix starts it at once; both failing reports the primary's error", async () => {
    const quick = hedged(async () => { throw new Error("think"); }, (s) => later(1_000, "b", s), 60_000, () => true);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await quick).toBe("b");
    const both = hedged(async () => { throw new Error("primary died"); }, async () => { throw new Error("secondary died"); }, 60_000, () => true);
    await expect(both).rejects.toThrow("primary died");
    const noHelp = hedged(async () => { throw new Error("shape"); }, vi.fn(async () => "b"), 60_000);
    await expect(noHelp).rejects.toThrow("shape");
  });
});
