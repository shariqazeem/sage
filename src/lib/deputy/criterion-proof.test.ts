import { describe, it, expect } from "vitest";
import {
  proveCriteria,
  type PrivateKey,
  type CriterionEvidenceV1,
} from "./observation-verify";

/**
 * CRITERION-LEVEL PROOF — the gate stops counting hidden details and starts asking whether each
 * criterion was actually evidenced.
 *
 * The flat bar is loose in both directions. It pays an account that named three things from the
 * ENTRY screen for a mission whose criterion is the conversation, and it holds a concise tester who
 * evidenced every criterion but only reached two matches. Sage already knows which observations
 * back which criterion; these tests pin that the slice-per-criterion check uses it correctly and
 * never reads "unprovable" as "proven".
 */

/** a key spread over three screens, phrased the way the distiller stores observations */
const key: PrivateKey = {
  observations: [
    { source: "state:0", text: "tap to step inside the garden" },
    { source: "state:0", text: "a gentle world to heal" },
    { source: "state:3", text: "make a wish at the wishing tree" },
    { source: "state:3", text: "yaras grove the hearth fountain plaza" },
    { source: "state:7", text: "what brings you here today friend" },
    { source: "state:7", text: "a heavy heart a restless mind" },
  ],
  distinctSources: 3,
  digest: "0xkey",
};

/** criterion 0 is proven by the entry screens, criterion 1 by the conversation screen */
const evidence: CriterionEvidenceV1[] = [
  { criterionIndex: 0, keySources: ["state:0", "state:3"] },
  { criterionIndex: 1, keySources: ["state:7"] },
];

describe("a criterion is proven only by its OWN evidence", () => {
  it("an account that only describes the entry does NOT prove the conversation", () => {
    // this account would score 2 distinct sources on the flat bar and read as 'nearly there'
    const p = proveCriteria(
      "I clicked tap to step inside the garden and later found make a wish at the wishing tree",
      key,
      evidence,
    );
    expect(p.verdicts[0]!.proven).toBe(true);
    expect(p.verdicts[1]!.proven).toBe(false);
    expect(p.allProven).toBe(false);
    expect(p.missingCriteria).toEqual([1]);
  });

  it("an account that evidences BOTH criteria passes, even though it is concise", () => {
    // only two matches total — under the flat bar of three, yet every criterion is evidenced
    const p = proveCriteria(
      "I went tap to step inside the garden, then she asked what brings you here today friend",
      key,
      evidence,
    );
    expect(p.allProven).toBe(true);
    expect(p.missingCriteria).toEqual([]);
  });

  it("three matches all from one screen no longer buys a payout", () => {
    const p = proveCriteria(
      "I saw tap to step inside the garden and a gentle world to heal and make a wish at the wishing tree",
      key,
      evidence,
    );
    expect(p.allProven).toBe(false);
    expect(p.missingCriteria).toEqual([1]);
  });
});

describe("unprovable is never proven", () => {
  it("a criterion with no evidence slice is reported unprovable, not passed", () => {
    const p = proveCriteria("anything at all", key, [
      { criterionIndex: 0, keySources: ["state:0"] },
      { criterionIndex: 1, keySources: [] },
    ]);
    expect(p.unprovableCriteria).toEqual([1]);
    expect(p.verdicts[1]!.proven).toBe(false);
  });

  it("an empty contract proves nothing", () => {
    const p = proveCriteria("tap to step inside the garden", key, []);
    expect(p.allProven).toBe(false);
  });

  it("a contract of only unprovable criteria never passes", () => {
    const p = proveCriteria("tap to step inside the garden", key, [
      { criterionIndex: 0, keySources: [] },
    ]);
    expect(p.allProven).toBe(false);
  });
});

describe("the anti-guess rules still apply inside every slice", () => {
  it("an empty account proves nothing", () => {
    for (const acct of ["", "   ", null, undefined]) {
      const p = proveCriteria(acct, key, evidence);
      expect(p.allProven).toBe(false);
      expect(p.missingCriteria).toEqual([0, 1]);
    }
  });

  it("a paraphrase that shares enough content words still counts", () => {
    // the fuzzy-overlap matcher is inherited unchanged from verifyAgainstKey
    const p = proveCriteria(
      "the prompt said tap to step inside the garden area, and she asked what brings you here today, friend",
      key,
      evidence,
    );
    expect(p.allProven).toBe(true);
  });

  it("matches in another criterion's slice never leak into this one", () => {
    const p = proveCriteria("what brings you here today friend", key, evidence);
    expect(p.verdicts[0]!.matchedSources).toBe(0);
    expect(p.verdicts[1]!.matchedSources).toBe(1);
  });
});

describe("the verdict is reportable without leaking the key", () => {
  it("carries indexes and counts only — never observation text", () => {
    const p = proveCriteria("tap to step inside the garden", key, evidence);
    const blob = JSON.stringify(p);
    for (const o of key.observations) expect(blob).not.toContain(o.text);
    expect(blob).toContain("criterionIndex");
  });
});
