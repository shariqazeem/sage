# Future Caribbean — narrative + shell plan

Set 2026-08-31. The pivot: sagepays.xyz should read as **financial infrastructure that moves money
autonomously**, not a tool that pays testers. The testing product does not change — its framing does,
and the capital surfaces stop being unlisted pages.

## What is actually wrong today (measured, not felt)

1. **The rail links to pages that kill the rail.** `NAV` in `app-rail.tsx` offers Explorer and Docs;
   `isAppRoute()` in `app-shell.tsx` matches neither. Click Explorer and the chrome vanishes with no
   way back but the logo. The file already carries the rule — *"a nav item that makes its own chrome
   disappear is worse than no nav item"* — written for `/marketplace` and never applied to the rest.
2. **Every capital surface is unlisted.** `/lender` ("Underwrite verified cash flow"), `/record/[wallet]`
   (the credit file), `/proof/[tx]` (the receipt) and `/docs/compliance` appear in no navigation
   anywhere. The FC story is built and unreachable.
3. **Those pages have no shell**, so they read as loose documents rather than parts of a system —
   which is exactly the "not infrastructure" feeling.

`/docs` keeps its own sidebar and stays out of the rail. That exclusion is deliberate and correct:
docs has navigation, and offering a stranger a Dashboard link promises an account they lack.

## The three passes

### Pass 1 — one shell, everywhere it is reachable (STRUCTURE)
- `isAppRoute` covers every route the rail can reach: `/explorer`, `/record`, `/lender`, `/proof`
- The rule, stated once in code: **if the rail links to it, the rail survives it**
- A test that reads `NAV` and asserts every entry is an app route, so this can never regress

### Pass 2 — the capital surfaces get a home (DISCOVERY)
The rail becomes two groups, because a flat list of nine is a menu and a grouped list is a system:

- **Work** — Home · Launch · Marketplace · Agent
- **Capital** — Explorer (every payout and refusal) · Credit (a worker's verified file) · Lender
  (underwrite that file) · Docs

Grouping is the narrative: money in, money proven, money advanced.

### Pass 3 — the words (NARRATIVE)
Not a rewrite of what Sage does. A reframe of what it IS.

- **Today:** "Hire an AI worker. Give it a budget, not your keys."
- **Toward:** an agent that *moves money under rules it cannot exceed*, and turns what it paid into
  a credit file someone can borrow against.

The vocabulary to use, from the FC brief itself: settlement · verified cash flow · underwriting ·
credit file · advance · corridor · audit export · counterparty. The vocabulary to drop from the
capital surfaces: bounty · tester · task.

**Sage is the cash-flow oracle. Rails move the dollar. The file is what a lender can advance against.**

Landing page keeps its structure and its proof; the eyebrow, lede and one section shift to the
infrastructure register, and the capital surfaces get a real entry point from it.

## Order
Pass 1 first — it is a live defect and the foundation for Pass 2. Pass 3 last, because narrative
written before the structure exists just moves words around.
