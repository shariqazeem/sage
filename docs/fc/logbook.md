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
