# HANDOFF-3 — the open defect, closed (2026-08-01)

Round 3 does exactly one thing: fixes the defect you diagnosed — **"a static field-test crawl should
contribute observations when static inspection yields none"** — and then re-arms the passive-outcome
demotion behind it, per the re-arm note you left in the code. Both of your round-2 interventions are
preserved: I built ON TOP of your advisory-contract wiring and your revert (extract was re-synced to
your committed state first, including `derived-contract.test.ts`). Changes are applied to the repo
working tree (7 files, uncommitted) and the extract.

## The fix — static crawls now carry the page's rendered text

`FieldTestPage` (and the internal capture) gain an optional `visibleTextExcerpt` — the same
bounded, line-preserving `renderedExcerpt` the interactive states already use — captured at all
three static capture sites (entry page, per-target crawl, `crawlPagesForUrlEvidence`). It then
threads into every consumer that was starving:

- **`buildObservationCorpus`** (`validate-mission.ts`) — anchors can now come from page text, so the
  architect's missions survive the anchor gate on a bot-walled product.
- **`distillPrivateKey`** (`observation-verify.ts`) — each crawled page becomes a real SOURCE of
  private observations. Probed on a 6-page allbirds-shaped fixture: key went from **1 distinct
  source (thin_corpus, founder-only)** to **6 sources / 11 observations — autopay-eligible**.
- **`gatherRichness` + the entry-screen sufficiency question** (`mission-brain.ts`) — field-test
  pages count as inspected pages, so 0-static/6-crawled no longer reads "insufficient observation".
- **`fieldTestForMap`** (`field-test.ts`) — static pages carry their excerpt (500 chars) to the
  architect; and the **interactive branch now also carries up to 4 crawled pages**. That last part
  matters beyond this fix: it's the missing half of your original url-mission flag — interactive
  products crawl pages for url evidence but the architect never SAW them, which is why interactive
  plans drifted observation-only. Now the url-mission floor has real page text to work with.
- **`mission-prompt.ts`** — the fieldTest guidance line describes both additions.

## The re-arm — `goal-journey.ts`

Your dormant block is armed again: `let kind` + the demotion + the JOURNEY_SYSTEM line restored, the
eslint-disable removed, and your measurement history kept in the comment (now marked HISTORY, with
the round-3 enabling fix described and an explicit revert instruction if the battery disagrees:
revert the demotion block only — the excerpt plumbing is independently correct and stays).

Probed on the synced file: passive outcome → `experience` (requiresUse false for the battery goal);
"The exported report is produced" / "Observe the response" / "Reply" all keep `outcome`. Your
advisory-contract semantics were probed post-edit and are intact: compiler contract blocks on
unproven, advisory never blocks, advisory still arms the 2-match criteria-complete pass.

## Files changed (7)

| file | change |
| --- | --- |
| `src/lib/launch/schemas.ts` | `FieldTestPage.visibleTextExcerpt?` |
| `src/lib/launch/field-test.ts` | capture excerpts ×3 sites; summary passthrough; fieldTestForMap static excerpt + interactive pages |
| `src/lib/launch/validate-mission.ts` | corpus includes page excerpts |
| `src/lib/deputy/observation-verify.ts` | key distillation includes page excerpts |
| `src/lib/launch/mission-brain.ts` | richness counts ft pages; entry-screen question fixed |
| `src/lib/launch/mission-prompt.ts` | fieldTest guidance line |
| `src/lib/launch/goal-journey.ts` | demotion re-armed + prompt line restored |

Untouched: your advisory wiring (`deputy/pipeline.ts`, `observation-judge.ts` — synced from your
commit, no further edits), all frozen layers, your proof work, your tests.

## The gate — and the per-category expectations to hold it against

P-GEN battery is mandatory (inspection + field test + mission brain + prompts + journey). This time
the bar is **11/11 ready**, with these specific expectations:

| category | expected |
| --- | --- |
| `saas-marketing` (plausible), `portfolio` (brittanychiang) | `static` + a url-verifiable mission (the demotion's win, now regression-free) |
| `ecommerce` (allbirds), `heavy-slow` (cnn), `static-landing` | **`static` this time, WITH a plan** — url missions anchored on page excerpts; the key eligible for observation missions |
| `login-wall` (telegram) | ready (login page text now in corpus) — needs_input is acceptable only if the crawl truly saw one thin page |
| `docs`, `non-english` | ready, unchanged or better |
| `spa-app` (excalidraw), `canvas-game` (2048), `dom-world` (yara) | interactive, unchanged — signals, not goals, classify them |

If any category regresses vs round 1: revert ONLY the demotion block in `goal-journey.ts` (your
revert commit is the template) and keep everything else — the excerpt plumbing improves bot-walled
static products regardless of how classification falls.

Also run: full suite (your 13 derived-contract tests must stay green — probed, but tests are the
authority), red-team (payout prompt/parser untouched), and one look at prompt size on a text-heavy
product (6 excerpts × ~900 chars ≈ 5KB into a 24KB-capped map view — bounded, but eyes on it).
