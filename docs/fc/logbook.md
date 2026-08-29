# Future Caribbean — build logbook

Track: Finance, Payments & MSME Capital. Entries are written the day of the work and kept factual —
every claim maps to a commit or a measured run.

---

## 27 August 2026 — the credit layer, and making payouts survive contact with reality

**Built the credit layer the track actually asks for.** Sage Signals sits over the Verified Work
Record: a deterministic, published, versioned formula over receipt-anchored payouts — verified
inflow, distinct payers, months active, tenure, verification pass rate, and the split across
testing / gig / grant work. No model and no invented composite score computes creditworthiness; a
lender feeds these into their own underwriting. It is exposed machine-readably at
`GET /api/record/<wallet>` (`schema: sage.work-record.v2`), which is the "integrate with lenders via
APIs" requirement. A thin file that is true beats a thick one that is self-reported.

**Closed the money-out gap for people with no crypto.** Recipients can now cash out from chat via
gasless EIP-3009 — they pay no gas and need no crypto of their own. Before signing, the code
recomputes the token's EIP-712 domain separator and refuses to sign if it does not match the
contract, so a wrong-domain signature can never be produced. Over-balance, zero-amount and
self-send withdrawals are all refused before any signature exists.

**Compliance.** OFAC SDN screening now runs on every payout path.

**Fraud, found in the wild rather than in theory.** Shipped funding-graph sibling detection after
proving a real wallet-rotation cluster on-chain: four apparently separate testers were one person,
funded in a daisy chain, 88–108s apart, taking every slot. I published the write-up and publicly
corrected an earlier payout I had described as an organic stranger. Getting that wrong in public
and fixing it in public is part of the record.

**Measurement, so quality stops being an opinion.** Stood up the money-lane batteries: P-DIRECT
(gig vs grant vs testing routing, exact budget, faithful amounts, verifiable contracts) and P-VERIFY
(the deterministic verification contracts against the real chain — an artifact link that is
off-host or missing the submitter's marker is refused; a transaction the submitter did not send is
refused). Both found real defects immediately, including two layered mapper defects and a battery
that was measuring itself.

**Portability, so a model change is a config change.** Every LLM job is now a lane that can point at
its own provider by environment alone, with the rule that all three of key + base URL + model must
be set together or the lane is treated as absent — a half-configured lane would splice one
provider's key onto another's endpoint and fail on a founder's launch rather than at boot.

---

## 28 August 2026 — reliability across every product category

**The headline: 13 of 13 product categories now produce a shippable plan with 100% anchor
integrity.** Anchor integrity is the anti-hallucination floor — every claim in a mission must be a
verbatim substring of something Sage actually observed. It held at 100% through 25 commits.

Four categories were broken at the start of the day and all four now pass:

- A marketing site returned an empty plan because the evidence gate read "Record the URL" as a
  demand for a screen recording. The pattern matched any "record the <noun>", so the commonest
  phrasing for the evidence Sage *can* verify was rejecting whole plans. Narrowed to objects you
  can actually film; the row went from 0 missions to 3.
- A canvas game failed with unparseable output. The reasoning model drafts its answer out loud, and
  its 25,000-character thinking block contained its own fenced JSON — the parser was reading the
  model's scratch work instead of its answer.
- A wallet-gated app timed out. The retry ladder answered a timeout by re-issuing the identical
  request four more times, burning ~900 seconds on the richest products, which are the ones that
  matter most.
- Bot-walled products were uncategorizable by construction: the categorizer read only the static
  crawl, so when a WAF returns nothing the answer was always "uncategorized" no matter what the
  browser had already seen.

**Tested the recipient journey for the first time.** Built P-ROUTE, a routing battery over the whole
agent surface, after finding that invite → submit work → cash out — the entire path for someone
with no bank, which is this track's user — had no test coverage at all. It also asserts the money
invariant that an irreversible confirmation step can never fire on a first turn, before the person
has seen what they are confirming. That invariant held on every run, and the two-step is enforced
server-side as well, so the model cannot skip the read-back even if it tries.

**Fixed a dead end founders actually hit.** "Is anything waiting on me to approve?" could not be
answered at all, because the tool required a campaign id and that phrasing names none. Held
submissions sitting unreviewed is a worker waiting unpaid, so the dead end had a cost.

