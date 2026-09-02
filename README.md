<div align="center">

# Sage

**An AI agent that finds real people to test your product — and pays them in USDC.**

[![Live](https://img.shields.io/badge/live-sagepays.xyz-c2410c?style=flat-square)](https://sagepays.xyz)
[![Docs](https://img.shields.io/badge/docs-sagepays.xyz%2Fdocs-1a1d21?style=flat-square)](https://sagepays.xyz/docs)
[![Network](https://img.shields.io/badge/GOAT%20Network-mainnet-15803d?style=flat-square)](https://explorer.goat.network)
[![Starknet](https://img.shields.io/badge/Starknet-private%20payout%20rail-c2410c?style=flat-square)](#getting-paid-without-first-becoming-a-crypto-user)
[![Telegram](https://img.shields.io/badge/telegram-@sagedeputybot-0088cc?style=flat-square)](https://t.me/sagedeputybot)

[Website](https://sagepays.xyz) · [Documentation](https://sagepays.xyz/docs) · [Case study](https://sagepays.xyz/case-studies/autonomous-paid-testing) · [Live missions](https://sagepays.xyz/marketplace)

</div>

---

## Starknet · STRK20 privacy

**In Sage, the payer is not a person.** An AI agent reads someone's work, decides on its own
whether it deserves money, releases it from a vault it cannot exceed, and escrows it behind a
commitment — so the money never lands in the wallet that earned it, and where it goes next is
nobody's business but theirs.

Private payment rails move money a human already decided to send. The decision here is the
autonomous part, and privacy is what makes it safe for the person receiving it: an agent that pays
you should not also publish what you earn. That pairing — an unattended disbursement decision and
an unlinkable payout — is what this project is.

It already happened, unattended, on Starknet mainnet:

| step | transaction |
| --- | --- |
| agent judged the work and released the reward | [`0x2b03ed65…49fb`](https://voyager.online/tx/0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb) |
| Sage escrowed it behind `poseidon(secret)` | [`0x68ebf197…8af4`](https://voyager.online/tx/0x68ebf197f6e236fdb5ba62076d9a62446bcb4e8ee44155c1dcfe3f78b8d8af4) |

No human approved that payout. Confidence 0.92 against a 0.85 threshold, judged by a model that
cannot state an amount — the vault derives it — and gated by rules the agent has no way around.

**Built on Starknet, not merely calling it.**

| | |
| --- | --- |
| `SageClaims` — our Cairo escrow, integrates the STRK20 pool directly | [`0x6fe4d0…1cf57`](https://voyager.online/contract/0x6fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57) |
| `SageVault` — Cairo settlement, the reward is not an argument it can pass | class `0x715ab98f…0ffa87` |
| qualifying pool claims | 3 `privacy_invoke` collections into shielded notes, in [`strk20.json`](strk20.json) |

No owner, no admin, no pause, no upgrade path. No dependency on another project's contracts.
35 tests on `SageClaims`, and every one of its eleven money guards verified by mutation — each
deleted in turn to confirm a test actually goes red.

**And it says what it does not do.** The privacy scope is written out line by line
[below](#getting-paid-without-first-becoming-a-crypto-user), including the one thing still public.
A claim a judge can falsify with one explorer query is worth less than a narrower one that holds.

---

You built something. Nobody is using it. Your friends said it looks nice.

Point Sage at a product URL with a budget. It opens the product in a real browser and **uses**
it, writes testing missions from what it actually saw, finds real strangers to do them, judges
their reports against its own observations, and **pays them USDC without asking you.** Every
payout is a public transaction with a `/proof/<tx>` receipt.

There are exactly two human moments in the whole lifecycle: **approve the plan, and fund it.**

It matters just as much that it can **refuse**. Roughly half of everything submitted so far has
been refused — thin accounts, near-duplicates, work it could not verify against what it saw. An
agent that pays everyone is not doing a job, it is a faucet.

> **Why it is safe to let it spend.** The budget lives in a contract the founder owns. Sage can
> never withdraw from it — it can only ask the contract to settle one specific piece of work, and
> the contract computes the amount and checks its own limits. **The agent proposes; the vault
> disposes.**

---

## Getting paid without first becoming a crypto user

The first cohort exposed the part nobody demos. People did the work, Sage judged it, the USDC
arrived — and then they were stuck. They had to own a wallet before they were allowed to be paid,
hold gas to move what they were paid, and find a venue that lists the chain. Several never got the
money out. **A rail that ends in an asset nobody can spend has moved a number, not capital.**

And every payout published the link permanently: this wallet, this campaign, this amount. For
someone whose testing income is a real part of what they earn, that is their income statement,
posted publicly, forever.

`SageClaims` (Cairo, in [`contracts-starknet/`](contracts-starknet/)) addresses a payout to a
**person** instead of an address. Sage escrows the money behind a Poseidon commitment and the
worker names where it lands at the moment they collect.

- **No wallet at payout time.** A commitment commits to nobody. The recipient does not need to
  exist yet.
- **No gas at collection time.** `claim_to_address` is ungated by design — the preimage is the
  authority, not the caller — so Sage relays the transaction for someone holding no token at all.
  Proven in tests against a recipient with nothing.
- **The money never lands in the worker's wallet.** Inside `SageClaims` a deposit and a collection
  are joined only by a hash nobody can invert, so the escrow leg names no one. Scoped precisely
  below — the *approval* record on the settling vault is public, and we do not pretend otherwise.
- **A whole campaign settles in one operation.** `deposit_many` pays up to 32 workers at once,
  each behind their own commitment.
- **Two doors.** A recipient already registered with the STRK20 pool collects into a *shielded
  note* via `privacy_invoke`; everyone else collects to an address they name. Both doors share one
  `claimed` flag, so a link opens exactly once. Neither is the "real" one — most of Sage's
  recipients are receiving their first crypto and cannot register with the pool at all, which is
  precisely why the public door exists.

**What stays private, stated exactly.** Anyone can verify each of these against the chain, which is
why they are written this precisely rather than as "private payouts".

| | |
| --- | --- |
| **Private** | Who is on a payout list, and who collected. A commitment names nobody, and the collection leg is keyed by `poseidon(secret)`. |
| **Private** | Where the money ends up. It never lands in the worker's wallet — they name the destination at collection, and a pool-registered wallet can take it straight into a shielded note. |
| **Public** | Funding: the total and the timing. |
| **Public** | The address named at the public collection door, for that leg only. |
| **Public** | The vault's spending — every amount, mission and decision digest. Auditable, and no longer attributable. |

**The approval record used to name you. It no longer does.** `PayoutReleased` carried the worker
as an *indexed* key, so filtering by a wallet and totalling everything Sage ever paid it was one
block-explorer query — a private destination with a public approval record is not a private payout.
It now emits an opaque `intent_hash`; replay protection is untouched because it keys on the worker
in storage, which the event never needed. Writing the test for that found a second one:
`PayoutRefused` named the recipient too, which is worse — a public, searchable record of someone
being turned down. Both now identify the attempt rather than the person.

*Written and tested, on the current `main`; not yet the deployed class. The live campaign proving
this rail runs on the existing one, and swapping classes underneath it before that is proven would
risk the thing it demonstrates.*

**What is still public on purpose.** Every figure this project reports stays independently
verifiable: amounts, payout counts, batch totals and the live unclaimed balance are all on-chain.
Privacy removes the line back to a person, not the receipts.

**Live on Starknet mainnet.**

| | |
| --- | --- |
| `SageClaims` | [`0x6fe4d0…1cf57`](https://voyager.online/contract/0x6fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57) |
| class hash | `0x3a36f06cbacff3127b00b8fd11b34242a2ae92b3b9fd87fc0376dcfd8c71168` |
| declare | [`0x48cc40…1284`](https://voyager.online/tx/0x48cc40b881dd1d2916b320e53d24bf3b02ebc39c89ef70e4d30f6a88bf01284) |
| deploy | [`0x2ee164…b637`](https://voyager.online/tx/0x2ee164e6cc00789b0750d9cc95f70a35fd6975d1fe1372b4eaced7b08f9b637) |
| `SageVault` privacy class (declared 2026-09-02) | `0x6d55773e63601dfbd861c78e03c5ac3085b472d7c067d9c5634da03a00b5aa0` — `PayoutReleased`/`PayoutRefused` keyed by `intent_hash`, naming nobody |
| declare | [`0x29abc1…b87f`](https://voyager.online/tx/0x29abc1846275b4cb6f90715dbec6e9187d60d2b81a77a82b5044cd30d1fb87f) |
| previous `SageVault` class (three live vaults) | `0x715ab98f0d29548209259a6283d1b1db317b07b4f16441b068c02eaa40ffa87` |

35 tests, and every one of its eleven money guards verified by mutation — each guard deleted in
turn to confirm a test actually goes red. After deployment the class hash at the address was
compared against the one computed locally, and `get_pool()` read back and asserted: a succeeded
transaction does not prove the right code landed.

No owner, no admin, no pause, no upgrade path.

There is no dependency on any other project: it integrates the STRK20 **pool** directly.

---

## The money infrastructure (what a dollar goes through)

```
witness (agent) → obligation (signed, capped) → vault (cannot exceed)
   → router (GOAT public · Starknet private claim · licensed-fiat door, interface-ready)
      → record (public tape or a signed earnings floor) → capital in (the Advance facility)
```

- **The founder never picks a chain.** They pick an outcome — *public receipts* or
  *private-capable* — and the router picks the rail. The fiat door is a typed interface whose
  disburse refuses in words until a licensed partner's keys exist: no simulated money movement.
- **They price in their own money.** A grant composes as *"split J$10,000 across two
  milestones"* — Caribbean denominations first-class (J$ · TT$ · EC$ · Bds$ · G · RD$ · G$ · B$ ·
  BZ$ · SRD), converted once at a stamped, source-attributed rate; settlement is always USDC, and
  no model ever does exchange arithmetic.
- **The record is underwritable.** Every payout lands on the earner's verified work record
  ([/record](https://sagepays.xyz/record/0xccbfb9bba88f282282a29aa1338175cc835e768d) ·
  `sage.work-record.v4`), amounts withholdable with a **signed earnings floor** a lender verifies
  off-platform — income that can be borrowed against without being a public diary.
- **Capital comes back in.** The [Advance facility](https://sagepays.xyz/lender): capacity is
  published arithmetic (the lender's multiple — Sage scores nobody), disbursement is a claim link,
  and repayment is the **waterfall** — each next verified payout escrows as two legs, recourse on
  the Sage-routed remainder only. One active advance per borrower, one repayment per payout,
  enforced by the schema itself.
- **Outcomes are readings, not claims.** [sagepays.xyz/outcomes](https://sagepays.xyz/outcomes)
  answers cost, speed, access and flow from the settlement ledger at render time — including the
  number that is honestly **not yet measured**.

## Proven, not promised

Every figure below is a transaction on GOAT Network mainnet or a row in the production database,
and each can be re-derived from the source named beside it.

| | | |
|---|---|---|
| **$52.60** | settled autonomously in USDC | [payout ledger](docs/stage2/payout-ledger.md) |
| **22** | different people paid | on-chain transfer log |
| **29** | autonomous payouts, across TWO mainnet rails | one receipt page per transaction |
| **52** | submissions decided | 29 paid, **23 refused**, none unresolved |
| **67** | distinct products inspected | 828 inspection jobs |
| **175s** | median submission → USDC in wallet | fastest: 15 seconds |

One campaign filled and paid **ten strangers in forty-five minutes**, with no human approving any
of the ten payments.

📄 **[Read the full case study →](https://sagepays.xyz/case-studies/autonomous-paid-testing)**

---

## How it works

Five steps. A human is in none of them.

1. **Opens your product in a real browser** — screenshots, rendered pages, console errors, the
   states a visitor can actually reach.
2. **Writes the testing missions** from what it observed, not from your marketing copy.
3. **Real people complete them** on a public campaign board.
4. **Checks every report against its own browsing** — an account that could have been written
   without opening the product does not clear.
5. **Pays in USDC, or refuses** — with a written reason either way.

📚 **[Full documentation →](https://sagepays.xyz/docs)**

---

## Architecture

Three model layers and one settlement core. They are separated on purpose: a single model that
designs the work, judges the work and talks to the customer can be talked out of all three at once.

| Layer | Role | Forbidden to |
|---|---|---|
| **Mission Brain** | Designs missions from an inspected product — architect → critic → deterministic gate | Ship anything the gate rejects |
| **Payout Brain** | Judges tester evidence, proposes pay / hold / refuse | State an amount, ever |
| **Concierge** | Conversational front door (Telegram + web) | Do its own money arithmetic, or import the judging layer |
| **CampaignVault** | Derives the reward, enforces caps, rejects replays, emits settlement | — it is the only thing that can move money |

**Autonomy is a stateless gate, not a running loop.** It fires when a tester submits, and again on
an authenticated sweep that re-evaluates pending work. The pipeline never throws for control flow —
any failure resets to pending for the next sweep.

📖 [Architecture](https://sagepays.xyz/docs/architecture) · [Judging](https://sagepays.xyz/docs/judging) · [Settlement](https://sagepays.xyz/docs/settlement) · [Safety model](https://sagepays.xyz/docs/safety)

---

## The guarantees

These are structural, not behavioural. "The agent is careful" is worth nothing; "the contract
computes the amount" is checkable.

- **No model ever computes a money amount.** Rewards come from a deterministic budget compiler
  where `Σ(reward × completions) = the funded total`, exactly, in 6-decimal base units.
- **Quotes must be verbatim.** Any quote in a decision must be an exact substring of the fetched
  evidence. Anything else is dropped.
- **Untrusted content stays marked untrusted.** Pages, evidence and tester notes are wrapped in
  delimiters; forged delimiters are stripped; an eight-family injection detector runs over
  everything a stranger wrote.
- **With no model at all, it cannot auto-pay.** The system degrades to a transparent keyword
  heuristic that can only *hold* work. Losing the model stops money moving — it never moves it
  wrongly.
- **Mainnet auto-pay is off unless explicitly armed.**

---

## Run it

```bash
npm install
cp .env.example .env.local     # fill in what you need; missing keys degrade honestly
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server (turbopack) |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run test` | Vitest — unit, component, and the red-team suite |
| `npm run test:e2e` | Playwright |
| `npm run lint` | ESLint |
| `npm run deputy:watch` | The sweep watcher that drives autopilot |

The optional Field Test (`FIELD_TEST_ENABLED=1`) browses the inspected product in a real headless
browser and needs a browser engine once: `npx playwright install --with-deps chromium`.

Every integration is optional and fails *honestly*: a missing key means that capability is pending
and the app says so, rather than pretending. See [`.env.example`](.env.example).

---

## Repository layout

```
src/app/            Next.js routes — landing, launch, campaign, docs, proof, api
src/lib/launch/     Inspection, field test, mission brain, budget compiler
src/lib/deputy/     Judging (brain-core), autopilot gate, vault clients, settlement
src/lib/campaigns/  Campaign lifecycle and the settle flow
src/lib/telegram/   The walletless concierge
contracts/          CampaignVault (V2) and PolicyVault (V1)
scripts/            Red-team, sweep watcher, MCP conformance, ERC-8004 registration
tests/redteam/      The suite that guards the frozen judgement layer
docs/               Architecture notes, Stage 2 reports, archived build history
```

---

## Testing and safety

The red-team suite in `tests/redteam/` guards the pieces that can silently unbound money movement:
the judgement rubric, the injection detector, the confidence hardener and the autopilot gate. It
must stay green — `lint` + `typecheck` + `test` are the gate before anything touching core logic
ships.

Any change to inspection, the field test, the mission brain or the gates also runs the P-GEN matrix
battery (`scripts/mission-eval-matrix.mjs`). Anchor integrity below 100% is a hard stop.

The money lanes have their own live batteries, each importing production's own prompts and tools:
P-DIRECT (founder briefs → compiled gigs and grants: correct lane, exact budget, faithful amounts,
verifiable contracts), P-WORK (gig judging against attack fixtures *and* honest-work fixtures — an
attack that pays and honest work that holds are both failures) and P-JUDGE (the payout judge:
zero wrong auto-pays across the hostile set). A judge model is promoted only on this evidence.

**Cheating is held, not argued with.** Deliverables verify against contracts, not prose: on-chain
reads for on-chain proofs, and for created artifacts a live page on an allowed host that carries the
submitter's own wallet marker. Around that: exact and paraphrase dedup on reports, a fingerprint of
the fetched artifact body so a copied page with the marker swapped is held as copied work, GitHub
provenance (a fork, or a repository older than the gig), wallet-freshness and funding-graph signals,
a per-wallet payout cap, a daily submit limit, and the vault's per-recipient replay protection.
Each is a hold for a human to review — a false "you copied" is worse than a miss — and a rate limit
on a third-party API never holds an honest tester.

---

## Interfaces

- **Web** — [sagepays.xyz](https://sagepays.xyz): connect a wallet, launch, fund, watch it run.
- **Walletless Telegram** — [@sagedeputybot](https://t.me/sagedeputybot): the whole loop from chat,
  no wallet app. Sage mints a server wallet bound to a spending policy.
- **Agent-to-agent** — an MCP server at `/mcp` with read and inspection-start tools. It *provably
  cannot* sign or settle; a structural test fails the build if a money-moving capability is ever
  exposed there.
- **Identity** — a registered ERC-8004 on-chain agent identity.

---

## Links

| | |
|---|---|
| Product | [sagepays.xyz](https://sagepays.xyz) |
| Documentation | [sagepays.xyz/docs](https://sagepays.xyz/docs) |
| Case study | [autonomous paid testing](https://sagepays.xyz/case-studies/autonomous-paid-testing) |
| Live missions | [sagepays.xyz/marketplace](https://sagepays.xyz/marketplace) |
| Agent record | [sagepays.xyz/agents/sage](https://sagepays.xyz/agents/sage) |
| Telegram | [@sagedeputybot](https://t.me/sagedeputybot) |
| X | [@sagepaysai](https://x.com/sagepaysai) |

Build history, Stage reports and superseded working notes live in [`docs/`](docs/); the raw sprint
patches are kept in [`docs/archive/`](docs/archive/) rather than the repository root.
