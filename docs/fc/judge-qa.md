# Judge Q&A — the questions a Citi, M-KOPA or DRW judge will ask, answered in one breath each

Every answer below points at something live. Where the honest answer is "not yet", it says so.

**"You removed credit risk?"** No. The advance is a **waterfall on witnessed inflow** — the next verified
payout auto-splits at the published fraction — with **recourse on the Sage-routed remainder**. A borrower
can stop using Sage; what we remove is the *information* problem, not the risk. The terms are published
arithmetic on `/lender` — open it prefilled for a real record:
https://sagepays.xyz/lender?wallet=0xccbfb9bba88f282282a29aa1338175cc835e768d — never a score.

**"Where does the credit data come from? Self-reported cash flow is worthless."** It is not reported at
all. Sage *witnesses* the work — browses the product, fetches the artifact, reads the chain — and the vault
only releases money for work that passed. The record is the byproduct of payment, so it cannot be
self-inflated: `/record/<wallet>` and its JSON at `/api/record/<wallet>`.

**"How do I know the agent isn't rubber-stamping?"** 40% of judged submissions are refused, on a public
ledger, with reasons (`/explorer`). Two adversarial batteries run the production judge against attack
fixtures *and* honest-work fixtures: P-JUDGE zero wrong auto-pays across 57 rows; P-WORK 14 attacks with
zero leaks and 12 honest submissions with zero false holds. A judge model is promoted only on that evidence.

**"What stops one person farming ten wallets?"** On public work a slot is claimed behind a one-time World ID
proof of personhood — no name, document or country reaches Sage, only a nullifier — and the slot and
payout caps count the person across every wallet the proof, the chain or their own declaration ties
together. Underneath: exact and paraphrase dedup on reports; a fingerprint of the
fetched deliverable so a copied page with the marker swapped is held; GitHub provenance (a fork, or a repo
older than the gig, is held); wallet-freshness and funding-graph signals — a real 4-wallet rotation cluster
was caught on-chain in August; a per-wallet payout cap; a daily submit limit; the vault's own replay
protection. Every one is a hold for a human, never a silent rejection.

**"Can the AI move money it shouldn't?"** No model computes an amount. The vault derives the reward from the
mission, enforces the budget, per-mission caps and replay, and can refuse. On Starknet a refusal is a
successful transaction that moved nothing and wrote a code. The agent proposes; the vault disposes.

**"7–9% fees to under 1% — really?"** Recipients keep 100% of the vault-derived reward; the gas is Sage's cost
(≈ $0.00000002 per payout on GOAT). The payer pays a flat $0.10 per settlement over x402 — $1.30 collected on
13 settlements, against $5.09 a 7–9% corridor would have taken on the same volume. The outcomes page computes
both live and says what it has not measured yet (`/outcomes`).

**"Settlement speed?"** Median 3 minutes from submission to settled payment, *verification included*; p90
2 hours; 79% within the hour. Chain confirmation itself is seconds.

**"KYC/AML?"** OFAC SDN screening at every EVM door (web and chat submission, preflight, manual release) from a
vendored, dated snapshot — never a runtime API on the money path; the SDN list carries no Starknet addresses, so
the private rail is screened at its EVM funding side only — plus wallet pseudonymity and the Sybil controls above. Named-recipient allowlists where an
operator needs them. We do not claim identity KYC.

**"Fiat? Most of the region can't hold USDC."** The settlement door is an interface with a typed contract:
a fiat disbursement cannot ship without producing the identical verified credit event. The corridor quote is
real; the disburse refuses in words today. Licensed-partner implementation is pending compliance
onboarding — stated as such everywhere it appears.

**"Multi-currency?"** Obligations can be priced in 14 currencies, the Caribbean's own first (J$, TT$, EC$,
Bds$, HTG, RD$, G$, B$, BZ$, SRD) plus the diaspora senders (CAD, GBP, EUR), converted once at a stamped,
source-attributed rate. Settlement is always the USD stablecoin; the founder never does exchange
arithmetic. Intra-regional corridor flow is **not yet measured** — no J$ obligation has settled yet.

**"CARICOM FX matching?"** Netting becomes real on our own book the day obligations exist in two currencies;
inventing counterparties this week would be an app, not infrastructure. One honest slide, no build.

**"Privacy for banking-shy earners?"** A Starknet rail where the agent decides the payout in public and the
recipient collects privately — escrow keyed by a commitment, gasless claim, a shielded note if they hold a
registered wallet — and a signed earnings *floor* a lender can verify without seeing the payments.

**"Who has actually been paid?"** 24 distinct people, 39 payouts, $63.60 across two mainnet rails, every row a
transaction; an autonomous third-party agent earned under the same rules and has a credit file
(`/record/0xccbf…768d`). The first *advance* is pending a funded campaign and a real earner — built,
dry-run against live records, not yet disbursed.

**"What breaks if you disappear?"** Vaults are founder-owned on-chain; the operator can only settle inside
their limits; refusals cost nothing; the code is open source. The record API is a plain JSON contract a
lender can consume without Sage's UI.
