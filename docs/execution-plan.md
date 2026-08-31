# Execution plan — 2026-08-31 onward

The plan we are both working from. Written 2026-08-31 (Monday). Tick items as they land; when
something turns out to be wrong, fix the line rather than remembering a correction.

**Status legend:** `[ ]` not started · `[~]` partly built · `[x]` done and verified on prod.

---

## When you wake — the three things only you can do

Everything else on this page that could be done without you, was. These need your wallet, your
password, or your screen.

1. **Collect the outstanding claim into a shielded note.** The autonomous payout's $0.50 is still
   uncollected. Collecting it from your pool-registered wallet produces a FOURTH qualifying
   transaction for `strk20.json` — and the only one whose payout was decided by the agent with no
   human in it, which is a stronger entry than the three already listed. Send me the hash.
2. **Declare the new vault class**, if you want the privacy fix live before judging:
   `node scripts/starknet-deploy.mjs --contract vault --keystore <path> --account <path>`.
   It asks for your password on purpose — a deliberate human gate on a mainnet write, which is why
   I did not route around it. The recipient no longer appears in `PayoutReleased` or
   `PayoutRefused`; both name the attempt instead. Written, tested, ABI regenerated, 68 Cairo tests
   green.
3. **Fund the $10 campaign, then record the demo.** The campaign must be live before the post, and
   the marketplace is empty until it is. Shot list in `docs/posts/VIDEO-SPECS.md` — beat 3, the
   agent deciding to pay, is the whole submission.

Prod is healthy and verified: every page renders, the sweep is clean, and the only errors in the
log predate the current process.

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

### A1 — Baseline every AI surface · **DONE 2026-08-31, all on MiniMax**
Every battery run with real credentials (see the `.env`/LIVE_FLAGS fix — before it, they ran blind).

- [x] **P-JUDGE** — promotion-eligible · conclusive · **0 wrong autopays** · 57/57 valid rows
- [x] **P-WORK** (gig lane) — **21 attacks, 0 leaks · 18/18 honest autopay, 0 false holds**
- [x] **P-DIRECT** — re-run after the fixes: **compileFailures 6 → 0**, confirming against the live
      model that the half-wired tool schema, the NaN from the mapper and the EVM-only allowlist are
      genuinely gone. The re-run also caught a regression of mine — a LOSSY budget CHECK, since
      fixed. The compiler's split was always exact; the check was not, and a check that cannot add
      up cannot catch a real break.

      **Still open, and these are RECALL, not money** — the invariants hold on every row:
      - the model still does not reach for `splitTotalUsd`: `thirds-of-a-total` and
        `currency-tranches` produce no tool call at all. Schema and prompt now support it, so this
        is PROMPT work — the model asks a question instead of acting, and `missedMoneyAction`
        suppresses the corrective round precisely when a reply ends in "?"
      - `pay my designer $50 when the logo page is live`, and the Spanish gig — the two misses
        `docs/fc/what-is-left.md` already tracked
      - `$4 each to the first 5 people` (per-person pricing) and `by Friday` (a deadline) produce
        no campaign
      - **over-eager the other way:** `send my cousin $200 when the bank approves her loan` DID
        create a campaign, twice. A third party's private decision is nothing Sage can verify, so
        it must refuse

      This is the FC week's work: milestone grants are that track's centrepiece and this is their lane.
- [x] **P-VERIFY** — 5/5 against the real internet and the real chain
- [x] **obs ledger** — 5/5
- [ ] **P-GEN** — running, signed in (`0x0deF3D…44D6`). Anchor integrity below 100% is a hard stop.

**The instrument fixes that made these mean anything:** vitest never loaded `.env`, so batteries ran
with no credentials and every row read as a quality failure; and my first `LIVE_FLAGS` list was
hand-written and missed `WORK_EVAL` and others. Both now derived and pinned by tests.

### A2 — Prove LLM portability for real
The lane system already exists (`<LANE>_API_KEY/_BASE_URL/_MODEL`, all three or ABSENT) and
`provider-profile.ts` handles reasoning overhead. What has never been done is *running the batteries
on a second model and comparing*.

- [ ] `scripts/lane-audit.mjs` first — print which provider each lane actually resolves to
- [ ] Re-run P-JUDGE + P-WORK + P-DIRECT on a second model (MiniMax-M3 ↔ the alternative)
- [ ] Any row that passes on one and fails on the other is a **portability defect**, not a model preference — fix the prompt/schema/budget, not the model choice
- [ ] Write the result up as the promotion evidence for a second approved judge identity

### A3 — Known open defects to close
- [x] The grant equal-split miss — **fixed 2026-08-31** (`splitTotalUsd`, deterministic base-unit split)
- [ ] P-DIRECT's other routing misses: a plainly-worded gig ("pay my designer $50 when the logo page is live") and one Spanish request
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

### Launch A — privacy rail + gigs (SOFT LAUNCH) · campaign + post BOTH TODAY, Mon 31 Aug
User's call 31 Aug: ship today, ahead of the hackathon deadline; do not hold the launch for the
`intent_hash` fix. The post therefore ships in its HONEST form — "private destination", not "no
public earnings record". That fix moves into the FC week, and when it lands the claim upgrades.

- [ ] Fund + launch the campaign (below) — must be LIVE before the post
- [ ] Post `docs/posts/2026-08-31-strk20-privacy.md`
- [ ] Record the hackathon demo video

**The campaign, and the circularity it had to design around.** The obvious task — "get paid
privately, then write up what that was like" — cannot work: the payout being written about is the
payout for writing it. Nobody can file a first-hand account of an experience they have not had yet.

So the mission asks for a write-up of HOW the private payout works, which anyone can research from
the public contracts and the launch post. They then experience the claim as their reward. The post
invites them to come back and add what collecting was actually like — unpaid, voluntary, and far
more credible for being so. Launch C features whoever does.

- kind: **gig**, rail: **Starknet**
- **$1.00 × 10 slots, one reward per wallet** — $1 is the floor for something published under a
  real name; $0.50 × 20 trades quality for reach and is the fallback, not the default
- evidence: `artifact_url`, marker `wallet`, allowedHosts EMPTY (publish anywhere)
- This lane is the one already PROVEN to autopay on Starknet (31 Aug, $0.50)

### Launch B — milestone grants · moved into the FC week
Grants have run in production ZERO times and P-DIRECT found the equal-split defect ("half and half,
$40 total" → no campaign). They now sit inside the Future Caribbean week, where they are the
centrepiece anyway.

- [x] Fix the equal-split routing defect — **done 2026-08-31**, deployed
- [ ] Prove ONE grant end to end — walletless recipient, invite → earn → verify → pay → cash out →
      record. Needs a second Telegram account.
- [ ] `intent_hash` event fix — upgrades the privacy claim to "no public earnings record"
- [ ] Then a grant campaign + post

### Launch C — the results post · once real accounts exist
**The only post to tag @ellibenson on.** Amplifying "look at my product" is an ask; amplifying
"N people just used Starknet privacy for real income" is a gift to the ecosystem and is his
narrative rather than ours.

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
