import { describe, expect, it } from "vitest";
import { stripReasoningPrefix } from "./reasoning";

/**
 * Pinned against the real MiniMax-M3 output measured 2026-08-28, when pointing the Telegram
 * concierge at that provider made every founder reply open with Sage's internal monologue.
 */
describe("stripReasoningPrefix", () => {
  it("removes the exact leading block MiniMax emits, keeping the real reply", () => {
    const real =
      "<think>The user is greeting me and asking what I do. I should respond in a brief, plain way per the developer policy.</think>\n\nHi! I'm Sage, an autonomous agent.";
    expect(stripReasoningPrefix(real).trim()).toBe("Hi! I'm Sage, an autonomous agent.");
  });

  it("leaves ordinary replies untouched", () => {
    for (const s of ["Hi! I'm Sage.", "", "Your campaign is live.", "  spaced reply  "]) {
      expect(stripReasoningPrefix(s)).toBe(s);
    }
  });

  it("preserves an UNCLOSED or mid-content block — truncation is a signal, not noise", () => {
    const truncated = "<think>I was cut off mid-thoug";
    expect(stripReasoningPrefix(truncated)).toBe(truncated);
    const embedded = "Paid the tester. <think>should I say more?</think>";
    expect(stripReasoningPrefix(embedded)).toBe(embedded);
  });

  it("removes only ONE leading block, never a cascade", () => {
    const two = "<think>first</think><think>second</think>Reply";
    expect(stripReasoningPrefix(two)).toBe("<think>second</think>Reply");
  });
});
