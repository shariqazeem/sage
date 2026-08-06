# HANDOFF-6 — the growth round (2026-08-06)

Built directly against your measured state document. Every ranked item is taken where code can carry
it; the rest are named as YOUR ops asks at the bottom. Nine repo files modified, uncommitted; the
extract mirrors everything (and now includes `sample-policy.ts` + `decisions.ts` for review).
Frozen layers untouched — including for your #2, which turned out not to need brain-core at all.

## 1. Your #2 — honest testers are no longer recorded as fraud (`decisions.ts`, sweep)

The classic brain now **abstains** on observation missions instead of voting
`hold / no_evidence / HIGH`. The check sits in `ensureDecision` AFTER the V2 identity gates (all
preserved): `mission.verifiabilityClass === "observation-based"` → a neutral receipt
(`recommendation: review`, no fraud signals, summary naming the judge with jurisdiction, model
marker `OBSERVATION_ABSTAIN_MODEL = "observation-abstain"`, full V2 provenance). Nothing weakens:
the observation lane independently re-detects injection on the account, its bar + validated-veto
still gate the payout, and wallet freshness (MEDIUM, lane-independent) is still recorded.

The sweep's heuristic-retry now skips abstain rows (`dec.model !== OBSERVATION_ABSTAIN_MODEL`) —
without that it would delete + reinsert the abstain every tick. **brain-core.ts untouched; the
red-team suite is unaffected by construction** (the frozen brain simply isn't consulted where it
has no jurisdiction).

*Optional, your call:* a backfill migration rewriting the 4 historical wrong briefs (incl.
VrgkqtXEtZ / tx 0x8df776…0069) to abstain form. I did not write it — historical-record surgery is
an operator decision.

## 2. Your #1 — the entry-screen wall (`field-test.ts`, `browser-controller.ts`)

Three deterministic levers on top of rounds 1–5's navigation work:
- **Menu opening** (`chooseMenuAffordance`): when the path harvest is starved (<2 known paths), one
  click on anything that names itself a menu (menu/navigation/☰/… — `affordanceKey`-normalized, one
  per screen, dead-label aware). Mobile-first sites and SPAs hide their whole map behind it.
- **Reveal scroll**: one deterministic scroll-down per run when a screen minted <6 elements —
  below-the-fold nav/CTAs feed the next harvest.
- **Fallback ladder**: the scripted affordance ladder (previously no-goal-only) now also runs when a
  goal-directed loop dies early (≤2 states with budget left) — a controller outage or instant wall
  no longer returns a near-empty inspection while minutes remained.

## 3. Your #3 — the never-arrives guard (sweep + `db/campaigns.ts`)

Standing invariant in the sweep: `listUnresolvedSubmissionsOlderThan` (deliberately INCLUDING
terminal campaigns — their exclusion from the processing list is exactly how the 14/15-day
strandings went unseen) + a once-per-row journal event (`submission_stale`) and operator Telegram
ping as each row crosses the 24h silence bound. No auto-resolution — money decisions stay human;
silence just can't happen. `summary.stale` counts them per tick.

## 4. Your #4 — the timing claim (`mcp/server.ts`)

"roughly 4-11 minutes" → "typically finish in about 1-4 minutes (median ~90 seconds; a deep
interactive product can take longer)". The conformance test forbids "a few minutes" — the new
wording avoids it. **The OKX listing text is external and yours to update to match.**

## 5. Your #5 — grounded_v2 share (`mission-grounding-shadow.ts`)

A fully COMPILER-SUPPORTED plan (every proof re-verified) no longer loses selection to critic
provider weather: `everyCriterionCriticSupported` and the critic side of `provenancePresent` are
satisfied by compiler support **when the critic failed at TRANSPORT** (`provider_error` — a 429/
timeout). A critic that RESPONDED with a malformed verdict (`schema_invalid`) still fails closed.
This was one concrete reason the strong path was 20-of-234.

*Env asks that move this number more than any code:* keep `MISSION_GROUNDING_MODE=canary`, and
decide `MISSION_CANARY_ALLOWLIST` — `*` opens the grounded path to every founder you DM; today only
allowlisted wallets ever get grounded plans.

