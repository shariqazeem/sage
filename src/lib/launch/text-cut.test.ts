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
