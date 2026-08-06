# Handoff: agent-quality round 2 (2026-08-07)

Four commits on `fable/agent-quality` (`67991f0`, `56757e9`, `7d4bbb4`, `4719d60`). Not deployed;
deployment belongs to the session that holds prod discipline. Every change below names its
measurement. Prod file hashes matched this branch before I started, so the "before" numbers are
the current live behavior, not stale history.

## Where the defects actually were (measured, prod DB)

All 387 inspections: 269 ready, 102 needs_input, 13 failed, 3 stuck non-terminal for days.
The 102 decompose: `no_missions_passed_validation` 56, `insufficient_observation` 22,
`founder_goal_incomplete` 14, `sample_budget_insufficient` 4, `no_inspected_pages` 4,
`canary_blocked` 2. Of the 56: **31 died at the critic, 25 at the gate** (top gate codes:
hallucinated_route 33, unknown_source_ref 29, target_out_of_scope 19). Every sampled dead-end
asked the founder the same map-seed question regardless of cause. Note: many rows predate the
Aug 6 fixes already on this branch; a fresh P-GEN run (nonce 6) confirmed which failures remain
live — see "instrument runs" below.

## Change 1 — read the whole page (`67991f0`)

**Files** `field-test.ts`, `validate-mission.ts`, `observed-facts.ts`, `extract.ts`,
`deputy/observation-verify.ts`.

**What** `renderedExcerpt` kept 900 chars of `document.body.innerText` (one screen); now 4000,
plus one scroll-down-and-back per page capture to settle lazy content. Architect projection
500→2000 per page, 600→800 per state. Anchor-corpus cap 80k→240k (the corpus is assembled
statics→pages→states→vision, so at 80k a text-rich run truncated exactly the vision tail —
an anchor honestly quoted from a screenshot would have started failing the gate). State facts
400→800 chars. Static snippets 4×160→8×240. Judging key 400 obs/24k→600/36k so page prose
cannot crowd out state/vision phrases.

