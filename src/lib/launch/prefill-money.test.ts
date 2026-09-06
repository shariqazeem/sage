import { describe, expect, it } from "vitest";
import { prefillMoneyFromWords } from "./prefill-money";

describe("prefillMoneyFromWords — the founder's sentence fills the money fields, never a model", () => {
  it("a J$ grant in two equal parts → currency JMD and the split total", () => {
    const r = prefillMoneyFromWords("Give a market seller J$1,600 in two equal parts — half when her catalogue page is online, half when she posts her first review.", 2);
    expect(r.currency).toBe("JMD");
    expect(r.splitTotal).toBe(1600);
    expect(r.perUnit).toBeNull();
  });
  it("a per-person gig → the unit price and the headcount", () => {
    const r = prefillMoneyFromWords("Pay J$800 to each of 8 people who publish a post of at least 250 words.", 1);
    expect(r.currency).toBe("JMD");
    expect(r.perUnit).toBe(800);
    expect(r.headcount).toBe(8);
    expect(r.splitTotal).toBeNull();
  });
  it("says nothing when the words are ambiguous", () => {
    expect(prefillMoneyFromWords("I have a $500 budget and want to pay $50 for a logo", 1).perUnit).toBeNull();
    expect(prefillMoneyFromWords("Pay $300 across three milestones", 3).splitTotal).toBeNull();
  });
  it("USD stays the default when no currency is written", () => {
    expect(prefillMoneyFromWords("Pay $20 to whoever fixes the checkout bug", 1)).toMatchObject({ currency: null, perUnit: 20 });
  });
});
