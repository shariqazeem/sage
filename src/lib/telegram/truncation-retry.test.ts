import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { outputBudget, profileFor } from "@/lib/llm/provider-profile";

/**
 * P-DIRECT 2026-09-03: the Urdu gig's tool-call arguments arrived as truncated JSON and the founder
 * got nothing. The concierge now re-asks ONCE, with the next budget rung, when the provider itself
 * reports the cut (finish_reason "length") on a turn that carried a tool call — never speculatively.
 */
describe("concierge — a tool call cut mid-JSON is re-asked once with more room", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/telegram/concierge.ts"), "utf8");
  it("the response type carries finish_reason and the retry keys on it, only with a tool call present", () => {
    expect(src).toMatch(/finish_reason\?: string \| null/);
    expect(src).toMatch(/finish_reason === "length" && data\.choices\[0\]\?\.message\?\.tool_calls\?\.length/);
    expect(src).toMatch(/chatCompletion\(messages, roundTools, turnDeadline - Date\.now\(\), selfCorrected, 1\)/);
    expect(src).toMatch(/max_tokens: outputBudget\(5_000, profileFor\(model\(\), base\(\)\), escalation\)/);
  });
  it("the next rung is genuinely more room on a reasoning provider", () => {
    const p = profileFor("MiniMax-M3", "https://api.minimax.io/v1/chat/completions");
    expect(outputBudget(5_000, p, 1)).toBeGreaterThan(outputBudget(5_000, p, 0));
  });
});
