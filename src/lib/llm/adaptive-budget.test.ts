import { describe, expect, it } from "vitest";
import { outputBudget, profileFor } from "./provider-profile";

/**
 * A FIXED overhead cannot be right, because the reasoning block scales with the INPUT.
 *
 * play2048's architect think block measured ~6,357 tokens; a one-sentence page needs a fraction of
 * that. Sizing the constant for the worst case looked safe and was not — the model FILLS whatever
 * budget it is given (7.2k -> 7,199; 11.2k -> 11,199; 16k -> 15,998), so a worst-case constant made
 * EVERY call generate worst-case tokens. Measured on prod: one architect call took 157s and a
 * one-sentence website took 36 MINUTES to inspect.
 */
const minimax = profileFor("MiniMax-M3", "https://api.minimax.io/v1");
const anthropic = profileFor("anthropic/claude-haiku-4-5", "https://api.commonstack.ai/v1");

describe("adaptive output budget", () => {
  it("starts well below the worst case, so the common path is fast", () => {
    const first = outputBudget(4_200, minimax, 0);
    const second = outputBudget(4_200, minimax, 1);
    expect(first).toBeLessThan(second);
    expect(first).toBeLessThan(4_200 + minimax.reasoningOverheadTokens);
  });

  it("escalates monotonically, and rung 1 restores the full measured overhead", () => {
    const rungs = [0, 1, 2].map((e) => outputBudget(4_200, minimax, e));
    expect(rungs[0]!).toBeLessThan(rungs[1]!);
    expect(rungs[1]!).toBeLessThan(rungs[2]!);
    expect(rungs[1]).toBe(4_200 + minimax.reasoningOverheadTokens);
  });

  /** play2048 needed ~9.5-10.6k completion tokens. A rung must reach that or the escalation is
   *  decoration — the case this whole mechanism exists for must actually fit. */
  it("reaches the measured worst case by the top rung", () => {
    expect(outputBudget(4_200, minimax, 2)).toBeGreaterThan(10_600);
  });

  it("is clamped, so a runaway ladder cannot ask for unbounded generation", () => {
    expect(outputBudget(4_200, minimax, 99)).toBe(outputBudget(4_200, minimax, 2));
  });

  it("changes nothing for a provider that does not reason", () => {
    expect(outputBudget(900, anthropic, 0)).toBe(900);
    expect(outputBudget(900, anthropic, 2)).toBe(900);
  });
});
