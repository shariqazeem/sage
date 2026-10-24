import { describe, expect, it } from "vitest";
import { checksFrom } from "./live-work";

/**
 * THE FRONT DOOR'S PAYOUT MUST CARRY ITS OWN STORY: at least two checks it met, one of them with words
 * from the evidence. Quotes are shortened with an ellipsis, never reworded; anything thinner falls back
 * to the plain receipt.
 */
describe("the checks a decided payout shows", () => {
  it("shows up to three met checks, with their verbatim quotes", () => {
    const shown = checksFrom({
      confidence: 0.93,
      criteria: [
        { criterion: "The post names the product", met: true, quote: "I tried Sage this week and it paid me" },
        { criterion: "The post is public", met: true },
        { criterion: "It was published after the job opened", met: true, quote: "Published 21 October 2026, two days later" },
        { criterion: "A fourth", met: true, quote: "never shown, only three are" },
      ],
    });
    expect(shown?.checks).toHaveLength(3);
    expect(shown?.checks[0]).toEqual({ text: "The post names the product", quote: "I tried Sage this week and it paid me" });
    expect(shown?.checks[1]!.quote).toBeNull();
    expect(shown?.confidencePct).toBe(93);
  });

  it("refuses a decision too thin to tell the story", () => {
    expect(checksFrom(null)).toBeNull();
    expect(checksFrom({ criteria: [{ criterion: "One check", met: true, quote: "a long enough quote here" }] })).toBeNull();
    expect(checksFrom({ criteria: [{ criterion: "a", met: true }, { criterion: "b", met: true }] })).toBeNull(); // no quote
    expect(checksFrom({ criteria: [{ criterion: "a", met: false, quote: "a long enough quote here" }, { criterion: "b", met: true, quote: "another long enough quote" }] })).toBeNull();
  });

  it("shortens a long quote with an ellipsis and never rewords it", () => {
    const long = "word ".repeat(60).trim();
    const shown = checksFrom({ criteria: [{ criterion: "a", met: true, quote: long }, { criterion: "b", met: true }] });
    const q = shown!.checks[0]!.quote!;
    expect(q.endsWith("…")).toBe(true);
    expect(long.startsWith(q.slice(0, -1).trimEnd())).toBe(true);
  });
});
