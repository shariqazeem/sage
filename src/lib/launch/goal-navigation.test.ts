import { describe, it, expect } from "vitest";
import { chooseGoalPath, goalWantsSearch, goalTerms } from "./browser-controller";

/**
 * REGRESSION — the founder's own commonstack.ai run. The goal named the AI playground. The header
 * linked straight to it. Sage instead typed "test" into the site's SEARCH box, submitted it, got
 * "No options", then re-clicked the hero three times ("attempted click (no effect)") and finished
 * with six states all on the homepage. Every mission it wrote was about a Playground it had never
 * opened, and the private key was pinned entirely from homepage variants.
 *
 * Two general defects, two pure fixes:
 *  · a site-wide search box is not a wizard step — filling it only counts when the GOAL asks to
 *    search, otherwise the fill-before-advance rule hijacks the opening turns of any product that
 *    has search in its nav;
 *  · links are the web's API — when the goal names something the current screen cannot click but a
 *    discovered path matches, go there instead of burning the budget in place.
 */

describe("a search box is only a step when the goal asks to search", () => {
  it.each([
    "let users search for models",
    "I want testers to find a model by name",
    "check that filtering the catalogue works",
    "does look up work on the docs",
    "the query returns results",
  ])("true for: %s", (goal) => {
    expect(goalWantsSearch(goal)).toBe(true);
  });

  it.each([
    "I want users to test this product and use any ai models in playground",
    "make users launch a campaign",
    "a first-time visitor should reach the pricing page",
    "talk to the character and see the reply",
  ])("false for: %s", (goal) => {
    expect(goalWantsSearch(goal)).toBe(false);
  });

  it("is the exact founder goal that triggered the bug", () => {
    // If this ever returns true again, the nav search box becomes a "form to complete" and the run
    // is spent on the homepage exactly as it was.
    expect(
      goalWantsSearch(
        "I want users to test this product and use any ai models in playground",
      ),
    ).toBe(false);
  });

  it("does not fire on a word that merely CONTAINS a search verb", () => {
    expect(goalWantsSearch("the researcher writes a summary")).toBe(false);
    expect(goalWantsSearch("confirm the findings page loads")).toBe(false);
  });
});

describe("the goal picks the path when the screen cannot", () => {
  const paths = [
    { path: "/pricing", label: "Pricing" },
    { path: "/playground", label: "Playground" },
    { path: "/models", label: "Model Library" },
    { path: "/docs", label: "Docs" },
  ];
  const terms = goalTerms("use the AI playground");

  it("matches on the link LABEL", () => {
    expect(chooseGoalPath([{ path: "/x7", label: "Playground" }], terms, new Set())).toBe("/x7");
  });

  it("matches on the path SLUG when the label is unhelpful", () => {
    expect(chooseGoalPath([{ path: "/playground", label: "→" }], terms, new Set())).toBe("/playground");
  });

  it("picks the playground over the other real links", () => {
    expect(chooseGoalPath(paths, terms, new Set())).toBe("/playground");
  });

  it("never returns a path it already visited", () => {
    expect(chooseGoalPath(paths, terms, new Set(["/playground"]))).toBeNull();
  });

  it("returns null when nothing matches, rather than guessing", () => {
    expect(chooseGoalPath(paths, goalTerms("check the checkout flow"), new Set())).toBeNull();
  });

  it("returns null with no terms — an unstated goal steers nothing", () => {
    expect(chooseGoalPath(paths, [], new Set())).toBeNull();
  });

  it("returns null on an empty path list (nothing harvested yet)", () => {
    expect(chooseGoalPath([], terms, new Set())).toBeNull();
  });

  it("prefers the STRONGER match when two paths both hit", () => {
    const two = [
      { path: "/ai", label: "AI" },
      { path: "/ai-playground", label: "AI Playground" },
    ];
    expect(chooseGoalPath(two, terms, new Set())).toBe("/ai-playground");
  });

  it("treats separators in a slug as word breaks", () => {
    expect(
      chooseGoalPath([{ path: "/tools/ai_playground?tab=1", label: "" }], terms, new Set()),
    ).toBe("/tools/ai_playground?tab=1");
  });
});
