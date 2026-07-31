import { describe, it, expect } from "vitest";
import { verdictStillApplies } from "./observation-verify";

/**
 * REGRESSION — one week of CommonStack usage: **3,766 judge calls costing $8.65**, against roughly
 * ELEVEN submissions in total. It was 81% of all LLM spend on the account.
 *
 * The sweep re-runs the decision pipeline over every pending submission on every tick (~5 minutes),
 * and the observation judge is an LLM call. Nothing the judge reads changes between ticks — the
 * tester's account text and the pinned corpus are both immutable — so every one of those calls
 * returned the identical verdict and was billed for it.
 *
 * It compounded with the vacuous-policy covenant defect: submissions frozen in `pending` were
 * re-judged 288 times a day, forever. One bug froze the work; the other charged for noticing.
 *
 * The reuse must be CONSERVATIVE. Paying out on a stale verdict would be far worse than paying for a
 * redundant call, so anything missing, mismatched or malformed re-judges.
 */

const DIGEST = "0xb2f424177c28";
const shadow = (over: Record<string, unknown> = {}) => ({
  barPass: true,
  attempt: 1,
  corpusDigest: DIGEST,
  ...over,
});

describe("a verdict is reused only when the judge's inputs are provably unchanged", () => {
  it("reuses when attempt and corpus both match", () => {
    expect(verdictStillApplies(shadow(), 1, DIGEST)).toBe(true);
  });

  it("reuses a FAILING verdict too — a hold need not be re-bought either", () => {
    expect(verdictStillApplies(shadow({ barPass: false }), 1, DIGEST)).toBe(true);
  });
});

describe("it re-judges whenever anything the judge reads could have moved", () => {
  it("re-judges after the tester revises (attempt incremented)", () => {
    expect(verdictStillApplies(shadow({ attempt: 1 }), 2, DIGEST)).toBe(false);
  });

  it("re-judges when the pinned corpus changed", () => {
    expect(verdictStillApplies(shadow(), 1, "0xdifferent")).toBe(false);
  });

  it("re-judges when there is no prior verdict at all", () => {
    expect(verdictStillApplies(null, 1, DIGEST)).toBe(false);
    expect(verdictStillApplies(undefined, 1, DIGEST)).toBe(false);
  });
});

describe("a malformed or legacy shadow always re-judges — never a stale payout", () => {
  it.each([
    ["missing barPass", { barPass: undefined }],
    ["barPass not a boolean", { barPass: "yes" }],
    ["missing attempt (legacy row, written before this field existed)", { attempt: undefined }],
    ["attempt not a number", { attempt: "1" }],
    ["missing corpusDigest", { corpusDigest: undefined }],
    ["corpusDigest not a string", { corpusDigest: 12345 }],
  ])("re-judges when %s", (_label, over) => {
    expect(verdictStillApplies(shadow(over), 1, DIGEST)).toBe(false);
  });

  it("re-judges on an empty object", () => {
    expect(verdictStillApplies({}, 1, DIGEST)).toBe(false);
  });
});

describe("what this would have saved", () => {
  it("collapses a week of identical re-judgements to one call", () => {
    // 288 sweep ticks/day x 7 days, same attempt, same corpus — every one of them redundant.
    const ticks = 288 * 7;
    const prior = shadow();
    let judged = 0;
    for (let i = 0; i < ticks; i++) {
      if (!verdictStillApplies(prior, 1, DIGEST)) judged++;
    }
    expect(judged).toBe(0);
  });

  it("still judges once per genuine revision", () => {
    const prior = shadow({ attempt: 1 });
    expect(verdictStillApplies(prior, 1, DIGEST)).toBe(true); // same attempt → reuse
    expect(verdictStillApplies(prior, 2, DIGEST)).toBe(false); // tester revised → judge again
  });
});
