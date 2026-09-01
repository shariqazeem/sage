# THE FINAL WEEK — one system, two submissions

Rewritten 2026-09-01 with the user, on the settled thesis (Opus draft, Grok stress-test).
**Future Caribbean closes Sat 6 Sep. STRK20 extended to Sun 7 Sep.** FC is the priority — Metis-
recommended, we hold their 1st-place signal, and the Finance/Payments/MSME track rewards exactly
what already exists. Both submissions come from ONE repo with different skins.

Prior week's results (batteries all green, 8 defects fixed, privacy events, shell/nav, posts) are
in git history and memory. This file is only what remains.

---

## The thesis, as it goes in both submissions

> **Agentic working-capital infrastructure.** Sage witnesses performance, a vault bounds the
> agent, rails discharge the obligation, the record is underwritable, and third-party capital can
> sit behind the same judge.

```
witness (agent)
  → obligation (signed, capped)
    → vault (cannot exceed)
      → router (GOAT public · STRK20 claim · fiat adapter next)
        → record (public tape or selective proof)
          → capital in (advance — THE transformation)
```

**Language rules (hard):**
- NEVER "we removed credit risk." Say: *waterfall on witnessed inflow — recourse on the
  Sage-routed remainder.* The borrower can stop using Sage; a Citi judge will say so in one line.
- "Sage doesn't read cash flow. It **witnesses** it. In markets where the books don't exist,
  Sage writes the book as the work happens."
- The **45% refusal rate is the institutional asset** — lead with it everywhere.
- Trade finance is the same loop with different evidence adapters — say "next adapter," never
  claim a test receipt is a bill of lading.
- CARICOM FX matching: one honest slide — netting becomes real on our own book when obligations
  exist in two currencies; not built this week because inventing counterparties is an app, not
  infrastructure.
- Fiat / crypto-banned: adapter INTERFACE + "mark paid via partner" stub, clearly labelled. The
  same verified credit event records either way — that is what makes it an infrastructure claim.
- STRK20 skin: *income that can be borrowed against without being a public diary.* Pool-native
  (claim → shield), viewing-key-shaped disclosure (floor attestation), matches how StarkWare
  itself pitches STRK20 (privacy as a mode of activity, not a mixer).

**First lender is US** (the Sage Advance pot). One advance, disbursed and repaid on mainnet with
receipts, beats any institutional letter of intent. The NYSE line: the facility works, the LP is
still us, the pipe is open for a credit union.

---

## WHAT NEEDS YOU — Mon 1 Sep, night (everything else below is done or mine)

1. **Fund + launch the $10 STRK20 gig** (posts ready: `docs/posts/LAUNCH-KIT.md`). Campaigns
   need wall-clock with strangers before Sat.
2. **Fund the grant-demo path**: agent wallet `0x3a60…8341` needs ≥$2.50 USDC + gas, and the
   second Telegram account — then the milestone-grant e2e film runs per
   `docs/runbooks/grant-e2e.md`.
3. **Declare the privacy vault class** (password-gated `starknet-deploy.mjs`) — until then,
   vault events keep naming recipients and the STRK20 package says "pending" in as many words.
4. **Collect the outstanding claim into a shielded note** → the 4th qualifying tx for
   `strk20.json` (the only agent-decided payout on that list).
5. **Record the demo videos** (`docs/posts/VIDEO-SPECS.md`).
6. **The real advance on mainnet** happens by itself once (1) and an earner exist — I run
   `scripts/advance.mjs` the moment there's a funded record to lend against.

### Launch runway pre-flight (Mon night — clear for your funding tomorrow)

GOAT head fresh (4s) · operator gas covers **~1,547 settlements** at the last settle's cost ·
Starknet RPC live (block 14.18M) + operator configured · `deputy-watch` online 2d (autopilot
ticks alive) · sweep endpoint fails closed · lanes: MiniMax-M3 on PAYOUT/CONCIERGE/MISSION,
Haiku on OBS_JUDGE, Gemini-Flash-Lite on VISION, fallback armed · disk 62%. Crossmint spike is
credential-gated: no CROSSMINT key on the VM — needs a staging key from you when its turn comes.

### What landed overnight (Mon → Tue)

- **P-DIRECT CERTIFIED** — two conclusive rounds + targeted 3/3 currency certification; money
  invariants perfect; the battery gave up its last three quote-less calls; lint made total.
