import { describe, it, expect } from "vitest";
import { observationVerdictFrom } from "./proof";

/**
 * REGRESSION — the public receipt for the first real autonomous payout
 * (tx 0x8df776…0069) announced `HOLD · 0% confidence · reason no_evidence`, with every criterion
 * marked ✗ and a note reading "not an autonomous payout".
 *
 * All of it false. That payout WAS autonomous: the account matched 5 of 9 distinct sources and the
 * observation bar released it. The page was rendering the URL-LANE brief — the code path the
 * pipeline itself calls meaningless for observation missions, and whose reason codes it skips
 * entirely. The most important public artifact the product has was arguing against its own thesis.
 *
 * The receipt now reads the verdict that actually authorized the payout. It must stay LEAK-SAFE:
 * counts and booleans only, never which observations exist or which matched — the same rule the
 * tester-facing coaching follows, because naming them hands over the answer key.
 */

const shadow = (over: Record<string, unknown> = {}) => ({
  barPass: true,
  distinctSources: 5,
  keyDistinctSources: 9,
  matchedCount: 4,
  corpusDigest: "0xb2f424177c28",
  criteriaCompletePass: false,
  // fields that must NEVER reach the public verdict:
  barReasons: ["few_matches(2<3)"],
  matched: [{ source: "state:4", text: "i felt you arrive" }],
  account: "the tester's raw account text",
  ...over,
});

describe("the receipt reports the verdict that actually authorized the payout", () => {
  const v = observationVerdictFrom(shadow())!;

  it("reads the real numbers", () => {
    expect(v.barPass).toBe(true);
    expect(v.distinctSources).toBe(5);
    expect(v.keySources).toBe(9);
    expect(v.matchedCount).toBe(4);
  });

  it("carries the corpus digest as recomputable provenance", () => {
    expect(v.corpusDigest).toBe("0xb2f424177c28");
  });

  it("flags when the criteria-complete pass decided it", () => {
    expect(observationVerdictFrom(shadow({ criteriaCompletePass: true }))!.criteriaCompletePass).toBe(true);
    expect(v.criteriaCompletePass).toBe(false);
  });
});

describe("LEAK SAFETY — the public verdict is counts only", () => {
  const v = observationVerdictFrom(shadow())!;

  it("exposes no corpus text, matched items, or account text", () => {
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/i felt you arrive/);
    expect(json).not.toMatch(/state:4/);
    expect(json).not.toMatch(/raw account text/);
  });

  it("publishes only the known-safe fields, nothing inherited wholesale", () => {
    expect(Object.keys(v).sort()).toEqual([
      "barPass",
      "corpusDigest",
      "criteriaCompletePass",
      "distinctSources",
      "keySources",
      "matchedCount",
    ]);
  });

  it("does not leak the internal bar reasons", () => {
    expect(JSON.stringify(v)).not.toMatch(/few_matches/);
  });
});

describe("a url-lane payout has no observation verdict, so the brief still renders", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a non-object", "shadow"],
    ["an empty object", {}],
    ["a shadow without barPass", { distinctSources: 5 }],
  ])("returns null for %s", (_label, input) => {
    expect(observationVerdictFrom(input)).toBeNull();
  });
});

describe("malformed counts degrade to zero rather than rendering NaN on a public page", () => {
  it.each([
    ["missing", {}],
    ["a string", "5"],
    ["NaN", NaN],
    ["Infinity", Infinity],
  ])("coerces %s to 0", (_label, bad) => {
    const v = observationVerdictFrom(shadow({ distinctSources: bad, matchedCount: bad, keyDistinctSources: bad }))!;
    expect(v.distinctSources).toBe(0);
    expect(v.matchedCount).toBe(0);
    expect(v.keySources).toBe(0);
  });

  it("keeps a non-string corpus digest out of the payload", () => {
    expect(observationVerdictFrom(shadow({ corpusDigest: 12345 }))!.corpusDigest).toBeNull();
  });
});
