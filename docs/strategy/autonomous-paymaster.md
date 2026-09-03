# Sage — the autonomous paymaster

> Written 2026-09-05, four days before STRK20 closes (7 Sep 23:59 UTC) and two before Future Caribbean
> (6 Sep 23:59 AST). This replaces the "Sage for teams / Pro plan" framing of the last two days. It is
> the plan a founder would write, not a feature list: what Sage is, what wins, what to cut, what to
> build in the days left, and what after.

## The thesis

Sage is not software a team subscribes to. Sage is **an AI agent that moves money on verified
outcomes without a human in the loop.** An organization gives it a budget and an intent once — test
this product, pay these people for this work, fund this cohort's milestones — and the agent does the
rest: it inspects, designs the work, verifies every deliverable, detects fraud, pays (privately on
Starknet when asked), publishes a receipt, builds each recipient's credit record, and extends working
capital against it. The vault, not a person, is the limit it cannot exceed.

The product is the agent. Everything on screen is the agent's work product, or the two things only a
human can do: say what they want, and fund it.

**Revenue is usage, not seats.** A fee on every settlement (today a flat $0.10 over x402; tomorrow a
share of volume), and a financing margin on advances drawn against verified inflow. No plans, no
paywalls, no member caps. That is how a payments company earns, and it is measurable on the ledger.

## What the evidence says (three weeks of real money)

- The engine holds. 41 mainnet payouts on two rails, 26 refusals with reasons, zero wrong auto-pays
  across the promotion batteries, a vault that never exceeded a cap, a receipt for every payout.
- Open, anonymous bounties are farmed. Every public campaign drew the same rotating-wallet group; the
  last one lost 10 of 10 rewards to one operator. Human review did not prevent it and would not scale.
- The moments that still need a person are the product's weakness, not its safety: approving a plan,
  funding each campaign, reviewing holds, refusing, releasing public payouts, returning unspent money.
- What people paid for was the record: verified inflow that a lender can read and an advance can be
  drawn against. Nobody asked for a dashboard.

## The two rubrics, answered

**STRK20 — integration depth 30 · working mainnet product 30 · innovation 25 · docs 15.**
Sage's Starknet rail pays into a claim escrow the recipient opens privately, into a shielded note if
they choose; the vault answers refusals with codes on chain; the record shows amounts only to whom the
recipient chooses. To score: (1) every payout on the flagship campaign must actually take the private
route — it did not, because a class list drifted; that is fixed and the next payouts will; (2) deepen:
pay fees privately, fund from a shielded balance, stealth recipients when sub-accounts ship;
(3) innovation is the agent itself: a paymaster that pays privately *and decides alone*, with an escrow
it can still revoke while it watches the wallet graph; (4) strk20.json carries private transaction
hashes, the demo video shows a private payout end to end, the README is followable.

**Future Caribbean — "systems that move capital, change outcomes"; the MSME credit layer is core.**
Fees: $0.10 per settlement against 7–9%. Settlement: seconds. Credit without collateral: the advance
against verified inflow, underwritten by the agent from the ledger it wrote. Regional flow: obligations
priced in J$ and the region's currencies at a stamped rate, diaspora funders posting grants from
abroad. Integration: the lender contract is a JSON endpoint; the record is portable. The demo is a
programme funding once and the agent running everything down to the advance.

## Cut, effective now

1. **The Pro plan and its gates.** No member cap, no plan card, no upgrade prompts. Pricing lives in
   the docs as usage. The workspace stays as the organization's container — it is where the agent's
   work is read — but nothing in it is sold by the seat.
2. **"The team decides on public campaigns."** Shipped yesterday, wrong by this thesis. The agent
   decides everywhere. What replaces human review is a **finalization window**: on open campaigns the
   agent approves the payout at once and settles it after a short window it uses to watch the wallet
   graph (funding chains, consolidation, near-duplicates that arrive later). A signal in the window
   revokes the payout with the reason written out; silence finalizes it. On Starknet the claim escrow
   already carries a refund secret Sage holds; on GOAT the approved-then-settle path already exists.
3. **Any copy that reads as software for teams.** The front door says what the agent does.

## Build, in order (the days left)

1. **Cut the plan gates and the manual default; restore autopilot everywhere.** Half a day.
2. **The finalization window.** Autopilot on a public campaign approves and schedules; the sweep
   finalizes only after the window, after re-running the graph checks against everything that
   arrived since; a hit revokes. Journal lines say "approved · finalizes in 30m", "finalized",
   "revoked: forwarded its payout to another submitter". One day.
3. **A private payout that is real.** Fund a small Starknet campaign on the fixed route, let the agent
   pay one or two known people privately, put the hashes in strk20.json. The user's money, ~$5.
4. **Standing mandates.** A programme funds a treasury once and states a standing intent; the agent
   launches campaigns from it as work is needed and returns what it does not use. The Privy mandate
   built for Telegram is the template; the web gets the same. One day, if 1–3 are done.
5. **Docs and the two videos.** The overview, the compliance statement, strk20.json, one video per
   rubric showing the agent alone from funding to record.

## After

- Identity that costs something to fake without costing honest people anything: the verified-work
  passport (the record) as the reputation layer; limits that grow with history; email and Telegram
  accounts as cheap anchors; consolidation watch across every rail.
- Verifiers for more kinds of work: merged pull requests, published videos, signed deliveries,
  on-chain state on Starknet.
- The agent as underwriter: offers the advance when eligibility is met, sizes it from the ledger,
  collects from the waterfall, reports to the lender contract — no operator in the loop.
- Regional netting: obligations in two currencies settled net between programmes, the FC brief's own
  example, on the rails Sage already runs.

## The demo, told once

A cooperative in Kingston funds Sage once. Sage inspects the members' storefronts, designs the work,
pays each verified delivery privately on Starknet, refuses the copy and the wallet cluster with the
reason on chain, and by the end of the month every honest member has a record a lender can read and
one of them has drawn an advance against it — without anyone at the cooperative touching a dashboard.
