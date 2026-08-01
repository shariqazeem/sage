# HANDOFF-4 — the ruler was broken, and the explorer learned to navigate (2026-08-01)

Two things in this round: the definitive diagnosis of your round-3 anchor failure (it was the
measurement, not the plumbing — reland included), and the engineering round the founder's own
commonstack.ai run demanded (the explorer could not navigate a client-rendered product at all).
Nine repo files modified, uncommitted; extract in sync.

## 1. Round 3 was correct — the battery's ruler was stale. Fix your memory entry.

`scripts/mission-eval-matrix.mjs` `rebuildCorpus` is a hand-copied mirror of
`buildObservationCorpus`, and it was never taught round 3's new field: it pushes
`s.visibleTextExcerpt` for STATES but not `p.visibleTextExcerpt` for PAGES. Round 3 let the
architect see page text and legitimately anchor on it; the in-process gate validated those anchors
against the REAL corpus (which has the excerpts); the battery then re-checked them against its own
stale mirror and reported 0–50%. The failures spanning both modes fits exactly: interactive
summaries also carry pages (crawlPagesForUrlEvidence captures excerpts too).

Your memory hypothesis ("anchor validation matches whole entries rather than substrings") is
**disproven by the script's own line 98**: `corpus.includes(x)` — substring matching over the joined
blob, identical to production `anchorIssues`. No splitLines change is needed anywhere. Please
correct the memory entry — the wrong hypothesis would send the next investigation down a dead end.

Fixed: `rebuildCorpus` now pushes `p.visibleTextExcerpt`, with a drift-warning comment pointing at
`buildObservationCorpus` (this mirror failing silently cost a full battery run + a revert).

## 2. Round 3 relanded byte-identical

The 7 files from `f96880f` are back in the working tree unchanged (my extract still held them):
static crawls carry page excerpts into the corpus / private key / richness / architect view, and the
passive-outcome demotion is re-armed. Everything HANDOFF-3 said still applies — including the
narrow-revert instruction, which is now actually reachable since the ruler measures honestly.

## 3. The commonstack run — three defects, three fixes (`field-test.ts`, `browser-controller.ts`)

The founder ran commonstack.ai on prod. Trace: Sage typed "test" into the site's SEARCH box and
submitted ("No options"), then three clicks read "attempted click (no effect)", six states all on
the homepage, key pinned entirely from homepage variants, missions about a Playground it never saw.
Three general defects, each fixed generally:

- **A search box is not a wizard step.** `hasEmptySafeField` counted the global nav search field as
  "a form to complete", so the wizard-first rule hijacked the opening turns of ANY product with site
  search. Search-classified fields now count only when the goal itself asks for search (new pure
  `goalWantsSearch`). The real wizard fix is untouched — genuine forms still fill before advancing.
  `completeConversation` likewise prefers a field whose own classification is `ai_probe` over "first
  typable thing" — a chat goal can never type its probe into site search.
- **A client-rendered product's map exists only in its rendered DOM.** `candidatePaths` came only
  from static HTML, so on an SPA the explorer had literally nowhere to go (`open_path` had an empty
  offer list; Playground/Model Library/Docs sat in the header). The explorer now maintains
  `livePaths` — same-site links harvested from the live DOM every turn (bounded: 12/harvest, 20
  total, logout/asset paths excluded), seeded by the static list. The churn exit, the controller's
  offer list, and visited-tracking all run over it.
- **The goal knows where to go.** New deterministic step 0a: when the current checkpoint names
  something not clickable on this screen but a discovered path matches it (link label or slug —
  "Playground" → /playground), Sage opens that path directly — before burning six entry states.
  Fires only as a fallback to an on-screen match, only within the navigation budget, only over paths
  Sage itself read (new pure `chooseGoalPath` in browser-controller; the model composes nothing).
- **Clicks survive React.** The dead clicks were re-renders stripping `data-sage-eid` between mint
  and click (plus an open dropdown swallowing hits). `executeAction` click now recovers in order:
  re-resolve by minted label (role/text locator survives re-renders) → for links, follow the
  element's own Sage-read same-site `href` (new `MintedElement.href`, path-only, never
  model-authored) → honest "no effect". A recovered-by-href click counts against the navigation
  budget and marks the destination visited, so the fallback can never out-travel `open_path`.

Probed: goal "use the AI playground" → terms match the Playground link/path three independent ways;
`goalWantsSearch` false for it, true for "users can search for models"; visited-set respected;
no-terms → null.

## Files changed (9 in the repo tree)

| file | change |
| --- | --- |
| `scripts/mission-eval-matrix.mjs` | mirror pushes p.visibleTextExcerpt + drift warning (§1) |
| 7 round-3 files | relanded byte-identical (§2) |
| `src/lib/launch/field-test.ts` | (on top of reland) search discipline, livePaths, goal-path step, resilient clicks (§3) |
| `src/lib/launch/browser-controller.ts` | MintedElement.href, chooseGoalPath, goalWantsSearch (§3) |

Frozen layers, your advisory-contract wiring, your proof work: untouched.

## Gates + the acceptance test that matters

1. Suite + red-team as usual. Consider unit tests for `chooseGoalPath` / `goalWantsSearch` /
   the demotion (still untested) — all pure.
2. **P-GEN battery with the fixed ruler.** Bar: **11/11 ready AND anchors 100%**. Expected:
   plausible + portfolio `static` with url missions; allbirds/cnn/static-landing `static` WITH
   plans; interactive categories unchanged.
3. **The founder's own acceptance test: re-run commonstack.ai.** Expect: no search-box submission;
   states on /playground and /models (via the header links or harvested paths); the key spanning
   multiple pages, not six homepage variants; missions about the playground backed by playground
   observations. That inspection — not the battery — is what "works on any product" looks like to
   the founder, so screenshot the trail for him.
4. If the battery still shows sub-100 anchors anywhere, the reland is NOT automatically at fault:
   check the category against the mirror first (the lesson of round 3 — validate the ruler before
   reverting the work).
