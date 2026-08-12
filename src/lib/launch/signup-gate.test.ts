import { describe, it, expect } from "vitest";
import { detectUnsupportedEvidence } from "./evidence-capabilities";
import { anchorIssues } from "./validate-mission";
import { buildObservationCorpus } from "./validate-mission";

/**
 * TWO GATE BUGS that killed real plans (token-watcher iL_bMe3wvC09 → needs_input, 3 of 4 candidates
 * rejected). Both are general: they break signup missions and smart-quote products on ANY site.
 */
describe("the gate no longer rejects a mission for the TESTER logging in", () => {
  it("ALLOWS 'once logged in, click Create' in instructions (that's the real work)", () => {
    expect(
      detectUnsupportedEvidence({
        instructions: "1. Sign up for an account. 2. Once logged in, click 'Create Agent'.",
        criteria: ["The tester creates an agent and the confirmation heading appears"],
        evidenceRequirements: ["Quote the exact confirmation heading shown after creating."],
      }),
    ).toBeNull();
  });

  it("still REJECTS evidence Sage genuinely cannot fetch", () => {
    expect(
      detectUnsupportedEvidence({
        instructions: "Create an agent.",
        criteria: ["done"],
        evidenceRequirements: ["Provide a screenshot of your logged-in dashboard."],
      }),
    ).not.toBeNull();
    expect(
      detectUnsupportedEvidence({
        instructions: "Create an agent.",
        criteria: ["done"],
        evidenceRequirements: ["Paste your authenticated session export."],
      }),
    ).not.toBeNull();
  });
});

describe("anchors survive typographic quotes", () => {
  it("a curly apostrophe in the product matches a straight one in the anchor (and vice-versa)", () => {
    const corpus = buildObservationCorpus([], {
      ran: true, mode: "static", pages: [], states: [],
      docs: [{ url: "https://x.test/docs", title: "Docs", excerpt: "Don’t have an account? Create one." }],
    } as never);
    expect(anchorIssues({ anchors: ["Don't have an account? Create one."] }, corpus)).toEqual([]);
    expect(anchorIssues({ anchors: ["Don’t have an account? Create one."] }, corpus)).toEqual([]);
  });

  it("a genuinely absent anchor is still rejected", () => {
    const corpus = buildObservationCorpus([], {
      ran: true, mode: "static", pages: [], states: [],
      docs: [{ url: "https://x.test/docs", title: "Docs", excerpt: "Welcome to the site" }],
    } as never);
    expect(anchorIssues({ anchors: ["Zoom Control Panel"] }, corpus).length).toBeGreaterThan(0);
  });
});
