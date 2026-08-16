import { describe, it, expect } from "vitest";
import { unwrapLoneFence, contentStructure, extractLoneObject } from "./complete";

/**
 * THE OUTAGE THIS FIXES. Measured on prod 2026-08-15: the grounded architect returned HTTP 200,
 * finish_reason "stop", 4,168 completion tokens — and content shape "fenced". The strict reader
 * refused it as `llm_strict_not_object`, so EVERY inspection from 13 Aug fell back to the legacy
 * planner, which has no goal journey. The founder's goal was being read by nothing.
 *
 * A fence is a wrapper, not a malformation. Everything the strictness exists for must still fail.
 */
describe("unwrapLoneFence — reads an equivalent shape, never a broken one", () => {
  it("unwraps the exact shape that took the planner down", () => {
    expect(unwrapLoneFence('```json\n{"missions":[]}\n```')).toBe('{"missions":[]}');
  });

  it("unwraps a bare fence with no language tag", () => {
    expect(unwrapLoneFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("leaves a bare object exactly as it was — the common path is untouched", () => {
    expect(unwrapLoneFence('{"a":1}')).toBe('{"a":1}');
  });

  it("REFUSES prose after the opening fence marker", () => {
    const t = '```here is your plan\n{"a":1}\n```';
    expect(unwrapLoneFence(t)).toBe(t);
  });

  it("REFUSES two BLOCKS — two candidate answers, no principled way to choose", () => {
    const t = '```json\n{"a":1}\n```\nand also\n```json\n{"b":2}\n```';
    expect(unwrapLoneFence(t)).toBe(t);
  });

  it("READS one block with markdown commentary after it — the measured 2,241-char shape", () => {
    // fenceCount 2, endsWithFence false, lastChar "*": a complete plan plus the model's own notes.
    const t = '```json\n{"missions":[]}\n```\n\n**Notes:** I focused on the launch flow.';
    expect(unwrapLoneFence(t)).toBe('{"missions":[]}');
  });

  it("READS a fence that never closes — finish_reason:stop already ruled out truncation", () => {
    // measured 2026-08-15: after the first fix shipped, the architect failed AGAIN on a 455-token
    // `stop` response whose fence never closed. Refusing it was a second guess at truncation that
    // the finish_reason check one line earlier had already answered.
    expect(unwrapLoneFence('```json\n{"a":1}')).toBe('{"a":1}');
  });

  it("REFUSES a single-line fence — that is not a fenced document", () => {
    const t = '```{"a":1}```';
    expect(unwrapLoneFence(t)).toBe(t);
  });

  it("an unwrapped ARRAY still fails the object check downstream", () => {
    // unwrapping is shape-only; parseStrict still rejects a non-object
    expect(unwrapLoneFence('```json\n[1,2]\n```')).toBe("[1,2]");
  });

  it("does not touch prose that merely mentions a fence", () => {
    const t = 'I cannot do that. ```json';
    expect(unwrapLoneFence(t)).toBe(t);
  });
});

describe("contentStructure — enough to fix a refusal, never enough to reconstruct it", () => {
  it("names the exact branch for an unclosed fence", () => {
    const s = contentStructure('```json\n{"missions":[]}');
    expect(s).toMatchObject({ startsWithFence: true, endsWithFence: false, openerToken: "json", fenceCount: 1, unwrappedIsObject: true });
  });

  it("names the branch for prose after the fence marker", () => {
    expect(contentStructure('```here is your plan\n{"a":1}\n```')).toMatchObject({ openerToken: "other", unwrappedIsObject: false });
  });

  it("carries no content — only structure", () => {
    const s = contentStructure('```json\n{"secret":"SECRET_LEAK_TOKEN"}\n```');
    expect(JSON.stringify(s)).not.toContain("SECRET_LEAK_TOKEN");
    expect(JSON.stringify(s)).not.toContain("secret");
  });
});

/**
 * A REAL FOUNDER LOST FOUR MINUTES TO THIS. Measured on prod 2026-08-16: they pointed Sage at their
 * product, waited for the inspection, and got "Sage's reviewer returned an unusable response" —
 * because the model wrote a sentence before its JSON. The plan was complete and correct. Retrying
 * does not help; the gateway's shape bias is per-prompt, so the same prompt returns the same shape.
 */
describe("extractLoneObject — one complete object, prose around it", () => {
  it("reads the object the founder's failed run threw away", () => {
    expect(extractLoneObject('Here is your plan:\n{"missions":[]}')).toBe('{"missions":[]}');
  });

  it("reads it with prose on BOTH sides", () => {
    expect(extractLoneObject('Sure! {"a":1} — let me know if you want changes.')).toBe('{"a":1}');
  });

  it("leaves a bare object untouched — the common path never changes", () => {
    expect(extractLoneObject('{"a":1}')).toBe('{"a":1}');
  });

  it("REFUSES two candidate objects — that is real ambiguity, not a wrapper", () => {
    const t = 'first {"a":1} then {"b":2}';
    expect(extractLoneObject(t)).toBe(t);
  });

  it("REFUSES an unbalanced object (truncated mid-write)", () => {
    const t = 'here: {"a":{"b":1}';
    expect(extractLoneObject(t)).toBe(t);
  });

  it("a brace inside a STRING cannot unbalance the scan", () => {
    expect(extractLoneObject('note: {"tip":"use { and } freely","n":2}')).toBe('{"tip":"use { and } freely","n":2}');
  });

  it("an escaped quote inside a string does not end it", () => {
    expect(extractLoneObject('x {"q":"say \\"hi\\" {","n":1}')).toBe('{"q":"say \\"hi\\" {","n":1}');
  });

  it("REFUSES an array — the wrong answer, not a wrapped right one", () => {
    expect(extractLoneObject('[{"a":1}]')).toBe('[{"a":1}]');
  });

  it("prose with no object at all is returned unchanged", () => {
    expect(extractLoneObject("I cannot help with that.")).toBe("I cannot help with that.");
  });
});
