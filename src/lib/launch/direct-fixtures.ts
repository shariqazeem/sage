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
  /**
   * The TOTAL the founder implied, if it is unambiguous — it must survive into the plan unchanged.
   * Omit it when the founder stated a PER-PERSON price over several slots: "$5 each, up to 3"
   * totals $15, and asserting $5 would fail the product for doing the right arithmetic.
   */
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
    // $5 PER completion over 3 slots = $15 total, so no single total is asserted here.
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

  // ── COMPLEX SHAPES a real founder sends (added 2026-08-31) ────────────────────────────
  // Gigs and grants are the lanes Sage is judged on now, and everything above is a single
  // tranche or an even split. These are the ones that arrive with structure.
  {
    id: "pd-grant-thirds-of-a-total",
    category: "grant-complex",
    utterance:
      "I want to back a friend's catering side business with $90, released in three equal parts: when she publishes her menu page, when she posts her first booking, and when she shows a customer review.",
    expect: "direct",
    statedAmountUsd: 90,
    statedMilestones: 3,
    about: "Equal split of a stated total across THREE — $90/3 divides cleanly, unlike the $40/3 case",
  },
  {
    id: "pd-grant-uneven-front-loaded",
    category: "grant-complex",
    utterance:
      "$100 total for a shop owner getting online, but weight it early: $50 when the storefront page is up, $30 when the first product is listed, $20 when they announce their first sale.",
    expect: "direct",
    statedAmountUsd: 100,
    statedMilestones: 3,
    about: "UNEVEN explicit tranches — the split path must not fire, and the amounts must survive verbatim",
  },
  {
    id: "pd-grant-mixed-evidence-kinds",
    category: "grant-complex",
    utterance:
      "Fund a developer $60 in two steps: $35 when they deploy the contract on-chain and send the transaction, and $25 when the docs page for it is live and public.",
    expect: "direct",
    statedAmountUsd: 60,
    statedMilestones: 2,
    about: "One tranche on-chain, one a fetched page — the two contract kinds in a single grant",
  },
  {
    id: "pd-gig-multi-slot-per-person-price",
    category: "gig-complex",
    utterance:
      "I'll pay $4 each to the first 5 people who publish a short walkthrough of my onboarding flow with their wallet address on the page.",
    expect: "direct",
    statedMilestones: 1,
    about: "PER-PERSON price over 5 slots = $20 total. Asserting $4 as the total would fail the product for doing the right arithmetic, so statedAmountUsd is deliberately omitted",
  },
  {
    id: "pd-gig-long-deliverable-spec",
    category: "gig-complex",
    utterance:
      "Pay $25 for this: a public comparison page of our pricing against two named competitors, with a table, at least 400 words, our current prices quoted exactly, and the writer's wallet address in the footer.",
    expect: "direct",
    statedAmountUsd: 25,
    statedMilestones: 1,
    about: "A dense multi-clause deliverable — the criteria must carry the constraints without inventing extras",
  },
  {
    id: "pd-grant-currency-tranches",
    category: "grant-complex",
    utterance:
      "Give a market seller J$10,000 in two equal parts — half when her catalogue is online, half when she posts her first review.",
    expect: "direct",
    statedMilestones: 2,
    about: "Non-USD total AND an equal split. The model must not convert (rewardLocal), and must not divide (splitTotalUsd)",
  },
  {
    id: "pd-gig-named-recipient",
    category: "gig-complex",
    utterance:
      "Pay my designer $50 when the new logo page is live on our site. Only she should be able to claim it — her wallet is 0x04f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434.",
    expect: "direct",
    statedAmountUsd: 50,
    statedMilestones: 1,
    about: "A NAMED recipient with a wallet — must become an allowlist, never an open bounty anyone can claim",
  },
  {
    id: "pd-grant-conditional-on-someone-else",
    category: "unverifiable",
    utterance:
      "Send my cousin $200 when the bank finally approves her loan application.",
    expect: "not-direct",
    statedAmountUsd: 200,
    about: "Nothing Sage can verify: the condition is a third party's private decision. Must NOT compile into a payable mission",
  },
  {
    id: "pd-gig-deadline-not-a-milestone",
    category: "gig-complex",
    utterance:
      "$30 for a public write-up of our API, and I need it by Friday.",
    expect: "direct",
    statedAmountUsd: 30,
    statedMilestones: 1,
    about: "A deadline is not a second milestone. Inventing one from 'by Friday' is the defect this catches",
  },
  // ── SHAPES ADDED 2026-09-04, so "any kind of work" is measured rather than asserted ──────
  // Each is a structurally different way of stating a price or a schedule, not a reword of one above.
  {
    id: "pd-gig-per-unit-quantity",
    category: "gig-complex",
    utterance:
      "I need 10 product photos of my catalogue items, $2 per photo, published on a public page with the photographer's wallet address on it.",
    expect: "direct",
    statedMilestones: 1,
    about:
      "PER-UNIT price × a quantity = ONE deliverable with 10 slots, not 10 milestones. $20 total, so no single stated total is asserted — the arithmetic is Sage's and must be right, not transcribed",
  },
  {
    id: "pd-grant-monthly-for-three",
    category: "grant-complex",
    utterance:
      "I want to back a seller with $25 a month for three months — each month she posts her numbers publicly and gets paid.",
    expect: "direct",
    statedMilestones: 3,
    about:
      "A RECURRING ask with an explicit end. Three tranches of $25, never twelve and never one: 'a month' is a cadence, and 'for three months' is the count",
  },
  {
    id: "pd-gig-price-in-words",
    category: "gig-clear",
    utterance: "pay my designer fifty dollars when the new logo page is live on our site",
    expect: "direct",
    statedAmountUsd: 50,
    statedMilestones: 1,
    about:
      "The price is written in WORDS. Every money regex in the product reads digits, so this is the shape that trips a guard into refusing an ask the founder actually priced",
  },
  {
    id: "pd-gig-deploy-onchain",
    category: "gig-complex",
    utterance:
      "$40 for a developer to deploy our token contract on GOAT and send me the transaction.",
    expect: "direct",
    statedAmountUsd: 40,
    statedMilestones: 1,
    about:
      "The thing being paid for DOES NOT EXIST YET, so no address, selector or value can be named — the only expressible on-chain constraint is that the transaction deploys a contract",
  },
  {
    id: "pd-grant-spanish-tranches",
    category: "gig-language",
    utterance:
      "Quiero dar $50 a una vendedora en dos partes iguales: la mitad cuando publique su catálogo y la mitad cuando muestre su primera venta.",
    expect: "direct",
    statedAmountUsd: 50,
    statedMilestones: 2,
    about: "Spanish AND an equal split — the plan must still be well-formed English",
  },
];
