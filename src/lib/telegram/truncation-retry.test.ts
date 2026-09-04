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
 *
 * EXTENDED AGAIN 2026-09-04: the provider does not always admit it. pd-gig-translator returned a
 * tool call whose arguments end mid-object under a CLEAN finish_reason, so nothing triggered and
 * the tool was handed `{}` — which answers "kind, title and milestones are required" to a model
 * whose arguments contained all three. Arguments that do not parse are therefore a cut in their
 * own right, and the reading lives in one shared module (`llm/truncation.ts`) so P-DIRECT cannot
 * drift from the product on what "truncated" means. The keep-the-better-answer rule is stated over
 * USABLE calls for the same reason: a call cut mid-JSON is present and unactionable, and preferring
 * it over a roomier answer is exactly how that row kept failing.
 */
describe("concierge — a turn cut short by the budget is re-asked once with more room", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/telegram/concierge.ts"), "utf8");
  it("the response type carries finish_reason and the retry keys on the shared reading", () => {
    expect(src).toMatch(/finish_reason\?: string \| null/);
    // keyed on the MEASURED cut alone — a turn that ran out of room while thinking is the same failure
    expect(src).toMatch(/const cut = truncationSignal\(data\.choices\?\.\[0\]\);/);
    expect(src).toMatch(/if \(cut\) \{/);
    expect(src).not.toMatch(/finish_reason === "length" && data\.choices\[0\]\?\.message\?\.tool_calls\?\.length/);
    // one rung above wherever the round started, so a corrective round is not re-asked at the
    // budget it has already exhausted
    expect(src).toMatch(/turnDeadline - Date\.now\(\), selfCorrected, selfCorrected \? 2 : 1\)/);
    expect(src).toMatch(/max_tokens: outputBudget\(5_000, profileFor\(model\(\), base\(\)\), escalation\)/);
  });

  it("P-DIRECT reads truncation with production's own function, never a copy", () => {
    const battery = readFileSync(resolve(process.cwd(), "src/lib/launch/direct-eval.ts"), "utf8");
    for (const f of [src, battery]) {
      expect(f).toMatch(/from "@\/lib\/llm\/truncation"/);
    }
    expect(battery).toMatch(/cut: truncationSignal\(ch\)/);
  });
  it("the next rung is genuinely more room on a reasoning provider", () => {
    const p = profileFor("MiniMax-M3", "https://api.minimax.io/v1/chat/completions");
    expect(outputBudget(5_000, p, 1)).toBeGreaterThan(outputBudget(5_000, p, 0));
  });
  it("never trades a USABLE tool call for a roomier reply that only talks", () => {
    // measured: replacing unconditionally took P-DIRECT's routing misses from 2 to 4 — but the
    // call being kept has to be one the caller can act on, or a half-written JSON object outranks
    // a good answer, which is how pd-gig-translator kept dying.
    expect(src).toMatch(/const hadCall = hasUsableCall\(data\.choices\?\.\[0\]\)/);
    expect(src).toMatch(/const gotCall = hasUsableCall\(roomier\.choices\?\.\[0\]\)/);
    expect(src).toMatch(/if \(gotCall \|\| !hadCall\) data = roomier;/);
  });

  it("a still-unparseable call is answered with the real reason, not an empty object", () => {
    expect(src).toMatch(/cut off mid-JSON/);
    // handing the tool `{}` makes every required field "missing" — a correction about nothing
    expect(src).not.toMatch(/malformed args → let the tool report the miss/);
  });
});

/**
 * The per-call timeout is the provider's, not a constant — the same rule the token budget follows.
 */
describe("concierge — how long one call may take comes from the provider profile", () => {
  const src2 = readFileSync(resolve(process.cwd(), "src/lib/telegram/concierge.ts"), "utf8");
  it("asks the profile rather than holding a flat number", () => {
    expect(src2).toMatch(/profileFor\(model\(\), base\(\)\)\.timeoutMs/);
    expect(src2).toMatch(/signal: AbortSignal\.timeout\(callTimeoutMs\(budgetMs\)\)/);
    expect(src2).not.toMatch(/signal: AbortSignal\.timeout\(TIMEOUT_MS\)/);
  });
  it("a reasoning provider genuinely gets more than the old flat 45s, and never the whole turn", () => {
    const p = profileFor("MiniMax-M3", "https://api.minimax.io/v1/chat/completions");
    expect(p.timeoutMs).toBeGreaterThan(45_000);
    // bounded below the turn so a corrective round still fits
    const turn = 240_000;
    const perCall = Math.max(45_000, Math.min(Math.max(45_000, p.timeoutMs), Math.floor(turn * 0.6)));
    expect(perCall).toBeGreaterThan(45_000);
    expect(perCall).toBeLessThan(turn);
  });
});
