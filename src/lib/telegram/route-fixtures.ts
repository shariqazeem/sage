/**
 * P-ROUTE fixtures — does the agent reach for the RIGHT tool, in the words people actually use?
 *
 * P-DIRECT measures one decision (gig vs grant vs testing). This measures the rest of the surface,
 * and especially the RECIPIENT journey — invite → submit → cash out — which had ZERO routing
 * coverage despite being the whole point for someone with no bank: `sage_invite_recipient`,
 * `sage_submit_work` and `sage_cash_out` appeared in no test at all.
 *
 * TWO-SIDED, like every money battery here. A missed route is a bad experience; a WRONG route on a
 * money tool is a bad payment. So the fixtures include utterances that must NOT reach a tool at
 * all, and the suite separately asserts the invariant that matters most: a `confirm_*` tool — the
 * irreversible step — must never fire on a first turn, before the person has seen what they are
 * confirming.
 */

export interface RouteFixture {
  id: string;
  /** what a real person types. */
  utterance: string;
  /** the tool that SHOULD be called, or null when the honest answer is to reply/ask instead. */
  expect: string | null;
  /** other tools that are a defensible reading — a near-miss, not a defect. */
  alsoOk?: string[];
  /** Telegram carries the recipient + money tools; web is read-only for money. */
  surface: "tg" | "web";
  why: string;
}

export const ROUTE_FIXTURES: RouteFixture[] = [
  // ── the recipient journey: the path that had no coverage at all ─────────────────────────
  {
    id: "pr-invite-recipient",
    utterance: "add my cousin to that grant, her handle is @amara_shop",
    expect: "sage_invite_recipient",
    surface: "tg",
    why: "naming who may do the work is an invite, not a new campaign",
  },
  {
    id: "pr-submit-work",
    utterance: "i finished it, here's the link https://amara-shop.example/catalogue",
    expect: "sage_submit_work",
    surface: "tg",
    why: "a worker handing in evidence is the single most common recipient turn",
  },
  {
    id: "pr-cash-out",
    utterance: "cash me out please, send it to 0x2A9f4b1C3d5E7f9A0b2C4d6E8f0A1b3C5d7E9f1A",
    expect: "sage_cash_out",
    surface: "tg",
    why: "an explicit cash-out with a destination — the quote step, not the transfer",
  },
  {
    id: "pr-my-work",
    utterance: "what have i earned so far?",
    expect: "sage_my_work",
    alsoOk: ["sage_cash_out"],
    surface: "tg",
    why: "earnings are a read; it must not jump to moving money",
  },
  {
    id: "pr-browse",
    utterance: "what work can i pick up right now?",
    expect: "sage_browse_missions",
    surface: "tg",
    why: "the entry point for anyone who wants to earn",
  },

  // ── founder lifecycle ───────────────────────────────────────────────────────────────────
  {
    id: "pr-my-campaigns",
    utterance: "what campaigns do i have running?",
    expect: "sage_my_campaigns",
    surface: "tg",
    why: "a plain read of the founder's own campaigns",
  },
  {
    id: "pr-stop-campaign",
    utterance: "stop the storefront grant, i don't want more submissions",
    expect: "sage_stop_campaign",
    surface: "tg",
    why: "stopping is a real lifecycle action founders ask for in these words",
  },
  {
    id: "pr-held-work",
    utterance: "is anything waiting on me to approve?",
    expect: "sage_list_held",
    surface: "tg",
    why: "held work is the founder's queue; mis-routing it strands a worker",
  },
  {
    id: "pr-wallet-status",
    utterance: "how much is in my sage wallet?",
    expect: "sage_agent_wallet_status",
    surface: "tg",
    why: "a balance read must never be answered from memory",
  },

  // ── must NOT reach a tool: the honest answer is words ────────────────────────────────────
  {
    id: "pr-explain-payment",
    utterance: "how does getting paid actually work on here?",
    expect: null,
    surface: "tg",
    why: "a question ABOUT payment is not a request to move money",
  },
  {
    id: "pr-explain-fees",
    utterance: "do you take a cut of what i earn?",
    expect: null,
    surface: "tg",
    why: "policy question — answering it with a money tool would be absurd and alarming",
  },
  {
    id: "pr-greeting",
    utterance: "hey, what is this?",
    expect: null,
    surface: "tg",
    why: "the commonest first message; firing any tool here is noise",
  },

  // ── the WEB surface: deliberately has NO money tools ────────────────────────────────────
  // WEB_TOOLS omits every recipient and agent-wallet tool, so the web agent physically cannot
  // move money. What it must not do is flail: the honest answer to a money request there is words
  // (and a handoff), never a wrong tool grabbed because the right one is absent.
  {
    id: "pr-web-inspect",
    utterance: "can you test my product? https://plausible.io — I want feedback on the signup flow from first-time visitors, budget $40",
    expect: "sage_start_inspection",
    surface: "web",
    why: "the web surface's primary job: a founder pointing Sage at their product",
  },
  {
    /**
     * MY FIXTURE WAS WRONG BEFORE THIS ONE EXISTED. The original omitted a budget and expected the
     * tool anyway; it failed 2/2 and looked like a routing defect. It was not: budgetUsd is a
     * REQUIRED field, so the model could not call the tool — and asking is the right move regardless,
     * because the budget is the founder's money, which the product treats as a genuine decision
     * rather than something to guess. Kept as a fixture so the correct behaviour is pinned.
     */
    id: "pr-web-inspect-no-budget",
    utterance: "can you test my product? https://plausible.io — I want feedback on the signup flow",
    expect: null,
    // A FREE LOOK IS NOT A MISROUTE. `sage_first_look` needs only a URL, spends nothing, and
    // commits nothing — and looking before asking is what the product tells Sage to do: show the
    // founder what you actually saw rather than a question and a spinner. What must NOT happen is
    // `sage_start_inspection`, which REQUIRES budgetUsd: calling it here means inventing an amount
    // of the founder's money, which is the thing this fixture is really guarding.
    alsoOk: ["sage_first_look"],
    surface: "web",
    why: "no budget stated: look for free if useful, but ASK before spending — never invent an amount",
  },
  {
    id: "pr-web-cash-out-absent",
    utterance: "cash me out to 0x2A9f4b1C3d5E7f9A0b2C4d6E8f0A1b3C5d7E9f1A",
    expect: null,
    surface: "web",
    why: "no cash-out tool exists on web — it must SAY so, not substitute another tool",
  },
  {
    id: "pr-web-gig",
    utterance: "pay a writer $30 when they publish a launch post about us on their own blog",
    expect: "sage_create_direct_campaign",
    surface: "web",
    why: "creating the plan is a web action; only FUNDING needs the founder's own wallet",
  },
];

/** The irreversible steps. None may EVER be the first tool of a turn — see the suite. */
export const CONFIRM_TOOLS = [
  "sage_confirm_cash_out",
  "sage_confirm_withdrawal",
  "sage_confirm_release",
] as const;
