import { describe, expect, it } from "vitest";
import { checkStatedTerms, readStatedTerms, statedAmounts } from "./stated-terms";

const m = (rewardUsd: number, slots = 1, rewardLocal?: number) => ({ rewardUsd, slots, rewardLocal });

describe("readStatedTerms — the founder's own arithmetic", () => {
  it("reads the total from the sum identity the founder wrote out", () => {
    const t = readStatedTerms(
      "fund my cousin's shop $60 in three milestones: $20 when the shop page is published, $20 when the first product is listed, $20 when the first sale is announced on the page",
    );
    expect(t.totalAmount).toBe(60);
    expect(t.milestoneCount).toBe(3);
  });

  it("reads amounts written with a currency word instead of a symbol", () => {
    expect(statedAmounts("pay 50 dollars, 30 USD and 20 usdc")).toEqual([50, 30, 20]);
  });

  it("reads thousands separators", () => {
    expect(statedAmounts("$1,200 in two payments of $600 and $600")).toEqual([1200, 600, 600]);
  });

  it("reads a spelled-out tranche count", () => {
    expect(readStatedTerms("release it in four stages").milestoneCount).toBe(4);
    expect(readStatedTerms("split into 2 tranches").milestoneCount).toBe(2);
  });
});

describe("readStatedTerms — stays silent when the founder did not spell it out", () => {
  it("infers no total from a budget mentioned alongside a price", () => {
    // "I have $500, spend $50" satisfies no sum identity — inferring 500 would block an honest plan.
    expect(readStatedTerms("I have a $500 budget, pay $50 for a landing page").totalAmount).toBeNull();
  });

  it("infers no total from equal tranches with no total named", () => {
    expect(readStatedTerms("pay $20, then $20, then $20").totalAmount).toBeNull();
  });

  it("infers no total from two equal amounts — they are two tranches, not a total plus one", () => {
    // With only two amounts the sum identity is satisfied by any equal pair, which would read
    // "$50 and $50" as a $50 total and flag the correct $100 plan. Three is the floor.
    expect(readStatedTerms("pay $50 and $50").totalAmount).toBeNull();
    expect(checkStatedTerms("pay $50 and $50 for the two pages", [m(50), m(50)])).toEqual([]);
  });

  it("infers no total from a single amount", () => {
    expect(readStatedTerms("pay my designer $50 when the logo page is live").totalAmount).toBeNull();
  });

  it("does not read a bare number as money", () => {
    expect(statedAmounts("in 2024 we shipped 3 products")).toEqual([]);
  });

  it("does not read a count from a noun that is not a tranche", () => {
    expect(readStatedTerms("pay 3 testers $5 each").milestoneCount).toBeNull();
  });
});

describe("checkStatedTerms — contradictions between the words and the plan", () => {
  const utterance =
    "fund my cousin's shop $60 in three milestones: $20 when the shop page is published, $20 when the first product is listed, $20 when the first sale is announced";

  it("passes the plan the founder actually asked for", () => {
    expect(checkStatedTerms(utterance, [m(20), m(20), m(20)])).toEqual([]);
  });

  it("catches the measured failure: one milestone at $20 instead of three at $60", () => {
    const out = checkStatedTerms(utterance, [m(20)]);
    expect(out).toContainEqual({ field: "count", stated: 3, planned: 1 });
    expect(out).toContainEqual({ field: "total", stated: 60, planned: 20 });
  });

  it("catches a dropped tranche even when each surviving amount is right", () => {
    expect(checkStatedTerms(utterance, [m(20), m(20)]).map((x) => x.field)).toEqual(["count", "total"]);
  });

  it("counts slots into the planned total", () => {
    // 3 milestones is what they asked for; $20 x 2 slots each pays $120, not $60.
    expect(checkStatedTerms(utterance, [m(20, 2), m(20, 2), m(20, 2)])).toEqual([
      { field: "total", stated: 60, planned: 120 },
    ]);
  });

  it("compares a non-USD plan in the currency the founder spoke", () => {
    const jmd = "pay J$9,000 in three milestones: J$3,000, J$3,000, J$3,000";
    // rewardUsd is the converted amount and must NOT be what the founder's words are checked against.
    expect(checkStatedTerms(jmd, [m(19.2, 1, 3000), m(19.2, 1, 3000), m(19.2, 1, 3000)])).toEqual([]);
    expect(checkStatedTerms(jmd, [m(19.2, 1, 3000)]).map((x) => x.field)).toEqual(["count", "total"]);
  });

  it("skips the total when only some milestones carry a local amount", () => {
    const jmd = "pay J$9,000 in three milestones: J$3,000, J$3,000, J$3,000";
    expect(checkStatedTerms(jmd, [m(19.2, 1, 3000), m(19.2), m(19.2, 1, 3000)])).toEqual([]);
  });

  it("says nothing when the founder stated nothing to check", () => {
    expect(checkStatedTerms("pay my designer $50 when the logo ships", [m(50)])).toEqual([]);
    expect(checkStatedTerms("pay my designer $50 when the logo ships", [m(75)])).toEqual([]);
  });

  it("never fires on an empty plan (the schema rejects that first)", () => {
    expect(checkStatedTerms(utterance, [])).toEqual([]);
  });
});
