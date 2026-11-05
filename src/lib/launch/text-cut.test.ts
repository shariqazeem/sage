import { describe, expect, it } from "vitest";
import { cutAtBoundary } from "./text-cut";

describe("cutAtBoundary: a worker never reads a step cut mid-word", () => {
  it("leaves text under the limit alone", () => {
    expect(cutAtBoundary("Open the repo. Run the tests.", 100)).toBe("Open the repo. Run the tests.");
  });

  it("cuts at the last whole line", () => {
    const steps = Array.from({ length: 40 }, (_, i) => `${i + 1}. Do step number ${i + 1} carefully and write down what happened.`).join("\n");
    const out = cutAtBoundary(steps, 1000);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(steps.startsWith(out)).toBe(true);
    expect(out.endsWith("happened.")).toBe(true);
  });

  it("cuts at a sentence end inside one long paragraph", () => {
    const para = Array.from({ length: 60 }, (_, i) => `Sentence ${i} says something useful`).join(". ") + ".";
    const out = cutAtBoundary(para, 700);
    expect(out.length).toBeLessThanOrEqual(700);
    expect(out.endsWith(".")).toBe(true);
  });

  it("falls back to a word boundary when there is no sentence or line near the end", () => {
    const words = "word ".repeat(400).trim();
    const out = cutAtBoundary(words, 333);
    expect(out.length).toBeLessThanOrEqual(333);
    expect(out.endsWith("word")).toBe(true);
  });
});

describe("a drafted deadline keeps both parts of a schedule", () => {
  it("is not cut at 80 characters mid-phrase", async () => {
    const { gigDraftSchema } = await import("./gig-draft");
    const deadline = "Shoot on any Friday or Saturday this month, between 10am and 3pm. Deliver the edited photos within 7 days.";
    const parsed = gigDraftSchema.safeParse({
      kind: "gig", title: "Photograph sixty sarees", who: "a photographer", slots: 1, deadline,
      milestones: [{ title: "Photograph the sarees", deliverable: "Sixty edited photos are shared in a Drive folder", instructions: "1. Photograph each saree.\n2. Share the folder.", criteria: ["Sixty photos, one per saree", "Each file is named by its tag"], evidence: { kind: "artifact_url", allowedHosts: ["drive.google.com"] } }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.deadline).toBe(deadline);
  });
});
