# Execution plan — 2026-08-31 onward

The plan we are both working from. Written 2026-08-31 (Monday). Tick items as they land; when
something turns out to be wrong, fix the line rather than remembering a correction.

**Status legend:** `[ ]` not started · `[~]` partly built · `[x]` done and verified on prod.

---

## The one hard date

**Future Caribbean closes Sunday 6 Sep.** Today is Mon 31 Aug — six days. Nothing else in this
document has an external deadline.

That forces one scheduling decision, and it is the only place this plan departs from the order as
spoken:

> **The campaigns launch first and run in the background; they do not wait for the hardening pass.**

A campaign is only proof once *real people* show up, and that is wall-clock, not work — strangers
took days to appear on the last two. Launching Starknet on day 1 and the public $10 pot on day 2
means they are accumulating real claimants while the FC build happens. Serialising them behind an
open-ended hardening pass would spend the whole six days and reach FC with nothing live.

Agent hardening is therefore continuous and scoped to what the live campaigns and FC actually
exercise, rather than a phase that must "finish" before anything ships.

---

## Track A — The agentic system, everywhere (continuous)

Goal in the user's words: *any user, any tester, any product, any founder or freelancer or employee
can use it and Sage works the best — no lack, ready to be used — and if we change the LLM it works
the same.*

That last clause is the one that makes this measurable. "Works the same on a different model" is
not a feeling; it is the batteries passing on a model they were not tuned on.

### A1 — Baseline every AI surface on the current models
Run each battery once, **one at a time** (they contend for one key on a 2-core box; the loser
reports timeouts that read exactly like quality failures). Record the number, not the vibe.

- [ ] P-GEN — inspect → field test → vision → mission brain → gate. *Anchor integrity below 100% is a hard stop.* Must show `signed in as …` and non-zero token cost or the run is void.
- [ ] P-DIRECT — gig vs grant vs testing routing, exact budget, faithful amounts (run on the VM)
- [ ] P-ROUTE — tool routing across both surfaces incl. the recipient journey
- [ ] P-JUDGE — payout judge: zero wrong-autopay, all in-set, provenance intact
- [ ] P-WORK — the gig/artifact lane, two-sided (attack-autopay AND honest-hold both hard fails)
- [ ] obs ledger — observation judge vs fixtures
- [ ] P-VERIFY — the deterministic verification contracts

### A2 — Prove LLM portability for real
The lane system already exists (`<LANE>_API_KEY/_BASE_URL/_MODEL`, all three or ABSENT) and
`provider-profile.ts` handles reasoning overhead. What has never been done is *running the batteries
on a second model and comparing*.

- [ ] `scripts/lane-audit.mjs` first — print which provider each lane actually resolves to
- [ ] Re-run P-JUDGE + P-WORK + P-DIRECT on a second model (MiniMax-M3 ↔ the alternative)
- [ ] Any row that passes on one and fails on the other is a **portability defect**, not a model preference — fix the prompt/schema/budget, not the model choice
- [ ] Write the result up as the promotion evidence for a second approved judge identity

### A3 — Known open defects to close
- [ ] P-DIRECT's two routing misses: a plainly-worded gig ("pay my designer $50 when the logo page is live") and one Spanish request produce **no campaign at all**
- [ ] Named-recipient gigs — "pay *my* designer" becomes an open bounty anyone can claim. Product decision, not a bug.
- [ ] Every refusal reason readable by the person who received it; no dead ends
- [ ] 16 stuck operator fees, $1.60, retried 1,914× each — Sage's own revenue, unbounded retry with no cap
- [ ] Rendered-evidence path (`RENDERED_EVIDENCE_MODE=enforce`) still unproven against a JS-only page

### A4 — The defect class to hunt, not just the defects
Two bugs on 2026-08-31 were both *Sage lying to itself*, invisible in any diff:
the marker check refusing a worker's own address, and a publish-anywhere gig judged against the
campaign's own page. Neither was a model failure.

- [ ] Sweep every place a brief/criterion is assembled for a model and ask: **can this condition be satisfied at all?** (Same shape as the grounded-yield chain.)
- [ ] Sweep every string built from optional data for the dangling case (`"created on ."`)
- [ ] Standing rule: when a model holds work that passed every deterministic check, **suspect the brief before the model**

---

## Tracks B & C — the launch sequence (paired: every post opens a campaign)

Replanned 31 Aug on the user's call: **launch by launch, and every feature launch ships with live
work on the board.** Gigs and milestone grants have never been announced on X at all, so each post
does double duty — it announces the feature AND puts money people can go earn right now.

Two rules that shape the calendar:

- **The campaign goes live BEFORE its post.** When the post lands the marketplace must already have
  work on it; an empty board on launch day is the worst possible first impression, and it is the
  state the board is in today.
- **Tue/Wed peak, never weekends** (GOAT CMO playbooks). Links go in the self-reply — in-body links
  cost 30-50% reach.

### Launch A — privacy rail + gigs · post Tue 1 Sep
The differentiator, and it debuts gigs to the public with money on the table. One post carries both
because they are one story: Sage pays for work, it now does it privately, here is $10.

