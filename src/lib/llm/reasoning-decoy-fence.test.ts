import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { llmCompleteJson } from "./complete";

/**
 * THE DECOY FENCE — measured on play2048, 2026-08-27.
 *
 * A reasoning model drafts its answer out loud. On the mission architect its <think> block ran to
 * 25,430 chars and contained its OWN ```json fence, while the real answer followed in a second
 * fence. `extractJson` matches the FIRST fence, so a COMPLETE response (finish_reason "stop") was
 * parsed from the model's scratch work instead of its answer — and the architect failed the whole
 * category with `invalid_json`.
 *
 * It is intermittent by nature: it depends on whether the model happened to quote JSON while
 * thinking, which is why it survived every unit test and only showed up against a real product.
 */
const realFetch = global.fetch;
const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as unknown as Response;
const reply = (content: string, finish = "stop") => ({
  model: "MiniMax-M3", choices: [{ message: { content }, finish_reason: finish }], usage: { completion_tokens: 9407 },
});
const mock = (content: string, finish = "stop") => {
  global.fetch = vi.fn(async () => ok(reply(content, finish))) as unknown as typeof fetch;
};

describe("a reasoning model's scratch work is never mistaken for its answer", () => {
  beforeEach(() => { process.env.LLM_API_KEY = "k"; process.env.LLM_BASE_URL = "https://api.minimax.io/v1"; process.env.LLM_MODEL = "MiniMax-M3"; });
  afterEach(() => {
    global.fetch = realFetch;
    for (const v of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"]) delete process.env[v];
    vi.restoreAllMocks();
  });

  const DECOY = [
    "<think>",
    "Let me draft the shape first. Something like:",
    "```json",
    '{"missions":[{"title":"DRAFT — not the answer"}]}',
    "```",
    "That draft is wrong, the real plan needs two missions.",
    "</think>",
    "",
    "```json",
    '{"missions":[{"title":"Reach 128 in a single game"},{"title":"Undo a move and report the state"}]}',
    "```",
  ].join("\n");

  it("takes the ANSWER's fence, not the one inside <think>", async () => {
    mock(DECOY);
    const r = await llmCompleteJson({ system: "s", user: "u" });
    const missions = (r.json as { missions: { title: string }[] }).missions;
    expect(missions).toHaveLength(2);
    expect(missions[0]!.title).not.toContain("DRAFT");
  });

  it("works in STRICT mode too, where two objects would otherwise be refused", async () => {
    const strictShaped = DECOY.replace(/```json\n|```/g, "").replace(
      '{"missions":[{"title":"DRAFT — not the answer"}]}',
      '{"missions":[{"title":"DRAFT — not the answer"}]}',
    );
    mock(strictShaped);
    const r = await llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict" });
    const missions = (r.json as { missions: { title: string }[] }).missions;
    expect(missions.map((m) => m.title).join()).not.toContain("DRAFT");
  });

  /**
   * The strip must not become a way to SALVAGE a truncated answer. stripReasoningPrefix removes
   * exactly one leading CLOSED block, so an unterminated <think> (the signature of a cut-off
   * response) still fails — a truncated plan must never be presented as a real one.
   */
  it("does NOT rescue a truncated response whose <think> never closed", async () => {
    mock('<think>I am still reasoning about the missions and got cut off mid-thought', "length");
    await expect(llmCompleteJson({ system: "s", user: "u", parsePolicy: "strict" })).rejects.toThrow();
  });

  it("leaves an ordinary response untouched", async () => {
    mock('{"missions":[{"title":"Plain answer, no reasoning"}]}');
    const r = await llmCompleteJson({ system: "s", user: "u" });
    expect((r.json as { missions: unknown[] }).missions).toHaveLength(1);
  });
});
