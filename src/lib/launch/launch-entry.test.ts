import { describe, it, expect } from "vitest";
import { startInspection } from "./start";
import { buildArchitectUser } from "./mission-prompt";

/**
 * REGRESSION — the web /launch wizard, reported by a founder.
 *
 * Entering a product URL and a goal, then setting a budget, failed on step TWO with "Target users is
 * required" — a field step one never showed. The wizard had gone 3 steps → 2 ("the goal carries
 * intent") and stopped asking, keeping `targetUsers: ""` in state, but the server validator was never
 * updated. Every founder using the product's primary front door was rejected. It had been closed.
 *
 * Optional is also the right answer rather than merely the compatible one: who would use a product is
 * something Sage can infer from the product and the stated goal, and the standing principle is to ask
 * only for genuine decisions.
 */

/** A fresh request id per case — `startInspection` dedupes on it, so a shared one returns the FIRST
 *  test's job to every later test and silently asserts nothing. */
let n = 0;
const base = () => ({
  productUrl: "https://commonstack.ai",
  goal: "I want users to test this product and use any ai models in playground",
  budgetUsd: 5,
  founder: "anonymous",
  planningRequestId: `req_test_${++n}`,
});

describe("the founder's real input is accepted", () => {
  it("accepts the exact submission that was failing", () => {
    const r = startInspection({ ...base(), targetUsers: "" });
    expect(r.ok).toBe(true);
  });

  it("accepts it when the field is absent entirely", () => {
    const r = startInspection({ ...base(), targetUsers: undefined });
    expect(r.ok).toBe(true);
  });

  it("still accepts a founder who DOES describe their users", () => {
    const r = startInspection({ ...base(), targetUsers: "developers evaluating LLM APIs" });
    expect(r.ok).toBe(true);
  });

  it("keeps the value when one was given", () => {
    const r = startInspection({ ...base(), targetUsers: "developers evaluating LLM APIs" });
    expect(r.ok && r.job.targetUsers).toBe("developers evaluating LLM APIs");
  });
});

describe("the genuinely required inputs are still required", () => {
  it("accepts an empty goal as DELEGATION — the same door-vs-form bug targetUsers had", () => {
    // The concierge has said "pass goal as an empty string and Sage infers it" since it shipped,
    // and the launch form is goal-optional with chips — yet this validator rejected every such
    // request. An empty goal forces full exploration downstream and cannot trip the goal gate.
    const r = startInspection({ ...base(), goal: "", targetUsers: "" });
    expect(r.ok).toBe(true);
  });

  it("still rejects an over-long goal", () => {
    const r = startInspection({ ...base(), goal: "x".repeat(1300), targetUsers: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects a missing product url", () => {
    const r = startInspection({ ...base(), productUrl: "", targetUsers: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects an over-long target users value", () => {
    const r = startInspection({ ...base(), targetUsers: "x".repeat(801) });
    expect(r.ok).toBe(false);
  });
});

describe("an unstated audience is silence, not an empty label", () => {
  const prompt = (targetUsers: string) =>
    buildArchitectUser("{}", { goal: "test the playground", targetUsers });

  it("omits the line entirely when the founder did not say", () => {
    expect(prompt("")).not.toMatch(/FOUNDER TARGET USERS/);
    expect(prompt("   ")).not.toMatch(/FOUNDER TARGET USERS/);
  });

  it("includes it when they did", () => {
    expect(prompt("developers")).toMatch(/FOUNDER TARGET USERS \(trusted\): developers/);
  });

  it("never emits a labelled blank, which reads as 'this product has no users'", () => {
    expect(prompt("")).not.toMatch(/TARGET USERS \(trusted\):\s*$/m);
  });
});
