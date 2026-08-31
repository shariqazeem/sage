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

## BUILD 1 — Sage Advance (capital in + waterfall) · the transformation

The one genuinely new layer. Everything else exists.

- [ ] **Schema**: `advances` (borrower wallet, principal base, published terms: multiple,
      waterfall fraction, pot address) + `advance_repayments` (payout id, leg amount, claim tx).
      Migration. Deterministic formulas only — Sage still scores nobody.
- [ ] **Disbursement**: pot → claim link to the borrower (reuses SageClaims; the advance itself is
      private-capable). Operator-signed, capped by `advanceCapacityUsd` (exists).
- [ ] **Waterfall — NO NEW CAIRO**: on the claims rail, `escrowPayouts` mints TWO legs via
      `deposit_many` when the earner has an outstanding advance: repayment leg (pot's secret) +
      remainder (worker's). Deterministic fraction from the advance terms. Vault flow byte-
      untouched; this is additive AFTER the vault call in `settle-starknet.ts` (frozen-listed —
      explicitly authorized by the user for this build; full test + mutation discipline; EVM flow
      not touched — GOAT is "the next adapter" and we say so).
- [ ] **Record**: `/record` shows advance outstanding / repaid-via-N-payouts with the published
      arithmetic. Repayment history IS the credit story lenders ask for.
- [ ] **Surface**: advance offer card on `/record` + "Fund this advance" on `/lender`
      (lender supplies the multiple — `advanceCapacityUsd` already enforces the philosophy).
- [ ] **THE PROOF**: one real advance on mainnet — worker with a real record takes an advance →
      their next verified payout auto-splits → both legs' receipts land on `/record` and
      `/explorer`. This is the FC demo's climax.

## BUILD 2 — milestone grants proven + direct-lane recall

Grants have run in production ZERO times and are the FC centrepiece.

- [ ] One real milestone grant end-to-end: walletless recipient (2nd Telegram account) —
      invite → earn → verify → pay → cash out → record. Caribbean-flavoured framing
      ("fund a market seller in two tranches") so the run IS the film.
- [ ] Fix the over-eager route (MONEY-ADJACENT, do first): "when the bank approves her loan"
      must REFUSE — an unverifiable third-party condition. Deterministic gate, not prompt hope.
- [ ] Recall prompts: model must reach for `splitTotalUsd` (thirds-of-total, currency tranches);
      designer gig; Spanish; per-person pricing; deadline≠milestone. Re-run P-DIRECT after.
      One battery at a time; NOTHING else on the VM during a run.

## BUILD 3 — STRK20 completion

- [ ] **Declare the privacy class** (user: password) → new campaigns stop naming people in
      `PayoutReleased`/`PayoutRefused`; README/docs claims upgrade to what is then deployed.
- [ ] **4th qualifying pool tx**: user collects the outstanding autonomous-payout claim into a
      shielded note → add to `strk20.json` (the only agent-decided one on the list).
- [ ] **Floor attestation surfaced**: "/record can prove ≥$X 90-day verified inflow without
      showing transactions" — wire the existing attest endpoint into the lender view. This is the
      selective-disclosure half of "borrowable income, not a public diary."
- [ ] Campaign live for STRK20 people ($10 gig — posts ready in `docs/posts/LAUNCH-KIT.md`).

## BUILD 4 — FC package

- [ ] Corridor line: measured USDC settlement cost vs 7–9% remittance, on real payouts.
- [ ] Fiat adapter interface + stub + architecture doc section (crypto-banned answer).
- [ ] Verify lender API + CSV + audit export against the brief (exists — verify, don't rebuild).
- [ ] Submission overview mapping every track criterion to a receipt-backed fact; data room;
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
