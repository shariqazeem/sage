import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { outputBudget, profileFor } from "@/lib/llm/provider-profile";

/**
 * P-DIRECT 2026-09-03: the Urdu gig's tool-call arguments arrived as truncated JSON and the founder
 * got nothing. The concierge re-asks ONCE, with the next budget rung, when the provider itself
 * reports the cut (finish_reason "length") — never speculatively.
 *
 * EXTENDED 2026-09-04, on the same battery. The retry originally required a tool call to be present,
 * which only rescued a call cut mid-JSON. A reasoning model that spends its entire budget thinking
 * emits no call at all: P-DIRECT returned several turns as an unclosed <think> block and nothing
 * else. Those fell through to the suppressor, and from there only a money-action or an unbacked
 * claim starts a corrective round — so a founder asking for something that is neither ("test my
 * product at …") got the honest fallback instead of the work. The principle is unchanged: the
 * provider's own finish_reason is a MEASURED cut, and it means the same thing with or without a
 * call attached. Still one rung, still once, still before any tool has run.
 */
describe("concierge — a turn cut short by the budget is re-asked once with more room", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/telegram/concierge.ts"), "utf8");
  it("the response type carries finish_reason and the retry keys on it, call or no call", () => {
    expect(src).toMatch(/finish_reason\?: string \| null/);
    // keyed on the MEASURED cut alone — a turn that ran out of room while thinking is the same failure
    expect(src).toMatch(/data\.choices\?\.\[0\]\?\.finish_reason === "length"\) \{/);
    expect(src).not.toMatch(/finish_reason === "length" && data\.choices\[0\]\?\.message\?\.tool_calls\?\.length/);
    expect(src).toMatch(/chatCompletion\(messages, roundTools, turnDeadline - Date\.now\(\), selfCorrected, 1\)/);
    expect(src).toMatch(/max_tokens: outputBudget\(5_000, profileFor\(model\(\), base\(\)\), escalation\)/);
  });
  it("the next rung is genuinely more room on a reasoning provider", () => {
    const p = profileFor("MiniMax-M3", "https://api.minimax.io/v1/chat/completions");
    expect(outputBudget(5_000, p, 1)).toBeGreaterThan(outputBudget(5_000, p, 0));
  });
});