**Measured** Prod row `DUIJFINbpOpm` (clawup.org, the founder-brief example): every excerpt
exactly 900 chars; "token credit", "per agent", "$20" absent from all browsed evidence;
"pricing" present. After, same product, real local browser: excerpts 4000/1494/4000/1762, all
three phrases present, 242 key observations from 4 sources. Composition probe: `detectGatedActions`
on the credits goal now anchors on real doorway text ("start free trial — 1 day + free token
credits") and the built gated-payment mission **passes the deterministic gate** — the paid step
Sage cannot do itself becomes a mission, per founder-brief §3.

**Also serves payouts** (§4): the pinned key was vision-heavy relative to how beginners write
(P23 open question — genuine narrative accounts clustering at 2/6). Page prose in the key gives
plain-words accounts more matchable firsthand sources. The payout drill (7/7) stayed green,
including "rough broken English CLEARS" and "fluent but empty is REFUSED".

## Change 2 — critic feedback + cause-naming questions (`56757e9`)

**Files** `mission-brain.ts`, `mission-brain-questions.test.ts` (new).

**What** The corrective round used to see only gate reports; a critic kill left zero survivors,
zero reports, and a blind regeneration. It now carries the critic's verdicts plus a steer toward
do-something-observable missions. When the plan still dies, the first founder question names the
strongest rejected candidate and the critic's actual reason (then the map seeds), instead of
"where should a new user start?" on a docs site.

**Measured** Replayed the real `runMissionBrain` (prod's mission model) against the stored maps
of three dead prod rows: tailwindcss.com/docs 0→2 accepted, motherfuckingwebsite.com 0→1,
web.telegram.org still 0 (login wall; an honest ask is the battery-sanctioned outcome) with the
cause-specific question now leading. One replay each — model non-determinism means these prove
direction, not a rate; the battery after deploy is the rate instrument.

## Change 3 — allocate at fair capacity (`7d4bbb4`)

**Files** `pipeline.ts`, `sample-policy.ts`, `budget-scale.test.ts`,
`inspect-and-plan.integration.test.ts`.

**What** The over-funding note warned while the allocator exhausted the whole budget anyway
(prod: excalidraw $913 → 50 × $18.26 for 5-minute work; play2048 $914 → $66.47 per 3-minute
completion; the fresh nonce-6 battery shipped the same shape on plausible/excalidraw/play2048/
yara). New `planFairCapacityBase`: $0.20/min ceiling × 50 testers for qualitative missions, × the
suggested count for url-verifiable ones, null if any mission lacks effort data. The legacy
compile allocates `min(budget, capacity)`; when the cap fires the allocator spreads across the
sample policy's fair counts (without that, the capped pot still concentrated: $3.88/5-min in the
play2048 mirror); the plan carries "the remaining $X stays with you". Canary path untouched
(strict full-budget equality preserved); small budgets byte-identical; the too-little-money
plural question unchanged.

**Measured** Through the real `inspectAndPlan`: $913 on a 3-minute mission ships a $30 plan at
exactly $0.60 × 50 with "$883.00 stays with you"; within-capacity budgets identical. Chain
mirror: play2048's three-mission $914 → $110 spent exactly, ≥100 testers funded, worst reward
$2.18 (balancer divisor residue; was $66.47). Exactness invariant asserted at the capped budget.

**Known residue** With multiple missions the balancer's exact-divisor search can land one
mission a small multiple of its ceiling ($2.18 vs $0.60 above). Bounded by total capacity;
eliminating it would mean touching frozen `budget.ts`, which I did not do.

## Change 4 — reap dead runners (`4719d60`)

**Files** `db/inspection.ts`, `launch/job.ts`, `api/launch/[id]/route.ts`,
`job-reaper.test.ts` (new).

**What** Three prod jobs sat non-terminal for days (two `generating_missions`, one `field_test`)
after deploy restarts killed their `after()` runners — the founder watches "Sage is working"
while nothing runs. The status poll now reaps: >15 min without a stamp (longest legitimate gap
~11 min) → CAS-fail naming the stage → resume if auto-retries remain (prior observations union
into the retry) or an honest failure the retry button acts on. CAS matches id+status+updatedAt:
a live run that advanced is never touched; exactly one of N pollers acts. Both under test.

## Instrument runs

- **P-GEN before (nonce 6, prod = this branch pre-change), complete 11/11**: 10 `ready` +
  1 `needs_input` (telegram — battery-sanctioned for the login-wall row), **anchors 100% on all
  11 rows**, ~192k tokens total. Two check-level flags, both prod-baseline conditions:
  `saas-marketing/mode FAIL(interactive)` (plausible classified interactive; classification
  variance, plan fine) and `portfolio/lintSplit FAIL(0url/2obs)` (brittanychiang drew no
  url-verifiable mission this run; the url-floor corrective round is probabilistic). Five rows
  shipped full-burn plans with the "larger than fair rate" warning (plausible, excalidraw,
  play2048, yara, gitlab-fr) — the exact behavior Change 3 replaces with a fair-capacity plan
  plus "stays with you". Six rows carried the canned signup-surface question — the behavior
  Change 2 replaces with cause-specific questions on rejection dead-ends. Full log:
  session scratchpad `pgen-before-nonce6.log`.
- **Full vitest**: 2535 passed, 1 failed — `campaign-vault.test.ts`, fails identically on the
  clean tree on this machine (no `OPERATOR_PRIVATE_KEY` locally; the VM has it). Pre-existing
  environment gap, not a regression. Please re-run on the VM.
- **Red-team**: 28/28. **Payout drill**: 7/7. **Typecheck** clean, **lint** 0 errors
  (9 pre-existing warnings in untouched test files).
- Frozen layers untouched: brain-core, autopilotGate, mandate, vault ABIs, settle-flow,
  `allocateBudget` itself, the anchor floor and bar in `observation-verify.ts` (only the two key
  size constants moved), no corpus oracle surface added.

## What I did not do, deliberately

- No deploy, no push.
- Canary/grounded path budget behavior unchanged — grounded plans still burn the exact founder
  budget. The same fair-capacity question exists there; flagging, not changing, since the strict
  equality check reads deliberate.
- The cap-DOWN half of `applySamplePolicy` still never reaches uncapped allocations (split is
  raise-only) — a latent oddity on the small-budget path, out of scope tonight.
- `insufficient_observation` on bot-walled products (allbirds 0-page runs) unaddressed: that is
  a WAF fight, not a planning defect, and the honest ask is battery-sanctioned there.

## Failed attempts / instrument notes

- First per-mission reward assertion (≤3× ceiling per mission) was too tight: the balancer's
  exact-divisor search legitimately exceeds it. Hand-computed the divisors, loosened to an
  absolute "never absurd" bound, and moved tightness to the single-mission case (exact ceiling).
- `datetime('now')` vs unix-seconds `created_at` made my first recency query silently match
  nothing; and a `cmd | tail` pipe made the failed full-suite run read as exit 0 (the brief's
  own trap) — the vault failure surfaced only in the text.

## Re-run after deploy (the other session)

1. `node scripts/mission-eval-matrix.mjs --base https://sagepays.xyz --nonce 10` (10 is unburned;
   avoid 0-9, 11-14, 26, 27, 31, 37, 38, 41, 77). Expect: anchors 100% hard stop; over-funded
   rows now `ready` with "stays with you" instead of the fair-rate warning; per-tester rewards at
   ceilings.
2. A clawup.org launch with the credits goal from a founder identity: expect the plan to include
   the deterministic `gated-payment` mission anchored on the pricing doorway.
3. `npx vitest run` on the VM (the vault test needs the operator key).
4. Watch `distinct_sources` on newly pinned corpora (key caps grew): expect more matchable
   sources for narrative accounts, no bar change.
