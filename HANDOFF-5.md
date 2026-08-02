# HANDOFF-5 — budget intelligence + the explorer stops looping (2026-08-02)

Driven by the founder's two fresh runs. commonstack.ai round two was a big win (15 states, real
playground use) but exposed three systemic classes; sagepays.xyz exposed a fourth. Five repo files
modified, uncommitted; extract in sync (sample-policy.ts is now included in the extract too).

## 1. Budget intelligence — `sample-policy.ts`, both `applySamplePolicy` call sites, `mission-brain.ts`

The founder's $10 became **1 mission × 2 testers × $5.00 for ~5-minute work**. Two stacked causes,
both fixed:

- **Effort-anchored reward ceiling** (`sample-policy.ts`). The policy reasoned only about sample
  size (prefer 3) and the $0.10 floor — never what a completion is WORTH. $10 didn't divide by 3, so
  the exact-split fallback gave 2 × $5. New: a completion's fair ceiling is `effortMinutes × $0.20`
  (never below the floor); when a mission's pot pays past it, the target sample grows
  (`max(preferred, pot ÷ ceiling)`, hard cap 50). Probed on the exact case: **$10/5-min → 10 testers
  × $1.00**. Missions without `effortMinutes` keep the old behavior byte-identical (no test file
  pins this module; both call sites now pass `effortMinutes`). The overpay cap applies to every
  qualitative mission, plural wording or not; url-verifiable missions untouched; the
  exact-allocation invariant untouched (splitCompletionsForSample mechanics unchanged).
- **Mission count vs budget** (`mission-brain.ts`). The url-floor corrective round is now a combined
  PLAN-SHAPE round: it also fires when the budget comfortably funds more distinct missions than
  survived (≥$3 per mission heuristic, asks capped into the 3-6 design band), asking the architect
  to ADD missions testing DIFFERENT observed parts. Still ONE bounded round, adopted only when it
  strictly improves (more accepted, url mission gained when asked, never fewer).

## 2. The explorer stops looping — `field-test.ts`

commonstack's trace ran the whole fill→submit→login-bounce cycle TWICE; sagepays retried its wizard
steps to exhaustion. Three general fixes:

- **Cycle detection by state identity.** Same-URL churn was already capped, but a multi-screen cycle
  resets that counter on every hop. A state DIGEST recurring is the loop itself: 3rd recurrence
  retires the screen's controls, 4th ends the run honestly (`stop:cycle`).
- **Auth-wall recognition.** A password field on a non-entry screen means the last move crossed into
  gated territory. Deterministic response: retire the move that led there, mark the gated route
  visited, step back once, and stop honestly after 3 distinct walls — the journey wall then words it
  as the access boundary it is. An entry page that IS a login (web.telegram.org) is exempt, so the
  login-wall battery category keeps its states.
- **A validation error is not a result.** `completeForm` labeled any post-submit change "observed
  the result", so an error screen credited outcome checkpoints and read as progress — the sagepays
  budget-step loop. Same-URL + validation wording now captures as "the form showed a validation
  error" (kind `wait`, which credits nothing) and returns `submitted`, not `result`.

## 3. Journey credit + url evidence for SPAs — `field-test.ts`

- **`open_path` was invisible to the journey.** `actionKindOf` fell through to `wait` and no
  actedLabel was recorded, so "Navigate to the AI playground interface" went uncredited even though
  Sage OPENED /playground. Now: kind `click` (it is the programmatic click of a link) with the path
  as `actedLabel`, so `containsAny("/playground", "playground")` completes the checkpoint.
- **Discovered paths feed the url-evidence crawl.** `crawlPagesForUrlEvidence` only ever saw
  static-HTML links — empty on client-rendered products, which is why interactive SPA plans have no
  readable pages and no url-verifiable missions. The explorer now hands its DOM-harvested `livePaths`
  out (`discoveredPathsOut`), absolutized and merged into the crawl (still bounded to 3 pages).
  Combined with the excerpt plumbing, an SPA now gets: url missions, richer corpus, richer key.

## 4. Surface consistency — verified, no change needed

Web agent tab (`/api/agent` → `runConciergeWeb`) and Telegram (`webhook` → `runConcierge`) share ONE
`runAgentTurn` engine, one prompt set, one tool registry; inspections all flow through the one
`/api/launch` pipeline; failure copy is the same `friendlyFailure` on the web plan page and the
Telegram notice. Consistency across surfaces is architectural. The only per-surface deltas are
deliberate (money tools absent on web; push notices absent on web).

## Files changed (5)

| file | change |
| --- | --- |
| `src/lib/launch/sample-policy.ts` | effort-anchored ceiling + fair-sample targeting (§1) |
| `src/lib/launch/pipeline.ts` | pass effortMinutes into the sample policy (§1) |
| `src/lib/launch/mission-grounding-shadow.ts` | same (§1) |
| `src/lib/launch/mission-brain.ts` | plan-shape corrective round (count + url floor) (§1) |
| `src/lib/launch/field-test.ts` | cycle guard, auth walls, error labeling, open_path credit, discovered-path crawl (§2, §3) |

Frozen layers untouched (`allocateBudget` unmodified — all budget shaping happens in the sample
policy layer above it, and the exactness invariant is preserved by the unchanged split mechanics).

## Gates + acceptance

1. Suite + red-team. Worth adding: a sample-policy test file pinning the probed cases ($10/5min→10×$1,
   no-effort→3, cap 50→3, url untouched) — the module had NO tests, which is how 2×$5 shipped.
2. P-GEN battery: bar stays **anchors 100%**, ≥10/11 ready. Watch `login-wall` specifically — the
   auth-wall guard must not reduce its states (entry-login exemption covers it, but verify).
3. Founder acceptance re-runs:
   - **commonstack.ai, $10**: expect several missions (plan-shape round), fair per-tester rewards
     (~$0.50–$1.50, not $5), one url-verifiable mission (discovered-path crawl), no repeated
     fill→submit→login cycle (cycle guard + auth wall), and the playground-navigation checkpoints
     CREDITED (open_path labeling) so the "did not complete" wall shrinks to just the truly gated
     execute step.
   - **sagepays.xyz**: expect the wizard to stop at the budget step's validation honestly (no 3-5×
     retry), and a plan covering the observed journey instead of the generic canary_blocked ask.
4. Watch LLM cost per inspection: the plan-shape round adds ≤1 architect+critic call; cycle/wall
   guards REDUCE wasted controller calls, so net cost should be flat or lower.
