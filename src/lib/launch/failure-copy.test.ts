import { describe, it, expect } from "vitest";
import { friendlyFailure } from "./failure-copy";

/**
 * A founder reported this verbatim: "it gave canary blocked". They had been shown
 * `canary_blocked:no_grounded_plan` — an engineering code — and read it as Sage being broken.
 * Both surfaces (the plan page and the agent) now say the same human sentence.
 */

const CODES = [
  "canary_blocked:no_grounded_plan",
  "canary_blocked:incomplete_action_policy",
  "canary_blocked:founder_goal_incomplete:transition_not_safe",
  "schema_mismatch",
  "invalid_json",
  "truncated_output",
  "provider_timeout",
  "provider_transient",
  "provider_error",
  "llm_not_configured",
  "no_inspected_pages",
  "some_future_code_nobody_wrote_copy_for",
  "architect_fact_not_presented",
];

describe("a founder never sees an engineering code", () => {
  it.each(CODES)("%s reads as a sentence", (code) => {
    const out = friendlyFailure(code);
    expect(out).not.toContain(code);
    expect(out).not.toMatch(/_/); // no snake_case leaks through
    expect(out.length).toBeGreaterThan(20);
    expect(out.trim().endsWith(".")).toBe(true);
  });

  it("names what actually happened for the covenant family", () => {
    const out = friendlyFailure("canary_blocked:no_grounded_plan");
    expect(out).toMatch(/observed/i);
    expect(out).toMatch(/stopped/i);
    // it must not claim the inspection finished, and it tells the founder what to do next
    expect(out).not.toMatch(/plan is ready|completed successfully|all set/i);
    expect(out).toMatch(/try again|tell it/i);
  });

  it("keeps the transient failures actionable", () => {
    expect(friendlyFailure("provider_timeout")).toMatch(/try again/i);
    expect(friendlyFailure("schema_mismatch")).toMatch(/try again/i);
  });
});

describe("edges", () => {
  it("no reason is a plain honest sentence", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(friendlyFailure(v)).toBe("The inspection did not complete.");
    }
  });

  it("a reason already written for humans passes through", () => {
    const human = "The product URL returned 404 for every page Sage tried.";
    expect(friendlyFailure(human)).toBe(human);
  });

  it("is a pure function of its input", () => {
    expect(friendlyFailure("schema_mismatch")).toBe(friendlyFailure("schema_mismatch"));
  });
});