## 6. The founder's asks — satisfying pay + a right answer never dies on weather

- **Fair-floor pay** (`sample-policy.ts`): alongside round 5's overpay ceiling ($0.20/min), a
  satisfying-pay floor ($0.05/min, never below $0.10): small budgets prefer FEWER, fairly-paid
  testers, and the budget-limited question quotes the effort-derived floor. Probed matrix (all
  green): $1.50/20-min plural → ASKS (one fair reward only); $1.50/5-min → 3×$0.50; $10/5-min → 10×$1
  (plural or singular); legacy no-effort → unchanged; url missions untouched; two-mission split →
  fair per share. One honest note: my first cut raised small pots toward the preferred sample
  (3×$0.50 for 20-min work) — the probe caught it and the raise is now pot-supported only. **This
  module still has no test file; please add one pinning exactly this matrix.**
- **Degraded-judge double-check** (`observation-judge.ts`): a provider hiccup returns exactly
  {confidence 0, no corroborations, no contradictions} — indistinguishable from a genuine zero, and
  for a paraphrasing tester the corroboration bridge IS the payout. On that exact all-zero shape,
  ONE judge retry. A real fabrication retried once returns the same zeros; every claim is still
  validated to verbatim pairs. A right answer explained badly no longer dies on provider weather.

## 7. Surface consistency — audited again, no drift

One engine: web agent tab (`/api/agent` → `runConciergeWeb`) and Telegram (`webhook` →
`runConcierge`) share `runAgentTurn`, one prompt set, one tool registry; all inspections flow
through `/api/launch`; failure copy is one `friendlyFailure`; plan/notice copy parity held. The only
per-surface deltas are the deliberate ones (no money tools on web; no push notices on web).

## Files changed (9 repo / mirrored to extract)

| file | change |
| --- | --- |
| `src/lib/deputy/decisions.ts` | observation abstain + marker const (§1) |
| `src/app/api/deputy/sweep/route.ts` | abstain retry-exclusion + never-arrives guard (§1, §3) |
| `src/lib/db/campaigns.ts` | `listUnresolvedSubmissionsOlderThan` (§3) |
| `src/lib/mcp/server.ts` | honest timing (§4) |
| `src/lib/launch/mission-grounding-shadow.ts` | compiler-supported survives critic transport failure (§5) |
| `src/lib/launch/sample-policy.ts` | fair floor + pot-supported raises (§6) |
| `src/lib/deputy/observation-judge.ts` | degraded-judge double-check (§6) |
| `src/lib/launch/field-test.ts` | menu, reveal scroll, fallback ladder (§2) |
| `src/lib/launch/browser-controller.ts` | `chooseMenuAffordance` (§2) |

## Gates, and the results I'm asking you to send back

1. `lint` + `typecheck` + full suite + red-team (expect green — frozen layers untouched). Add the
   sample-policy test file (§6).
2. **P-GEN battery**: anchors 100%, ≥10/11 ready. Send the grid.
3. **Founder acceptance re-runs** (send both traces):
   - commonstack.ai at $10 — expect: several missions, ~$0.50–$1.50 per tester, ≥1 url mission, no
     search-box submission, no repeated cycle, playground navigation CREDITED.
   - sagepays.xyz — expect: honest stop at the budget wall, a real plan (grounded if allowlisted).
4. **Your own #6 — the drill, before strangers do it by accident**: on a live campaign, submit a
   deliberately THIN account → confirm the hold reads as coaching naming the unmet criterion + the
   abstain (not `no_evidence`/fraud) in the stored brief → revise → confirm it clears and pays.
   Send the three receipts (hold, retry, payout). This exercises retry, coaching, abstain, and the
   criteria-complete pass in one afternoon.
5. After a day of sweeps: confirm `summary.stale = 0` and no `submission_stale` events (or that the
   ones that fired were real).
6. Ops copy note (no code): the "translated everything including product names" boundary from your
   Stage-6 table should be one line in tester-facing copy — "name what you saw on screen in the
   product's own words where you can."