- [ ] **Today:** ship the `intent_hash` event fix, so the post can claim the strong version
- [ ] **Today:** launch the campaign — $10, $1.00 × 10 slots, one reward per wallet, Starknet
- [ ] **Tue:** post `docs/posts/2026-08-31-strk20-privacy.md`
- [ ] Screen recording of the real claim (never a live claim link on camera — bearer cash)

### Launch B — milestone grants · post Wed/Thu 2-3 Sep
**Gated on two things, and neither is optional.** Grants have run in production ZERO times, and
P-DIRECT found the equal-split defect where a founder saying "half and half, $40 total" gets no
campaign at all. Announcing a lane that is broken for the commonest phrasing would be worse than
not announcing it.

- [ ] Fix the equal-split routing defect (deterministic split from the founder's stated total)
- [ ] Prove ONE milestone grant end to end — walletless recipient, invite → earn → verify → pay →
      cash out → record. Needs a second Telegram account.
- [ ] Then launch a grant campaign + post

### Launch C — the results post · Thu/Fri, once real accounts exist
**This is the one to tag @ellibenson on, and only this one.** A founder amplifying "look at my
product" is an ask; amplifying "N people just used Starknet privacy for real income" is a gift to
the ecosystem and is his narrative rather than ours. Tagging on the launch spends the favour on
nothing.

- [ ] Post the count + links to the accounts people wrote
- [ ] Proof into README / `/explorer` / the FC data room

**Funding** (user, 31 Aug): $10 now, ~$20 more if it goes well, on whichever rail we launch on.
Do NOT raise the per-campaign caps to absorb it — absorption runs 5-20% and that is downstream of
tester supply, not of the cap.

## Track D — Future Caribbean (the six days)

Track ask: *aggregate fragmented data → real-time credit profile → lending without collateral.*
Sage's sentence: **Sage is the cash-flow oracle. Rails move the dollar. The file is what a lender
(or Sage) can advance against.**

Tick the CORE, show a path on the rest. Do not fake CARICOM FX, a bank integration, or a bureau
score.

More of this is already built than the list implies:

| # | Item | State |
|---|---|---|
| 1 | Credit file v1 | `[x]` `credit-signals-v1` live — `src/lib/campaigns/credit.ts`, `/record`, `work-record.v2`. **Philosophy already frozen in code**: no Sage score, published formulas only |
| 2 | Advance offer on the page | `[~]` `advanceCapacityUsd()` exists and the lender supplies the multiple. **Missing: the surface + "Fund this advance"** |
| 3 | One real advance payout on GOAT | `[ ]` needs a funded pot |
| 4 | Lender API + CSV | `[~]` `/api/record/[wallet]`, `/export`, `/attest`, `/privacy`, `/lender` all exist — **verify against the brief, don't rebuild** |
| 5 | Compliance + audit export | `[~]` `/docs/compliance` + OFAC screening at three doors shipped; audit export to confirm |
| 6 | Corridor fee line vs 8% remittance | `[ ]` |
| 7 | Fiat-exit stub in the architecture doc | `[ ]` doc only — do not integrate a partner without keys |
| 8 | One Caribbean narrative in the overview | `[~]` `docs/fc/submission-overview.md` exists |

**Freeze the philosophy explicitly (item 1's real remaining work):**
no Sage score · **empty ≠ deny** · **withheld ≠ fail** · the lender supplies the multiple ·
every number has a published formula.

**The biggest unproven claim, and the best demo:** milestone grants have run in production
**zero times, ever**. Walletless recipients: zero invites, zero wallets. Recipient cash-out: never
run. The public promise — *"for someone banks pretend don't exist, that record is the beginning of a
real credit history"* — depends on invite → earn → verify → pay → cash out → record, which has
never met a real human. Proving that loop once is simultaneously the FC demo, the unproven claim,
and the first exercise of three untested subsystems. *Needs a second Telegram account.*

- [ ] One real milestone grant on mainnet to a walletless recipient who then cashes out and holds a credit record

STRK20 stays the private receive path. It does not have to carry the credit product.

---

## Posting cadence

Post on every feature addition, through the FC build, not only at the end.

1. **Privacy rail** — Starknet private payouts + screen recording *(Track B)*
2. **Money on the table** — public $10 campaign + launch recording *(Track C)*
3. **Gigs + milestone grants** — the feature, with a reason to try
4. **FC build-in-public** — one post per landed FC item

Rules that survived the GOAT CMO playbooks: link goes in the **self-reply**, never the body
(30–50% reach cost). A reply is worth ~27× a like. Tue/Wed peak, never weekends. Pair "Sage" with
a unique qualifier — the bare word belongs to Sage Group / Sage Pay / Ask Sage.

---

## Standing working rules

- Verify on prod after rsync, before build+restart — a green build does not prove a complete sync
- Deploys guarded on 0 pending/settling, via the app's own `better-sqlite3`
- Any inspection / field-test / vision / mission-brain / gate change runs P-GEN before deploy
- Mutation-test every new guard: delete it, watch the test go red
- Validate the instrument before believing the reading — most "quality regressions" here have been broken rulers
- **Decisions are CACHED.** A judge fix changes nothing for existing work until the decision row is dropped
- Push `main` after every green prod deploy
