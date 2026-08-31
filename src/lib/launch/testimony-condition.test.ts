import { describe, expect, it } from "vitest";
import { hasPageBasedEvidence, testimonyCondition, testimonyCorrection } from "./testimony-condition";

/**
 * This gate reads the founder's own words, so its test is a corpus: the measured failure, its
 * honest neighbours, and every real P-DIRECT fixture that must NOT trip it. A false positive here
 * costs a founder one round trip; a false negative is a campaign paying on the unwitnessable.
 */
describe("testimonyCondition — decisions Sage cannot witness", () => {
  it("catches the measured failure verbatim", () => {
    const r = testimonyCondition(
      "Send my cousin $200 when the bank finally approves her loan application.",
    );
    expect(r.hit).toBe(true);
    expect(r.phrase).toBeTruthy();
    // The phrase is THEIR words — the correction quotes it back.
    expect("Send my cousin $200 when the bank finally approves her loan application.").toContain(r.phrase!);
  });

  it("catches the same condition written the other way round", () => {
    expect(testimonyCondition("pay her $50 once the loan is approved by the bank").hit).toBe(true);
    expect(testimonyCondition("$100 when her visa application gets approved").hit).toBe(true);
    expect(testimonyCondition("release the money when the committee awards the prize").hit).toBe(true);
    expect(testimonyCondition("$40 when the landlord accepts her rental application").hit).toBe(true);
  });

  it("catches near-misses whose fix is naming the real surface — a hit costs one round, not the campaign", () => {
    expect(testimonyCondition("pay $30 when the app store approves the app").hit).toBe(true);
    expect(testimonyCondition("$25 when the client approves the final design").hit).toBe(true);
  });

  it("does NOT trip on any real P-DIRECT fixture that must compile", () => {
    const legit = [
      "pay my designer $50 when the logo page is live on our site",
      "I want to give a small grant to a market seller I know — half when she publishes her catalogue online and half when she posts her first customer review. $40 total.",
      "I want to back a friend's catering side business with $90, released in three equal parts: when she publishes her menu page, when she posts her first booking, and when she shows a customer review.",
      "Fund a developer $60 in two steps: $35 when they deploy the contract on-chain and send the transaction, and $25 when the docs page for it is live and public.",
      "I'll pay $4 each to the first 5 people who publish a short walkthrough of my onboarding flow",
      "$30 for a public write-up of our API, and I need it by Friday.",
      "fund my cousin's shop $60 in three milestones: $20 when the shop page is published, $20 when the first product is listed, $20 when the first sale is announced on the page",
    ];
    for (const text of legit) {
      const r = testimonyCondition(text);
      expect(r.hit, `false positive on: ${text}`).toBe(false);
    }
  });

  it("needs the authority and the decision in the SAME clause — distance is meaning", () => {
    // "board" opens the message, the decision verb arrives a sentence later about something else.
    // A whole-text match would read this as the board deciding the payout.
    const r = testimonyCondition(
      "The board asked us to get more user feedback this quarter. Pay $10 to each of 3 people who publish a walkthrough; I'll accept any honest take.",
    );
    expect(r.hit).toBe(false);
  });

  it("an authority MENTIONED is not an authority DECIDING", () => {
    // The bank appears, but nobody's money releases on its decision — no decision verb at all.
    const r = testimonyCondition(
      "the bank asked my cousin for more paperwork — meanwhile pay her $20 when her shop page is live",
    );
    expect(r.hit).toBe(false);
  });

  it("does not read 'a small grant' — our own product noun — as a decision verb", () => {
    expect(testimonyCondition("set up a milestone grant for my cousin, $60 in three parts").hit).toBe(false);
    // The noun right next to an authority word — the exact collision that makes bare-'grant'
    // matching a false positive: the money releases on a page being live, not on any decision.
    expect(
      testimonyCondition(
        "I got a grant from the government program — use $50 of it to pay a designer when the logo page is live",
      ).hit,
    ).toBe(false);
  });

  it("stays quiet on a multisig or DAO condition — that decision lives on-chain, not on a page", () => {
    expect(testimonyCondition("pay the contributor 100 USDC when the multisig executes the payout vote").hit).toBe(false);
  });

  it("known limit, pinned: non-English testimony conditions pass through to the model's judgement", () => {
    // The detector is an English backstop; the PROMPT rule is language-neutral. Recorded so a
    // future reader knows this is a boundary, not an oversight.
    expect(testimonyCondition("págale $200 cuando el banco apruebe su préstamo").hit).toBe(false);
  });

  it("hands the model its own escape hatches in the correction", () => {
    const c = testimonyCorrection("the bank finally approves her loan");
    expect(c).toContain("the bank finally approves her loan");
    expect(c).toMatch(/allowedHosts|expectedText/);
    expect(c).toMatch(/on-chain/);
    expect(c).toMatch(/do NOT create/);
  });
});

describe("hasPageBasedEvidence — the exemption boundary", () => {
  const m = (kind: string) => ({ evidence: { kind } });
  it("page kinds gate, chain kinds do not", () => {
    expect(hasPageBasedEvidence([m("artifact_url")])).toBe(true);
    expect(hasPageBasedEvidence([m("public_url")])).toBe(true);
    expect(hasPageBasedEvidence([m("onchain_tx")])).toBe(false);
    expect(hasPageBasedEvidence([m("onchain_tx"), m("artifact_url")])).toBe(true);
    expect(hasPageBasedEvidence([])).toBe(false);
    expect(hasPageBasedEvidence([{}])).toBe(false);
  });
});
