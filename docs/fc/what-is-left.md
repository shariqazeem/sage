# What is left to build, and what to target — measured 2026-08-28

Not a wish list. Every line below is either something the production database says has never
happened, or something a battery measured.

## The honest state of each lane

| Lane | Ever run in production | Hardened by |
|---|---|---|
| Product testing | 15 campaigns, 54 products, 29 payouts | **P-GEN** (dozens of real sites) |
| Payout judging (url lane) | every payout | **P-JUDGE** (19 fixtures × 3) |
| Gig / artifact lane | **1 campaign, ever** | **P-WORK** (14 × 3, 42/42 clean) |
| Verification contracts | only `artifact_url` had ever executed | **P-VERIFY** (5/5 against the real chain + internet) |
| Direct-campaign authoring | 1 plan, ever | **P-DIRECT** (new — found 4 defects immediately) |
| **Milestone grants** | **zero. never once.** | — |
| **Walletless recipients / invites** | **zero wallets, zero invites** | — |
| **Recipient cash-out** | never run | unit tests only |
| Funding-graph Sybil signal | shipped after finding a real cluster | tests replay the real chain |

**The gap that matters:** the public claim is *"for someone banks pretend don't exist, that record
is the beginning of a real credit history."* The loop that produces that record for a person with
no wallet — invite → earn → verify → pay → cash out → record — has **never run end to end**. The
code exists and is tested. It has never met a real human.

## What P-DIRECT found in its first two conclusive rounds

Real founder wording driven through the real prompt, real tool schema, real mapper, real compiler.

1. **The flagship grant could not compile.** "fund my cousin's shop $60 in three milestones" failed
   on `productUrl: Invalid URL` — the schema *required* an https product URL, but a grant to a
   person or an offline business has none. The most important Future Caribbean scenario was
   structurally impossible. Fixed: optional, and the campaign's own board becomes the surface.
2. **A layered defect underneath it.** Making the schema optional changed nothing, because the
   transport mapper coerced a missing URL to `""`, which fails `.url()`. A fix has to reach every
   layer that touches the field.
3. **Non-English founders got nothing.** The same gig in Urdu and Spanish produced no campaign at
   all while the English twin worked. Fixed: route on meaning, write milestones in the founder's
   language.
4. **A missing caption killed whole campaigns.** `title` was coerced to `""` and failed a
   min-length rule on 4 of 5 plans. A title is a label, not money — it now derives from the first
   milestone.

And what held on every row even while the plumbing failed: **budget violations 0, amount drift 0,
invented milestones 0, unverifiable missions 0.** The money invariants are the strong part.

## Target order

1. **Prove the promise.** One real milestone grant on mainnet, paid to a walletless recipient, who
   then cashes out and holds a credit record. This is simultaneously the FC demo, the unproven
   claim, and the first exercise of three untested subsystems. *Needs a second Telegram account.*
2. **Drive P-DIRECT to green**, then keep it as the standing gate for the money lanes the way
   P-GEN gates the testing lane. Any prompt, schema or compiler change re-runs it.
3. **The two open routing misses** P-DIRECT still shows: a plainly-worded gig ("pay my designer $50
   when the logo page is live") and one Spanish request produce no campaign. Diagnosable now that
   the battery captures the model's own reply.
4. **Named-recipient gigs.** "Pay *my* designer" should not become an open bounty anyone can claim.
   Today an open campaign never becomes invite-only on redemption, so the specific-person case has
   no clean path. This is a product decision, not a bug.
5. **Founder-facing polish for mainstream traffic** — every refusal reason readable by the person
   who received it, every held state explained, no dead ends.

## Standing rule this round re-proved

A battery that reports zero problems because it produced zero rows is not a pass. P-DIRECT's first
run "passed" with 7 of 11 calls failing at the provider. It now asserts the evidence exists before
judging it — the same broken-ruler lesson as the mission-eval matrix and the P-WORK frame defect.