- **Watch-don't-chat shipped**: the dashboard desk is LIVE (15s poll, honest heartbeat,
  proven in-browser: a settlement arrived as "Paid $0.50 · proof" on an untouched page).
- **The friction audit's big find, fixed end-to-end**: four surfaces derived "money settled"
  four ways (three totals on one day) — and two real Starknet payouts had NEVER reached the
  events journal. Journal now writes on the dispatch (both rails, every caller), prod rows
  backfilled, `settledLedger()` is the one derivation with NAMED scopes, drift-tested.
  Live now: explorer/outcomes-flow **$52.60/29** · marketplace/launch/outcomes-access
  **$50.60/26/21 people** (dogfood excluded).
- **Both submission packages assembled Monday** (Friday is now review-only): FC data room
  (`docs/fc/data-room.md`, all 9 links verified 200) and STRK20
  (`docs/strk20/submission.md`; manifest now lists BOTH contracts and serves at
  https://sagepays.xyz/strk20.json, with a two-copies drift test).
- P-ROUTE diagnostics read: green and conclusive; the lone ⚠ is the known reasoning-model
  flake. Plan reconciled with built reality (BUILD 1 boxes, rail picker).

---

## BUILD 1 — Sage Advance (capital in + waterfall) · the transformation

The one genuinely new layer. Everything else exists.

- [x] **Schema**: `advances` (borrower wallet, principal base, published terms: multiple,
      waterfall fraction, pot address) + `advance_repayments` (payout id, leg amount, claim tx).
      Migration. Deterministic formulas only — Sage still scores nobody.
- [x] **Disbursement**: pot → claim link to the borrower (reuses SageClaims; the advance itself is
      private-capable). Operator-signed, capped by `advanceCapacityUsd` (exists).
- [x] **Waterfall — NO NEW CAIRO**: on the claims rail, `escrowPayouts` mints TWO legs via
      `deposit_many` when the earner has an outstanding advance: repayment leg (pot's secret) +
      remainder (worker's). Deterministic fraction from the advance terms. Vault flow byte-
      untouched; this is additive AFTER the vault call in `settle-starknet.ts` (frozen-listed —
      explicitly authorized by the user for this build; full test + mutation discipline; EVM flow
      not touched — GOAT is "the next adapter" and we say so).
- [x] **Record**: `/record` shows advance outstanding / repaid-via-N-payouts with the published
      arithmetic. Repayment history IS the credit story lenders ask for.
- [x] **Surface**: advance offer card on `/record` + "Fund this advance" on `/lender`
      (lender supplies the multiple — `advanceCapacityUsd` already enforces the philosophy).
- [ ] **THE PROOF**: one real advance on mainnet — worker with a real record takes an advance →
      their next verified payout auto-splits → both legs' receipts land on `/record` and
      `/explorer`. This is the FC demo's climax.

*(All five build boxes above VERIFIED BUILT 1 Sep — `src/lib/advance/` + `src/lib/db/advances.ts` +
migration 0049, `scripts/advance.mjs` claim-link disbursement, the waterfall block in the frozen-listed
`settle-starknet.ts` (user-authorized), the advance section live on `/record`, the facility on `/lender`.
Only THE PROOF remains, and it needs a funded campaign + a real earner — user-gated.)*

## BUILD 2 — milestone grants proven + direct-lane recall

Grants have run in production ZERO times and are the FC centrepiece.

- [ ] **READY — runbook at `docs/runbooks/grant-e2e.md`**, every prerequisite verified on prod
      except the two user items (fund the agent wallet `0x3a60…8341` ≥$2.50 USDC + gas; second
      Telegram account). One real milestone grant end-to-end: walletless recipient —
      invite → earn → verify → pay → cash out → record. Caribbean-flavoured framing
      ("fund a market seller in two tranches") so the run IS the film.
- [x] Fix the over-eager route (1 Sep): `testimony-condition.ts` — a deterministic
      AUTHORITY/DECISION/APPLICATION gate wired into the concierge before stated-terms; "when
      the bank approves her loan" now gets the honest refusal, never a campaign.
- [x] **P-DIRECT CERTIFIED (1 Sep, rounds 8–10).** Two conclusive full rounds (0 provider
      failures) with the money invariants PERFECT — budget violations 0, amount drift 0,
      invented milestones 0, unverifiable missions 0 — then a targeted 3/3-clean certification
      of the currency row (J$ tranches → stamped quote → exact split). Residuals are model
      flakes that pass in sibling rounds (no-tool 2/63) plus one correct schema refusal of an
      unpriced local amount. Along the way the battery itself gave up its last three quote-less
      calls (stated-terms, compile, budget check, lint) — and `lintDirectCampaign` is now TOTAL:
      advice can never crash a caller again. Decision rule honored: stop burning rounds.

### P-ROUTE standing (read 1 Sep)

The last full run is GREEN and conclusive: 31/32, providerFailures 0, prematureConfirms 0.
The single ⚠ (pr-web-gig run 2/2) is the reasoning-model flake documented in
[[reasoning-model-portability]] — the `<think>` block consumed the turn and no tool call
emerged; the same fixture routes correctly in run 1. Model variance, not a routing defect;
nothing to fix.

## BUILD 3 — STRK20 completion

- [ ] **Declare the privacy class** (user: password) → new campaigns stop naming people in
      `PayoutReleased`/`PayoutRefused`; README/docs claims upgrade to what is then deployed.
- [ ] **4th qualifying pool tx**: user collects the outstanding autonomous-payout claim into a
      shielded note → add to `strk20.json` (the only agent-decided one on the list).
- [x] **Floor attestation surfaced** (1 Sep): the earner issues a signed lifetime floor on their
      withheld record (owner-gated, EVM signing; Starknet stated as next); the lender pastes and
      verifies it on /lender — subject-match trap covered, per-active-month arithmetic in floors
      only, issuer published for off-platform verification. Proven live: prod refused a
      foreign-signed document with "signed by a different issuer".
- [ ] Campaign live for STRK20 people ($10 gig — posts ready in `docs/posts/LAUNCH-KIT.md`).

## BUILD 3.5 — the web app as the product (user directive, 1 Sep)

**"Focus on sagepays.xyz over Telegram for both submissions."** The app must: work easy, look
million-dollar, do everything inside itself, and feel like ONE ecosystem — every surface connected.
Method: walk the real journeys first, name the friction concretely, fix the top items — never a
blind repaint. Telegram stays (it is proven infrastructure), but the WEB is what judges touch.

- [x] Friction audit walked (1 Sep) — marketplace, launch, explorer, record, outcomes, claim,
      dashboard. THE find: four surfaces derived "money settled" four ways and showed three
      different totals on one day — including a rail whose manually-approved settlements never
      reached the events journal at all (two real Starknet payouts, invisible on the page headed
      "Every settlement").
- [x] Fixed the top disconnections (1 Sep): the settlement journal now writes on the DISPATCH
      (every caller, both rails; two prod rows backfilled from mission-derived amounts) and
      `settledLedger()` is the one derivation every money surface reads — explorer/outcomes-flow
      headline $52.60/29 (every settlement), marketplace/launch/outcomes-access $50.60/26/21
      (to testers, dogfood excluded). Different numbers now mean different NAMED scopes, never
      drift; the drift test asserts launch ≡ ledger on the same seeded rows. Still empty-board:
      the marketplace waits on the user's $10 campaign, a funding event, not a defect.
- [x] First ecosystem pass (1 Sep): both doors on the home, human greeting, ?do=pay deep door,
      console → briefed agent hand-off
- [x] **WATCH, DON'T CHAT (user thesis, 1 Sep) — SHIPPED same day.** The console's strip was
      already live (SageActivity, 5s poll); the founder's HOME was the gap — a server snapshot
      that said nothing while Sage judged and paid. Now `/api/founder/desk` (founder-scoped by
      construction, anonymous → empty desk with the loader never consulted, pinned) + a calm 15s
      poll with hidden-tab and sig-diff discipline; honest "worked Xm ago" heartbeat; one quiet
      380ms entrance per arriving row. Proven in the browser: page open and untouched, a
      submission made the section appear from empty, a settlement arrived as "Paid $0.50 · proof"
      with the heartbeat flipping to "worked just now".
- [x] Million-dollar pass, first sweep (1 Sep night): mobile walk of every money surface —
      marketplace, outcomes, explorer, record, lender, dashboard. One systemic fix shipped: the
      floating mode pill overlapped the first line of all four shelled money pages on mobile —
      one `--pill-clear` token, scoped on `html[data-app-shell="on"]` so /proof keeps its
      standalone spacing. Everything else measured clean (a suspected explorer row overlap was a
      screenshot-scaling artifact — the DOM shows a 12px gap). The user's own eye on Fri remains
      the final pass.

## BUILD 4 — FC package

- [x] Corridor line — live on /outcomes: the 8% corridor would have taken $4.21 of the $52.60 settled; recipients received it.
- [x] **Outcomes, not chains** — BUILT (`deploy/rail-choice.tsx`): the founder answers
      **Public receipts / Private-capable**, both options state their cost, the chain is fine
      print; the choice survives a reload (`rail-persistence.test.tsx` — the silent-revert trap
      is pinned).
- [ ] **DEFERRED TO THE END** (user, 1 Sep): Crossmint third-door spike — after the outcomes
      surface and infra-feel pass; "make the existing financial system work as one" first.
- [ ] **/outcomes — the brief's bar, answered with readings** (decided 1 Sep). One public page
      computing the four outcome bars from the LIVE ledger: cost vs the 7–9% corridor, speed
      (submission → settled, verification included), access (people paid, refusal integrity,
      the advance facility), flow (settled capital, funders, currencies, rails). Every number
      derived, every claim linked to receipts, gaps stated as NOT YET MEASURED. This is the
      infrastructure "feel": a system publishes its outcomes; an app publishes its features.
- [x] **Fiat adapter interface** (1 Sep): SETTLEMENT_DOORS registry + typed FiatDisbursement
      contract (cannot ship without the identical credit event) + real corridor quote + a disburse
      that refuses in words. Architecture doc: "Where crypto cannot go".
- [ ] Crossmint as that door's first implementation (spike rules unchanged, at the end).
      Real adapter implementation against Crossmint STAGING ($10 credits), honestly labelled:
      production pending compliance onboarding. Scenes it unlocks are the brief's own — diaspora
      card funds a grant (onramp), no-crypto recipient paid to an email wallet, fiat cash-out
      (offramp) — and the credit event records identically whichever door discharged it.
      HARD RULES: never touches GOAT/STRK20 rails (Crossmint supports neither — it is the third
      route, not a replacement); no fourth identity system (Privy already covers walletless);
      **1-hour timeboxed SPIKE FIRST** to verify chain list, credit coverage, and whether
      onramp/offramp geography actually holds for the US/CA/UK → Caribbean corridor — if it
      doesn't, it ships as an adapter demo and the doc says so. No claim that dies to one
      judge question.
- [x] Lender API verified + extended: work-record.v4 with the advances block through one redaction boundary; CSV export standing.
- [x] Submission overview refreshed (1 Sep) — two rails + outcome picker, the money path, the
      advance facility + waterfall, selective disclosure, /outcomes readings, v4 API; numbers
      re-read from the live DB ($52.60 · 29 payouts · 22 earners · 44% refused of 52); the two
      pending receipts named honestly (first advance round-trip; grant e2e). Data room;
      TRL update; demo videos (screen recordings — beat: the agent deciding, the split payout).
- [ ] Agentic quality holds for ANY product: the standing batteries stay the gate for every
      change (P-GEN for inspection-side, P-DIRECT for money lanes, P-WORK for gig judging).

---

## The week

| day | ships |
|---|---|
| **Mon 1** | Campaigns LIVE first (STRK20 gig + fund grant demo) — strangers need wall-clock. User: declare class, collect claim (4th tx), 2nd TG account. Me: refusal gate + recall fixes; advance schema. |
| **Tue 2** | Milestone grant e2e (the film). Advance disbursement + surfaces. Launch post is out; campaign post fires. |
| **Wed 3** | Waterfall implementation + mutation tests. **The real advance on mainnet.** |
| **Thu 4** | Floor attestation in lender flow. Fiat adapter stub + corridor line. P-DIRECT re-run. |
| **Fri 5** | Both submission packages assembled; demo videos recorded; results post (tag ellibenson only on RESULTS). |
| **Sat 6** | **FC SUBMITTED (deadline).** STRK20 package final; submit same day — never use the Sun buffer by plan. |
| **Sun 7** | Buffer only. |

**Standing rules carry over**: deploy guard (0 pending/settling), checksum-verify every synced
file, batteries one-at-a-time on a quiet box, mutation-test every new guard, decisions are cached,
push main after green deploys, every number in a submission read from the chain or the DB — never
typed.
