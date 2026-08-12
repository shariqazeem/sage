import { describe, it, expect } from "vitest";
import { docCandidates } from "./field-test";

/**
 * THE ANSWER-KEY MISS (token-watcher AmtTLqredN1T): the product linked "Read install notes" and Sage
 * read 0 docs, so its corpus knew nothing about what the missions asked testers to do — every
 * submission would have HELD, because the corpus they'd be judged against was empty. Recognising how
 * products actually label their docs is what makes work behind a wall payable at all.
 */
describe("docCandidates recognises how products actually label their docs", () => {
  const labelled = (label: string) => docCandidates([{ path: "/x", label }]);

  it("follows install / setup / sdk / api / reference links", () => {
    for (const l of [
      "Read install notes", "Installation", "Setup", "Set up", "SDK", "API",
      "API Reference", "Developer docs", "Integration guide", "README", "Manual",
    ]) {
      expect(labelled(l), `should follow "${l}"`).toContain("/x");
    }
  });

  it("still follows the classic doc labels", () => {
    for (const l of ["Docs", "Documentation", "Quickstart", "Getting Started", "FAQ", "Tutorial", "Guide"]) {
      expect(labelled(l), `should follow "${l}"`).toContain("/x");
    }
  });

  it("does NOT treat a signup CTA or nav chrome as documentation", () => {
    for (const l of ["Start Free", "Sign up", "Open console", "Log in", "Pricing", "Careers", "Blog"]) {
      expect(docCandidates([{ path: "/cta", label: l }]), `should ignore "${l}"`).not.toContain("/cta");
    }
  });
});
