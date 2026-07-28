import { describe, it, expect } from "vitest";
import {
  composeAccount,
  evidencePrompts,
  hasAnyAnswer,
  unansweredPrompts,
  MAX_EVIDENCE_PROMPTS,
} from "./evidence-answers";

/**
 * The mission designs its own evidence form. What must hold:
 *  - the questions come from the mission, so they adapt per product with no product strings in code;
 *  - the judged account is the tester's OWN words only — never the public prompt text, which would
 *    put language the tester merely read in front of the verifier;
 *  - a tester is never shown a blank form, and never an endless one.
 */

describe("the mission's own requirements become the questions", () => {
  it("uses each requirement as a prompt, in order", () => {
    expect(
      evidencePrompts([
        "Name the exact heading on the confirmation screen.",
        "What did the button say before you clicked it?",
      ]),
    ).toEqual([
      "Name the exact heading on the confirmation screen.",
      "What did the button say before you clicked it?",
    ]);
  });

  it("caps the form so it stays answerable", () => {
    const many = Array.from({ length: 9 }, (_, i) => `Requirement number ${i}`);
    expect(evidencePrompts(many)).toHaveLength(MAX_EVIDENCE_PROMPTS);
  });

  it("drops duplicates and blanks rather than showing an empty box", () => {
    expect(
      evidencePrompts(["Describe it", "describe it", "  ", "", "ok", "Second one"]),
    ).toEqual(["Describe it", "Second one"]);
  });

  it("normalises whitespace so a wrapped requirement reads as one line", () => {
    expect(evidencePrompts(["Name   the\n  heading"])).toEqual(["Name the heading"]);
  });

  it("returns nothing when the mission carries no requirements, so the caller can fall back", () => {
    expect(evidencePrompts([])).toEqual([]);
    expect(evidencePrompts(null)).toEqual([]);
    expect(evidencePrompts(undefined)).toEqual([]);
  });
});

describe("the judged account is the tester's words and nothing else", () => {
  it("joins the answers without ever including the prompts", () => {
    const prompts = ["Name the exact heading.", "What did the button say?"];
    const answers = ["It said Your plan is ready", "The button said Let Sage inspect"];
    const account = composeAccount(answers);
    expect(account).toContain("Your plan is ready");
    expect(account).toContain("Let Sage inspect");
    for (const p of prompts) expect(account).not.toContain(p);
  });

  it("drops blank answers instead of leaving empty gaps", () => {
    expect(composeAccount(["first", "   ", "", undefined, "second"])).toBe(
      "first\n\nsecond",
    );
  });

  it("is empty when nothing was answered", () => {
    expect(composeAccount(["", "  ", undefined])).toBe("");
  });

  it("trims each answer so stray whitespace never becomes content", () => {
    expect(composeAccount(["  padded  "])).toBe("padded");
  });
});

describe("a tester learns what is missing before spending an attempt", () => {
  const prompts = ["A", "B", "C"];

  it("names every unanswered question by index", () => {
    expect(unansweredPrompts(prompts, ["done", "", "also done"])).toEqual([1]);
  });

  it("treats a one-character answer as unanswered", () => {
    expect(unansweredPrompts(prompts, ["x", "y", "z"])).toEqual([0, 1, 2]);
  });

  it("is empty once every question has a real answer", () => {
    expect(unansweredPrompts(prompts, ["real", "real", "real"])).toEqual([]);
  });

  it("counts a missing answer array entry as unanswered", () => {
    expect(unansweredPrompts(prompts, ["real"])).toEqual([1, 2]);
  });
});

describe("submission requires at least one real answer", () => {
  it("accepts one genuine answer", () => {
    expect(hasAnyAnswer(["", "I saw the plan screen", ""])).toBe(true);
  });

  it("refuses an entirely empty form", () => {
    expect(hasAnyAnswer(["", "  ", undefined])).toBe(false);
  });

  it("refuses a form holding only a stray character", () => {
    expect(hasAnyAnswer(["a"])).toBe(false);
  });
});
