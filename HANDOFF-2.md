# HANDOFF-2 — the autonomy round (2026-08-01)

For the implementing session. Unlike round 1, the changes are **already applied to the repo working
tree** (`/projects/SAGE`, 9 files modified, uncommitted) as well as to this extract — I verified the
extract and repo were byte-identical for every agent file before starting, so the copies are exact.
Your job: `git diff`, verify, run the gates, commit, deploy. Nothing frozen was touched, and your two
post-round-1 additions (the proof-receipt builder + the two test updates) are untouched.

Round 1 made the agent generalize. This round makes it autonomous end to end: a founder needs only a
URL + budget, content sites keep their auto-payable missions (your P-GEN flag), every observation
mission is judged per-criterion rather than by the flat count, and testers can write evidence in any
language. Nine files, six changes.

---

## 1. Your P-GEN flag, root-caused and fixed — `goal-journey.ts`, `mission-brain.ts`

You flagged: 4 categories drifted `interactive`, and plausible.io + brittanychiang.com lost their
url-verifiable mission. Root cause found: the battery sends ONE goal for every product — "Validate
the core experience for a first-time user". `goalRequiresUse` correctly returns false for those
WORDS (your own pinned test, `goal-requires-use.test.ts:54`), but the journey compiler labels the
final checkpoint of almost any request `outcome`, and a bare `outcome` checkpoint forces exploration
(also pinned, line 73–77). So the drift arrives via the journey, not the words — and it predates
round 1; the UA/same-site fixes just made those products reachable enough to show it.

Fix, two layers, both respecting your pinned tests:

- **Passive-outcome demotion** (`compileJourneyFromRaw`): a new `PRODUCING_OUTCOME` regex keeps
  `outcome` only when the checkpoint's requirement/sourcePhrase names something the user PRODUCES or
  RECEIVES (create/export/submit/reply/response/confirmation/purchase/…). A passive confirmation
  ("the core experience is validated") demotes to `experience` — still required by the coverage gate
  (`outcomeCheckpoints` falls back to the last checkpoint), but no longer forcing USE. Verified
  against every repo fixture that compiles an `outcome`: "Observe the response", "Reply", "See the
  reply", "The exported report is produced" all KEEP their kind. The direct-fixture tests
  (`journey([outcome]) → true`) are untouched — they bypass compile by construction. A matching
  teaching line was added to `JOURNEY_SYSTEM`.
- **URL-mission floor** (`mission-brain.ts`): after acceptance, if the plan has ≥1 accepted mission,
  ZERO url-verifiable ones, and ≥2 readable pages (static + field-test crawl), ONE bounded corrective
  architect round asks to ADD a url-verifiable mission (reach page + quote text). The new set is
  adopted only if it gains a url mission **without shrinking** the plan. The deterministic gate still
  judges everything; products with no readable pages are untouched.

## 2. Zero-input launches — `launch/pipeline.ts`, `telegram/concierge.ts`

