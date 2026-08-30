import { describe, expect, it } from "vitest";

import { missedMoneyAction } from "./narration-guard";

/**
 * WORKING THE REQUEST OUT AND NEVER ACTING ON IT.
 *
 * The narration guard judges what a draft CLAIMED, deliberately narrowly, so that explaining a
 * capability is never mistaken for asserting an act. A reasoning model falls through that gap in
 * the money lane: it reaches the right conclusion, writes it as prose, and stops.
 *
 * Measured on P-DIRECT with the production prompt and tools: "mere bhai ko $15 dena hai jab wo
 * apni bakery ki website ka menu page publish kar de" produced 8,344 characters opening "This is a
 * DIRECT CAMPAIGN" — and no tool call. Nothing was claimed, so nothing fired, and the founder got
 * an essay about their own request. Non-English requests fail this way most often, because
 * translating first spends the reasoning that would otherwise have reached the tool.
 */

const noTools = new Set<string>();
const ANALYSIS = "This is a DIRECT CAMPAIGN — paying someone for specific work, not product testing.";

describe("a stated payment that never ran", () => {
  it("catches the Roman-Urdu request that produced the defect", () => {
    expect(
      missedMoneyAction({
        userText:
          "mere bhai ko $15 dena hai jab wo apni bakery ki website ka menu page publish kar de",
        reply: ANALYSIS,
        succeededTools: noTools,
      }),
    ).toBe(true);
  });

  it("catches the Spanish one", () => {
    expect(
      missedMoneyAction({
        userText: "quiero pagar 25 dólares a alguien que publique una guía",
        reply: ANALYSIS,
        succeededTools: noTools,
      }),
    ).toBe(true);
  });

  it("catches plain English too", () => {
    expect(
      missedMoneyAction({
        userText: "pay a designer $50 when the logo ships",
        reply: ANALYSIS,
        succeededTools: noTools,
      }),
    ).toBe(true);
  });
});

describe("what it must NOT correct", () => {
  it("leaves a turn alone when a tool actually ran", () => {
    expect(
      missedMoneyAction({
        userText: "pay a designer $50 when the logo ships",
        reply: ANALYSIS,
        succeededTools: new Set(["sage_create_direct_campaign"]),
      }),
    ).toBe(false);
  });

  it("leaves a QUESTION alone — asking is the right move on an incomplete request", () => {
    // "Who is the designer?" is correct behaviour, not a miss. Correcting it would push the agent
    // to invent a recipient rather than ask for one.
    expect(
      missedMoneyAction({
        userText: "pay a designer $50 when the logo ships",
        reply: "Who should receive this, and what link proves the logo shipped?",
        succeededTools: noTools,
      }),
    ).toBe(false);
  });

  it("leaves a request with NO amount alone — there is nothing to compile yet", () => {
    expect(
      missedMoneyAction({
        userText: "I want to pay someone to write a blog post",
        reply: ANALYSIS,
        succeededTools: noTools,
      }),
    ).toBe(false);
  });

  it("leaves a question ABOUT money alone", () => {
    // "How much do testers usually get paid?" names no amount and asks; nothing was requested.
    expect(
      missedMoneyAction({
        userText: "how much do people usually pay for a landing page?",
        reply: "It varies — most founders start around $20 a mission.",
        succeededTools: noTools,
      }),
    ).toBe(false);
  });

  it("leaves a testing request alone — that lane has its own tool and its own guard", () => {
    expect(
      missedMoneyAction({
        userText: "test my product at https://example.com with a $50 budget",
        reply: "Starting the inspection.",
        succeededTools: noTools,
      }),
    ).toBe(false);
  });

  it("corrects an EMPTY draft too — it now also means a suppressed monologue", () => {
    /**
     * This asserted the opposite until 2026-08-30, back when an empty draft could only mean the
     * model had returned nothing and the post-loop fallback was the whole answer. It now also
     * means the concierge suppressed a truncated <think> block: the model worked the request out,
     * ran out of budget mid-thought, and never acted. The founder named a job and a price, so one
     * corrective round that actually runs the tool beats "I wasn't able to finish that one" — and
     * that fallback still catches the case where the retry comes back empty as well.
     */
    expect(
      missedMoneyAction({
        userText: "pay a designer $50 when the logo ships",
        reply: "   ",
        succeededTools: noTools,
      }),
    ).toBe(true);
  });

  it("still leaves an empty draft alone when no money was asked for", () => {
    expect(
      missedMoneyAction({ userText: "what can you do?", reply: "", succeededTools: noTools }),
    ).toBe(false);
  });

  it("catches hiring said without a payment verb", () => {
    // MEASURED on P-DIRECT: this reasoned to the right lane and stopped, and the guard was silent
    // because it was looking for a verb the founder had no reason to use.
    expect(
      missedMoneyAction({
        userText:
          "I need someone to translate my restaurant menu into English. $20 when they publish it as a public page.",
        reply: "This is a direct campaign for a translator.",
        succeededTools: noTools,
      }),
    ).toBe(true);
    expect(
      missedMoneyAction({
        userText: "$5 to anyone who writes a setup guide",
        reply: "That would be a gig payout.",
        succeededTools: noTools,
      }),
    ).toBe(true);
  });

  it("does not read every want with a price on it as hiring", () => {
    expect(
      missedMoneyAction({
        userText: "I want a $50 refund on my last campaign",
        reply: "Refunds come back to the vault owner.",
        succeededTools: noTools,
      }),
    ).toBe(false);
    expect(
      missedMoneyAction({
        userText: "someone charged me $50 for hosting last month",
        reply: "That is outside what I handle.",
        succeededTools: noTools,
      }),
    ).toBe(false);
  });
});

describe("what counts as asking", () => {
  it("still leaves a reply that ENDS by asking", () => {
    expect(
      missedMoneyAction({
        userText: "pay a designer $50 when the logo ships",
        reply: "I can set that up. Who should receive it?",
        succeededTools: new Set(),
      }),
    ).toBe(false);
  });

  it("corrects a reply that merely CONTAINS a rhetorical question and then concludes", () => {
    // The measured miss: a $40 two-tranche grant where the model asked itself a question in the
    // middle, answered it, and stopped. Testing for "?" anywhere suppressed the correction on a
    // request that had stated everything.
    expect(
      missedMoneyAction({
        userText:
          "I want to give a small grant to a market seller — half when she publishes her catalogue and half when she posts her first review. $40 total.",
        reply:
          "So what does she need to publish? The catalogue, then a review. Two tranches of $20. Total $40. This is a direct campaign.",
        succeededTools: new Set(),
      }),
    ).toBe(true);
  });

  it("leaves a trailing question alone even after analysis", () => {
    expect(
      missedMoneyAction({
        userText: "pay a designer $50 when the logo ships",
        reply: "This is a gig payout of $50. What link will prove the logo shipped?",
        succeededTools: new Set(),
      }),
    ).toBe(false);
  });
});
