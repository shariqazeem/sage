/**
 * P-DIRECT fixtures — how real founders actually ask for a gig or a milestone grant.
 *
 * The product-testing lane earned its reliability by being measured against dozens of real
 * products (P-GEN). The MONEY lanes have had one live run between them: one gig, zero grants,
 * zero walletless recipients. Every defect P-GEN found was invisible in a diff and only appeared
 * when something real was run through the real path — so this battery runs real founder wording
 * through the REAL concierge prompt, the REAL tool schema, and the REAL deterministic compiler.
 *
 * Fixtures are deliberately uneven: clean asks, vague asks, other languages, other currencies,
 * an ask that is really product testing (must NOT become a direct campaign), and asks that are
 * unverifiable by construction (Sage must not pretend it can check them).
 */

export type DirectExpectation =
  | "direct" // must produce a direct campaign
  | "not-direct" // must NOT (it is a testing inspection, or needs a question first)
  | "either"; // legitimately ambiguous — informational only

export interface DirectFixture {
  id: string;
  category: string;
  utterance: string;
  expect: DirectExpectation;
  /** the amount the founder stated, if any — it must survive into the plan unchanged. */
  statedAmountUsd?: number;
  /** how many separate milestones the founder described (invented extras are a defect). */
  statedMilestones?: number;
  about?: string;
}

export const DIRECT_FIXTURES: DirectFixture[] = [
  // ── clean, unambiguous gigs ───────────────────────────────────────────────────────────
  {
    id: "pd-gig-designer",
    category: "gig-clear",
    utterance: "pay my designer $50 when the new logo page is live on my site",
    expect: "direct",
    statedAmountUsd: 50,
    statedMilestones: 1,
  },
  {
    id: "pd-gig-translator",
    category: "gig-clear",
    utterance:
      "I need someone to translate my restaurant menu into English. $20 when they publish it as a public page. Just one person.",
    expect: "direct",
    statedAmountUsd: 20,
    statedMilestones: 1,
  },
  {
    id: "pd-bounty-open",
    category: "gig-open",
    utterance:
      "open bounty: $5 to anyone who writes a working setup guide for my CLI and publishes it publicly. I'll take up to 3 of them.",
    expect: "either",
    statedAmountUsd: 5,
    statedMilestones: 1,
    about:
      "slots = 3 on ONE milestone, not three milestones. MEASURED: Sage asked 'what's the CLI called?' instead of creating it — which is the honest behaviour the prompt asks for when it genuinely cannot infer, so this is informational, not a hard stop. A question is fine; a promise it does not keep is not.",
  },

  // ── milestone grants — the FC diaspora scenario, never yet run in production ───────────
  {
    id: "pd-grant-three-tranche",
    category: "grant-milestones",
    utterance:
      "fund my cousin's shop $60 in three milestones: $20 when the shop page is published, $20 when the first product is listed, $20 when the first sale is announced on the page",
    expect: "direct",
    statedAmountUsd: 60,
    statedMilestones: 3,
  },
  {
    id: "pd-grant-two-tranche-vague-amounts",
    category: "grant-milestones",
    utterance:
      "I want to give a small grant to a market seller I know — half when she publishes her catalogue online and half when she posts her first customer review. $40 total.",
    expect: "direct",
    statedAmountUsd: 40,
    statedMilestones: 2,
  },

  // ── other languages / currencies / informal phrasing ──────────────────────────────────
  {
    id: "pd-gig-urdu",
    category: "gig-language",
    utterance:
      "mere bhai ko $15 dena hai jab wo apni bakery ki website ka menu page publish kar de, link bhej dega",
    expect: "direct",
    statedAmountUsd: 15,
    statedMilestones: 1,
    about: "Roman-Urdu request; the plan must still be well-formed English",
  },
  {
    id: "pd-gig-spanish",
    category: "gig-language",
    utterance:
      "quiero pagar 25 dólares a alguien que publique una guía de instalación de mi app en una página pública",
    expect: "direct",
    statedAmountUsd: 25,
    statedMilestones: 1,
  },

  // ── the routing boundary: this is TESTING, not a direct campaign ──────────────────────
  {
    id: "pd-route-testing",
    category: "routing",
    utterance: "test my product at https://clawup.org with a $10 budget and tell me what's confusing",
    expect: "not-direct",
    about: "must go to sage_start_inspection — confusing the two lanes funds the wrong thing",
  },
  {
    id: "pd-route-testing-implicit",
    category: "routing",
    utterance: "I want real people to try my signup flow at https://example-shop.dev and pay them for feedback, $12",
    expect: "not-direct",
    about: "'pay them' is present but the work is product testing — the tempting mis-route",
  },

  // ── underspecified: Sage must ASK, not invent ────────────────────────────────────────
  {
    id: "pd-vague-no-amount",
    category: "underspecified",
    utterance: "I want to pay someone to design a logo for me",
    expect: "not-direct",
    about: "no amount and no checkable done-condition — inventing either is the defect",
  },

  // ── unverifiable by construction: Sage must not pretend it can check this ─────────────
  {
    id: "pd-unverifiable-offline",
    category: "unverifiable",
    utterance: "pay my cleaner $30 when she finishes cleaning my office on Friday",
    expect: "either",
    statedAmountUsd: 30,
    about:
      "purely offline work. Either Sage asks for a checkable proof, or it compiles a contract that is honestly weak and the LINT must flag it. What it must never do is claim it verified a clean office.",
  },
];