**A note on method.** Three separate "defects" this week turned out to be the measuring instrument,
not the product — a stale corpus mirror, a battery scoring correct multi-step behaviour as failure,
and a check whose stated premise no longer matched its own code. Each looked exactly like a quality
regression in the grid. Validating the instrument before believing the reading is now written into
the project's standing rules.

**Still open and honest about it:** the milestone-grant lane has never run end to end with real
money. Its machinery shares the same settlement path that testing and gig payouts have already
proven on mainnet, and its compilation is measured by P-DIRECT, but no grant has actually paid out
yet. That is the next thing to prove, not to claim.

---

## 29 August 2026 — a second settlement rail, and privacy as a worker's option

**The Verified Work Record stays public, because that is what it is for.** A programme handing out
grant or MSME capital has to be able to show where the money went, down to the amount and the
transaction, and every record still does that by default. Auditability is not a compromise here;
it is the product.

**What changed is that a worker can now turn their own amounts off.** Someone paid through Sage
should not have to carry a permanent public income graph as the price of getting paid — a
contractor's earnings are not the same artifact as a public grant's disbursement. That is a
per-worker choice, off by default, and it answers this track's ask for credit profiles that don't
force you to publish your income without taking auditability away from the programmes that need it.

When a worker does turn it off, the record does not become useless, because the lending signal was
never mostly the amount:
how many separate jobs were verified and paid, how many *different* counterparties chose to pay,
over how many months, how recently, what share of submitted work passed verification — and a
transaction hash for every one, so a stranger can confirm each payment happened. A lender learns
"23 verified jobs for 9 payers over 7 months, 84% pass rate, here are the receipts." That is a
credit profile. It is not a published income.

**Earnings can now be proved without being revealed.** A worker names a floor and Sage signs it
only if it is true: someone who earned $847.25 proves "at least $500", and $847.25 never leaves
Sage's ledger. The floor is chosen by the person it describes — they decide how much of their
income is any given lender's business. It is scoped and expiring, unlike a privacy-pool viewing
key, which reveals every note forever to whoever is handed it.

It is **not** a zero-knowledge proof and is not described as one. A verifier trusts Sage's
signature; what makes that trustworthy is that Sage is already the party that judged the work and
made the payments, and that every claim is anchored to transactions anyone can check. The payments
are provable without Sage — only their size rests on the signature.

**The endpoint that issues those attestations is authenticated, and that is not polish.** Left
open, "did this wallet earn at least $X" is a binary-search oracle: ask $500, then $250, then $375,
and in about twenty requests you have reconstructed the exact income the redaction was protecting.
The redaction and an open threshold endpoint cannot both exist — one of them is a lie. The signed
challenge therefore binds the wallet *and the floor*, so one signature cannot be replayed at
another floor.

**A second settlement rail, because the first cohort could not get their money out.** People were
paid and then struggled to move it: they needed a wallet before they were allowed to be paid, gas
to move what they were paid, and a venue that lists the chain. A rail that ends in an asset nobody
can spend has moved a number, not capital.

`SageClaims` is now live on Starknet mainnet
(`0x6fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57`). It addresses a payout to a
*person* rather than an address: the money is escrowed behind a Poseidon commitment and the worker
names where it lands when they collect, needing no wallet at payout time and no gas at collection
time. A whole campaign settles in one operation — which is what net settlement across multiple
participants actually means. Sage escrowed three payouts on mainnet with no human in the loop, and
the contract has held its solvency invariant since.

The rail a campaign uses is decided by Sage, never asked of a founder, and it follows whose money
it is. A founder-funded campaign settles from a vault the founder owns and Sage can never withdraw
from; only Sage's own money goes on the rail with no vault behind it.

**What is still open, said plainly.** The direct-pay path on Starknet needs testers to supply
Starknet addresses, which they do not yet; until then that rail is reachable through claim links
rather than direct settlement, and the rule that selects it refuses to choose a rail its recipients
cannot be paid on. That refusal is deliberate: an earlier version of it keyed on ownership alone
and would have turned live campaigns into a queue of held work and unpaid people, with every
refusal message technically correct and the outcome indefensible.
