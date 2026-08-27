import { describe, expect, it } from "vitest";
import { outputBudget, profileFor } from "./provider-profile";

describe("provider profiles", () => {
  it("recognises the models Sage actually runs on", () => {
    expect(profileFor("MiniMax-M3", "https://api.minimax.io/v1").id).toBe("minimax");
    expect(profileFor("anthropic/claude-haiku-4-5", "https://api.commonstack.ai/v1").id).toBe("anthropic-compatible");
    expect(profileFor("google/gemini-3.1-flash-lite", "").id).toBe("gemini-compatible");
  });

  it("matches on the BASE URL too, so a renamed model is still recognised", () => {
    // MiniMax renames its flagship regularly; the endpoint is the stable signal.
    expect(profileFor("some-future-model", "https://api.minimax.io/v1").id).toBe("minimax");
  });

  it("knows MiniMax reasons out loud and the Anthropic-compatible tier does not", () => {
    expect(profileFor("MiniMax-M3", "").emitsReasoningPrefix).toBe(true);
    expect(profileFor("anthropic/claude-haiku-4-5", "").emitsReasoningPrefix).toBe(false);
  });

  /**
   * THE PORTABILITY PROPERTY. An unknown provider must fail toward SPACE, never toward
   * truncation: over-budgeting costs nothing (generation is billed by tokens produced), while
   * under-budgeting cuts a tool call mid-JSON and silently loses a founder's campaign. Every
   * model switch this quarter arrived as a surprise; the default is what makes the next one safe.
   */
  it("assumes an UNKNOWN provider reasons, so a new model can only be over-budgeted", () => {
    const unknown = profileFor("brand-new-model-nobody-has-seen", "https://api.example.com/v1");
    expect(unknown.emitsReasoningPrefix).toBe(true);
    expect(unknown.reasoningOverheadTokens).toBeGreaterThan(0);
    expect(outputBudget(5_000, unknown)).toBeGreaterThan(5_000);
  });

  it("adds nothing for a provider that does not reason", () => {
    expect(outputBudget(900, profileFor("anthropic/claude-haiku-4-5", ""))).toBe(900);
  });

  it("budgets the concierge's real ask above MiniMax's measured worst case", () => {
    // The payout brain measured 1756 / 1884 / 2766 completion tokens for the SAME payload.
    const budget = outputBudget(5_000, profileFor("MiniMax-M3", ""));
    expect(budget).toBeGreaterThanOrEqual(5_000 + 2_766);
  });

  it("never returns a zero or negative budget", () => {
    expect(outputBudget(0, profileFor("anthropic/claude-haiku-4-5", ""))).toBeGreaterThan(0);
    expect(outputBudget(-100, profileFor("anthropic/claude-haiku-4-5", ""))).toBeGreaterThan(0);
  });
});
