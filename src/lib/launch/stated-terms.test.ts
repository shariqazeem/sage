import { describe, expect, it } from "vitest";
import { checkStatedTerms, mentionsMoney, readStatedTerms, statedAmounts, statedTermsCorrection } from "./stated-terms";

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

describe("readStatedTerms — the total the founder labelled as one", () => {
  const vague =
    "I want to give a small grant to a market seller I know — half when she publishes her catalogue online and half when she posts her first customer review. $40 total.";

  it("reads a total the founder named, and the two tranches they described as halves", () => {
    // MEASURED by P-DIRECT: this compiled as ONE $20 milestone. The tranches are words, not
    // numbers, so the sum identity cannot see them — but "$40 total" and "half ... half" can.
    expect(readStatedTerms(vague)).toEqual({ totalAmount: 40, milestoneCount: 2 });
  });

  it("catches that measured drift", () => {
    expect(checkStatedTerms(vague, [m(20)])).toEqual([
      { field: "count", stated: 2, planned: 1 },
      { field: "total", stated: 40, planned: 20 },
    ]);
    expect(checkStatedTerms(vague, [m(20), m(20)])).toEqual([]);
  });

  it("reads the label on either side of the amount", () => {
    expect(readStatedTerms("total of $75 for the work").totalAmount).toBe(75);
    expect(readStatedTerms("total: 75 USD").totalAmount).toBe(75);
    expect(readStatedTerms("pay 75 dollars in total").totalAmount).toBe(75);
  });

  it("does not read a budget as a total — spending part of one is honest", () => {
    expect(readStatedTerms("I have a $500 budget, pay $50 for a landing page").totalAmount).toBeNull();
  });

  it("does not read a ceiling as a total — a plan under it is correct", () => {
    expect(readStatedTerms("spend up to $200 total on this").totalAmount).toBeNull();
    expect(readStatedTerms("at most $200 in total").totalAmount).toBeNull();
    expect(checkStatedTerms("spend up to $200 total on this", [m(50)])).toEqual([]);
  });

  it("prefers the founder's label over the sum identity when both are present", () => {
    const t = readStatedTerms("$60 total in three milestones: $20, $20, $20");
    expect(t.totalAmount).toBe(60);
    expect(t.milestoneCount).toBe(3);
  });

  it("infers nothing from one 'half' with the remainder never described", () => {
    expect(readStatedTerms("pay half up front").milestoneCount).toBeNull();
  });

  it("lets an explicit count win over the fraction reading", () => {
    expect(readStatedTerms("three milestones: half, half and the rest").milestoneCount).toBe(3);
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

/**
 * THE PRICE NOBODY NAMED.
 *
 * "I want to pay someone to design a logo for me" compiled into a campaign at a number the model
 * chose (P-DIRECT, pd-vague-no-amount). Every gate downstream passed it, because an invented $25 is
 * exactly as internally consistent as a stated one — the only thing that contradicts it is that the
 * founder never said it. This is the money invariant at its earliest point: transcribe, never author.
 */
describe("checkStatedTerms — an amount the founder never named", () => {
  const plan = [{ rewardUsd: 25, slots: 1 }];

  it("fires when the founder's words carry no price at all", () => {
    const m = checkStatedTerms("I want to pay someone to design a logo for me", plan);
    expect(m).toEqual([{ field: "invented", stated: 0, planned: 25 }]);
  });

  it("is silent the moment they name one, however casually", () => {
    expect(checkStatedTerms("pay someone $25 to design a logo", plan)).toEqual([]);
    expect(checkStatedTerms("25 usd for a logo please", plan)).toEqual([]);
  });

  /*
    The two errors here are not symmetric: not noticing a price REFUSES a founder who stated one,
    while noticing one that was not there only leaves the guard silent — where the product already
    was. So presence is read generously, and never used for arithmetic.
  */
  it("recognises a price the founder wrote in words, or with no currency at all", () => {
    for (const t of [
      "pay my designer fifty dollars when the logo page is live",
      "pay her 50 when the logo is live",
      "twenty five usd for the translation",
      "I'll give a market seller J$10,000 in two parts",
    ]) {
      expect(mentionsMoney(t)).toBe(true);
      expect(checkStatedTerms(t, plan)).toEqual([]);
    }
  });

  it("still sees no price where a founder genuinely named none", () => {
    for (const t of [
      "I want to pay someone to design a logo for me",
      "can you find me someone to write our docs",
      "I need a translator for my menu",
    ]) {
      expect(mentionsMoney(t)).toBe(false);
    }
  });

  it("reads the WHOLE conversation, so a price stated two turns ago still counts", () => {
    const m = checkStatedTerms("yes, go ahead", plan, {
      allFounderText: "pay my designer $25 when the logo page is live\nyes, go ahead",
    });
    expect(m).toEqual([]);
  });

  it("still fires when nothing anywhere in the conversation named a price", () => {
    const m = checkStatedTerms("yes, go ahead", plan, {
      allFounderText: "I want to pay someone to design a logo\nyes, go ahead",
    });
    expect(m.map((x) => x.field)).toEqual(["invented"]);
  });

  it("counts a local-currency plan by what the founder would have said", () => {
    const m = checkStatedTerms("I need a catalogue built", [{ rewardUsd: 30, rewardLocal: 5000, slots: 2 }]);
    expect(m).toEqual([{ field: "invented", stated: 0, planned: 10_000 }]);
  });

  it("says nothing about an empty plan", () => {
    expect(checkStatedTerms("design me a logo", [])).toEqual([]);
  });
});

describe("statedTermsCorrection — an invented price asks, it does not rebuild", () => {
  it("tells the model to ask rather than to try again", () => {
    const s = statedTermsCorrection([{ field: "invented", stated: 0, planned: 25 }]);
    expect(s).toMatch(/not said what this pays/i);
    expect(s).toMatch(/Do not create the campaign/i);
    expect(s).toMatch(/Ask them/i);
    // Rebuilding is the WRONG instruction here — there is nothing to rebuild from.
    expect(s).not.toMatch(/Rebuild it/i);
  });
});