A founder who gives only URL + budget now gets a real plan. `isThinGoal` (empty, <12 chars, or a
generic "test my site" shape) swaps in `DEFAULT_FIRST_VISIT_GOAL` — a **fixed string containing no
observed product text** (composing it from page content would inject untrusted text into the
architect's TRUSTED goal line, so it deliberately doesn't). It names no producing verb, so content
sites keep their crawl + url missions; real apps still classify interactive from their own signals.
The map gains one transparency line ("No specific goal was given, so Sage planned for a first-time
visitor's primary flow…").

The concierge prompt now forbids the model from INVENTING goals ("test the core functionality") and
tells it to pass `goal: ""` when the founder stated none — an invented generic goal would defeat
`isThinGoal` and steer missions the founder never asked for. Watch for this in Telegram dogfooding:
if plans still show fabricated goals, the model is ignoring the instruction and the fix is to also
apply `isThinGoal` in the `sage_start_inspection` handler (I kept it pipeline-side to cover web too).

## 3. Universal criterion contracts — `observation-verify.ts`, `deputy/pipeline.ts`

The "judge whether they really did the mission, not whether they hit a number" change. Only
compiler-authored missions carried a `criterionEvidence` contract; everything else fell to the flat
≥3 bar. New pure `deriveCriterionEvidence(key, criteria, evidenceRequirements)`: each criterion
reduces to its distinctive content tokens (≥4 chars so entity names like "Yara" map; a generic-word
set filters filler), and a key source backs the criterion when one of its PRIVATE observations
carries such a token at a word start. `deputy/pipeline.ts` uses it as a fallback when no stored
contract exists (stored contracts always win; an empty derivation degrades to the flat bar).

Consequences: per-criterion judgment + the criteria-complete pass + per-criterion coaching now apply
to EVERY observation mission. The mapping only decides WHICH screens prove WHAT — the tester still
has to match private observations inside the slice, so nothing about proof strength is weakened. A
criterion that maps to nothing is UNPROVABLE (design gap, never blocks the tester, never arms the
pass — `allProven` requires ≥1 provable criterion). Deterministic given (key, criteria), so verdict
reuse is sound; **`OBS_BAR_POLICY_VERSION` bumped to `obs-bar-v3-derived-contracts`**, which
re-judges every stored verdict once under the new policy (that's intended — it's how held-but-now-
passing submissions release).

Probed end-to-end in isolation: genuine paraphrased account (1 deterministic match + 1 validated
corroboration) → all criteria proven, 2 distinct → PASS; generic guesser → 0 matches, nothing
proven → HOLD; all-unprovable contract → flat bar, no relaxation.

## 4. Any-language evidence — `observation-verify.ts`, `observation-judge.ts`

`normObs` used ASCII `\w`, so an account written in Urdu/Hindi/Arabic/Chinese normalized to
**nothing**: 0 content words, never even reached the LLM judge, held every time. Now unicode-aware
(`\p{L}\p{N}` with the `u` flag); English normalization is byte-identical for ASCII text. The judge
prompt gains a LANGUAGE paragraph: bridge by meaning, quote each side verbatim in its own script,
never penalize the language. (The verbatim-pair validation already works cross-script — the
account-side quote is a substring of the account regardless of language, and non-Latin tokens are
by construction non-public.) Stored English keys are unaffected.

## 5. Browsing hardening — `field-test.ts`

- **Challenge patience**: `looksLikeChallenge` (thin text + "Just a moment / Checking your browser /
  Verify you are human/…") → wait 6s, reload once, continue with whatever lands. Turns
  challenge-fronted-but-public products from a dead screen into a real run; a hard block degrades
  exactly as before.
- **Entry retry**: one retry (2s apart) on a failed entry `goto` — a transient network flake used to
  zero the whole field test.
- **Consent variants**: "accept all", "allow all", "accept cookies", "i agree" added (EU-pattern
  banners), most-specific first.

## 6. Evidence questions as questions — `mission-prompt.ts`

New rule 6b in `ARCHITECT_SYSTEM`: each `evidenceRequirement` is written as a DIRECT product-specific
question ("Which plan names appear on the pricing page?", "What did the character say when you
greeted it?") because each becomes one field of the tester's submission form (`evidencePrompts`).
Specific questions produce the specific first-hand answers the bar pays; 2–4 per mission, in
encounter order. **`MISSION_PROMPT_VERSION` bumped `mb-v1` → `mb-v2`** (recorded on plans; nothing
pins the constant — the one integration fixture supplies its own string).

---

## Files changed (9, applied in BOTH the extract and the repo working tree)

| file | change |
| --- | --- |
| `src/lib/launch/goal-journey.ts` | PRODUCING_OUTCOME demotion + JOURNEY_SYSTEM line (§1) |
| `src/lib/launch/mission-brain.ts` | url-mission floor corrective round (§1) |
| `src/lib/launch/pipeline.ts` | isThinGoal + DEFAULT_FIRST_VISIT_GOAL + map note (§2) |
| `src/lib/telegram/concierge.ts` | never-invent-a-goal prompt rule (§2) |
| `src/lib/deputy/observation-verify.ts` | unicode normObs, deriveCriterionEvidence, policy → v3 (§3, §4) |
| `src/lib/deputy/pipeline.ts` | derived-contract fallback wiring (§3) |
| `src/lib/deputy/observation-judge.ts` | LANGUAGE paragraph in the judge prompt (§4) |
| `src/lib/launch/field-test.ts` | challenge patience, entry retry, consent variants (§5) |
| `src/lib/launch/mission-prompt.ts` | rule 6b + version mb-v2 (§6) |

## Invariants (checked)

Frozen layers byte-identical (brain-core, autopilot, budget, vault/settlement/permit, mandate). No
model output reaches money without deterministic code: the derived contract is pure arithmetic over
the pinned key; the judge still only bridges via validated verbatim pairs; the url-mission floor only
re-runs the same architect→critic→gate chain. No corpus oracle: the derivation is server-side; the
public view still carries counts + indexes only. Zero-input goals are a fixed trusted string — never
composed from observed text (injection channel deliberately avoided). Map digests unchanged.

## Gates to run

1. `lint` + `typecheck` + `test` — expect green; the demotion was verified against every repo fixture
   that compiles an `outcome` checkpoint, and `goal-requires-use.test.ts` is untouched by design.
2. **P-GEN battery** (mandatory: inspection + field test + mission brain + prompts changed). Expect:
   anchor integrity 100%; `saas-marketing` (plausible) and `portfolio` (brittanychiang) back to
   `static` with a url-verifiable mission; `docs`/`static-landing` url missions intact; interactive
   categories (2048, yara, excalidraw) unchanged.
3. Live red-team once (payout prompt/parser untouched — `APPROVED_IDENTITIES` stays valid).
4. Worth adding while you're in there: a unit test for `deriveCriterionEvidence` + one for the
   passive-outcome demotion (I kept new tests out to avoid colliding with your test layout).

## Operational switches (unchanged but worth restating)

`OBSERVATION_AUTOPAY=1` releases verified observation work; `DEPUTY_AUTOPILOT_MAINNET` arms the url
lane on GOAT; `OBS_JUDGE_MODEL` should point at a strong multimodal-capable judge for the
corroboration recall path; `VISION_MODEL` must be multimodal or the browser controller falls back to
text-only decisions (round 1 made that graceful instead of fatal).
