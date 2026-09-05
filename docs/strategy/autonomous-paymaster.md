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

- The engine holds. 39 mainnet payouts on two rails, 26 refusals with reasons, zero wrong auto-pays
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
4. **Standing mandates.** A programme funds a treasury once; the agent deploys, funds and activates
   each approved plan from it inside the mandate's cap, and what it does not spend can only return to
   the founder. Shipped on the web 2026-09-05 (`src/lib/treasury/`). Standing intents that relaunch
   work on their own come next.
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

## Who pays gas, and how it stays paid (measured 5 Sep 2026)

GOAT gas is small but not free: at today's price (130,007 wei) a vault payout burns ~2.9e-8 BTC
(about $0.003) and a USDC relay ~8.5e-9 BTC (about $0.001). The operator wallet holds ~1.6e-5 BTC,
roughly 560 payouts or 1,900 relays. Three places the operator pays gas for someone else:

1. **Settlement** — every autonomous payout (the vault call). Covered by the $0.10 operator fee the
   payer already pays per settlement, in USDC, into the same operator wallet: ~30 payouts of gas per
   fee. What is missing is the conversion — USDC → BTC on GOAT — which today is a manual top-up.
2. **Gasless withdrawals** — a worker's EIP-3009 authorization relayed by the operator (the Telegram
   cash-out, and now the in-Sage wallet). ~$0.001 each. The worker could pay it themselves with a
   second authorization to the operator (a fixed $0.01 in USDC); that is the long-run shape and a
   second signature prompt, so it ships after the deadlines.
3. **A walletless founder's first launch** — the Privy agent wallet must hold BTC to deploy and fund a
   vault, so a founder who just deposited USDC from chat is told to find BTC dust. The fix is a
   bounded **gas stipend**: when the wallet holds the USDC the plan needs and lacks only gas, the
   operator sends it enough BTC for the launch — once per wallet, capped at a few cents, recovered
   thirty times over by the first settlement's fee. **Built 5 Sep** (`src/lib/treasury/gas-stipend.ts`,
   table `gas_stipends`): both launch doors (the Telegram tool and the web treasury) try it before
   asking the founder for BTC; the decision is pure and tested — the wallet's USDC must cover the plan,
   the amount is the shortfall to `MIN_GAS_WEI` (0.000003 BTC, ~$0.33) and never more, the operator
   keeps `OPERATOR_GAS_FLOOR_WEI` (default 0.000005 BTC) for settlements, and a wallet is covered once.
   The send lives in `deputy/native-send.ts`, outside the frozen vault signer.

Rule going forward: **the operator never pays for a flow that produces no fee.** Settlement fees fund
settlement gas; a stipend is only ever sent against USDC already deposited; relays get their own fee
once the worker can sign it in one prompt. The reserve rule (swap fee USDC to BTC when the operator's
BTC falls under a threshold) is a small script against a GOAT DEX — listed, not yet written.
