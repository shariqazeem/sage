# Sage Agentic V2 — Final Build Plan (converged)

> The plan we execute. Synthesized from three frontier reviews (Fable 5, GPT 5.6 Sol, GLM 5.2)
> + a Fable-5 coordination pass that read the as-built spec and verified the code seams, + Opus's
> cost-discipline. Goal: make Sage **$50k-trustworthy** and a **Telegram-primary** autonomous
> operator, cheaply, in the Stage-2 window (Jul 23 → Aug 26), **without loosening a single §2
> invariant.**
>
> **The thesis in one line:** *Other agents read the work. Sage re-does it before paying.* Every
> week ships one sentence of that story.

---

## 0. The decisions that were contested — and how they resolved

| Question | Verdict | Why |
| --- | --- | --- |
| Model tier | **Haiku 4.5 everywhere**; Sonnet-tier only as an eval-gated escalation for the mission architect on big campaigns | Cost-disciplined per the founder; Haiku already proved it fixes the money brains. Sonnet-everywhere (GPT) rejected. |
| Order: models-first vs capture-first | **One motion** — the biggest lever (vision flash-lite→Haiku) is *both* a model flip and better capture. Ship it W1 behind an eval battery. | The debate was false; they converge. |
| Replay: full vs lean | **LEAN** — rendered fetch + a small typed probe set + a URL-lane hard-probe pass, shadow→subtract-only | GPT's contract-compiler + state-graph is a research program; in 4 weeks it ships half-done. |
| Screenshots | **OUT** | Replay is a strictly stronger version of the same fact; don't ship a weaker, doctorable channel or spend the infra exception on it. |
| Image-generation models (gpt-image-2) | **OUT — not needed** | That's image *generation*. Vision = image *understanding*, which multimodal text models (Haiku 4.5) already do. |

### 0.1 Amendments after a second adversarial review (GPT 5.6 Sol) — folded in

All verified against code and adopted:

1. **Probes cannot "ride the snapshot with no migration" — CODE-CONFIRMED.** `attach/route.ts:60-78`
   maps mission fields *explicitly* into `V2MissionSetupInput` (no probe field), and payout
   reconstructs the mission from the persisted row via `getMissionByHash` — **not** the plan
   revision. An unmapped `probes` field is silently dropped before the money path. → **Probes are
   pure shadow/demo telemetry this cycle** (logged, never gate money). Payout-gating replay waits
   for a durable `VerificationContractV1`: persisted, a separate `verificationPolicyDigest` bound to
   the founder-approved plan, locked at activation, retrieved at payout — a decision deferred until a
   single narrow migration is approved.
2. **"Subtract-only" was imprecise** → see §6. New vetoes are subtract-only; **model/capture changes
   are non-monotonic** and need shadow→promotion-criteria→rollback-flag.
3. **An unproven model must not autopay** — including the fallback. Autopay requires the judging
   model be on an **approved-model allowlist** (passed P-JUDGE + live red-team). A fallback/unproven
   model → **review-only**, never autopay.
4. **Replay proves "independently reproducible," not "this tester did it."** Frame it honestly;
   design toward probe-pass as a **necessary-but-not-sufficient** autopay conjunct for qualified
   mission classes; submission-bound **freshness/nonce** is the real provenance answer (product-
   dependent, later).
5. **Entailment is a semantic model *veto*, not "positive deterministic verification."** Rich
   auditable structured output (`criterionId`, `entails: yes|no|uncertain`, exact quote + evidence
   span, reason, model+prompt version); **both `no` AND `uncertain` → review**; a malformed/truncated
   result **fails closed**, never `repairJson`'d into a money decision.
6. **Cut `testerPhrasings` entirely** (existing semantic-corroboration already bridges phrasing;
   predicted language only helps guessers — revisit only if labeled data shows a recall gap).
   **Drop the arbitrary "reward ≥ $5 → 4 sources"** — use a principled **rare-source** requirement
   (≥1 matched source must be a low-frequency observation) instead of a dollar threshold.
7. **Probe error taxonomy**: separate `claim_contradicted` (counts against the tester → hard fail)
   from `product_drift` / `probe_flake` / `infra_failure` (retry → hold, never punish the tester).
   Don't rely on `networkidle` alone (SPAs never idle). Use **deterministic locators** (accessibility
   role + exact accessible name), not free-text targets. **Bounded concurrency + backpressure/queue**
   (concurrency-1 × 60s = 100 min for 100 submissions).
8. **P-JUDGE is the bigger battery with corrected metrics**, already built (`scripts/judge-eval.mjs`
   + `judge-fixtures.json`): **wrong-autopay is the catastrophic zero-tolerance hard stop**; "every
   genuine fixture must autopay" is NOT a hard stop (weak-but-genuine evidence *should* review).

Not adopted as-stated: GPT's `VerificationContractV1` **with** a schema migration (you locked the
schema) — so probes stay shadow-only until you approve that one migration. GPT's timeline is set
aside per your instruction (you track it).

---

## 1. Model routing (final — middle-ground, cost-disciplined)

Per-role env vars already exist; this is mostly config, not code.

| Slot | Env | Model | Notes |
| --- | --- | --- | --- |
| **URL payout judge** | `LLM_MODEL`/`DEPUTY_MODEL` | **claude-haiku-4-5** | The "weakest model on the money call" fix. **Must re-run the LIVE red-team** (`scripts/redteam-brain.mjs`) — jailbreak resistance is model-dependent; the CI suite only proves the deterministic layers. |
| Payout fallback | `LLM_FALLBACK_MODEL` | deepseek-v4-flash | Cross-family outage diversity; heuristic floor unchanged. |
| **Vision** | `VISION_MODEL` | **claude-haiku-4-5**, `MAX_IMAGES` 6→8 | The corpus ceiling → the ceiling on missions + judging. Biggest single lever. |
| Product-map synth | (rides `LLM_MODEL`) | haiku-4-5 | Free upgrade via the shared chain. |
| **Mission architect** | `MISSION_MODEL` | **haiku-4-5 default** | See escalation below. |
| Architect escalation | **new `MISSION_MODEL_STRONG`** | a Sonnet-tier model — **OPTIONAL, eval-gated** | Used only (a) on the corrective round after 0 accepted, and (b) for campaigns with budget ≥ $1,000. **Default off**: turn it on only if the W1 P-GEN bake-off shows Haiku materially under-designs $50k missions. ~10 lines in `missionModel()`; budget-conditional routing is deterministic config, not a model computing money. |
| Mission critic | **new `CRITIC_MODEL`** | a different family (Gemini non-lite, else deepseek) | Adversarial diversity — an architect shouldn't review itself. Evidence-gated: critic parse-failure > 10% on P-GEN → fall back to Haiku (competence beats diversity). |
| Observation judge | `OBS_JUDGE_MODEL` | haiku-4-5 (keep) | Empirically 6/6. |
| Concierge | `CONCIERGE_MODEL` | haiku-4-5 (keep) **+ failover added** | Telegram-primary needs reliability, not IQ. |
| NEW entailment check | (haiku-4-5) | ~10 max_tokens, downgrade-only | Pennies. |
| NEW injection classifier | (haiku-4-5) | downgrade-only, multilingual | Fires only when the regex detector didn't. |

**Cost reality (nobody had priced it):** a full inspect + judge cycle on Haiku ≈ **under $2 per
100-submission campaign**; the optional Sonnet escalation adds ~$0.10 once. So cost was never the
real constraint — the honest reason for Haiku-everywhere is **proven adequacy + ops simplicity**,
which also means upgrading any single slot later is guilt-free if an eval demands it. **Image-gen
models stay out.** Optional micro-opt: cache the vision/map-synthesis response keyed on the
ProductMap digest + prompt version (re-inspecting the same product is free).

---

## 2. The four-week build (5th week is buffer, not build)

### Week 1 (Jul 23–29) — "The money call runs on a proven brain." Measured brain transplant.
- **P-JUDGE battery** (the missing payout-brain eval, mirroring P-GEN): fixtures — genuine-rich /
  genuine-terse / spam / direct + paraphrased + **Spanish** injection / eloquent-note-thin-evidence
  / unfetchable-evidence — each with an expected gate outcome. Seeded from the existing red-team +
  observation fixtures, so it's small. **Hard-stop on any genuine-fixture regression or any
  attack-fixture pay.** _(S/H, $0)_
- **Flip the models** per §1; baseline flash-lite on P-JUDGE, flip, re-measure. _(S/H)_
- **Re-run the batteries**: **live red-team** (`redteam-brain.mjs`, both providers) + P-GEN (anchors
  100%) + obs live tests. _(gate)_
- **Architect bake-off** on P-GEN (Haiku vs Sonnet) → decide whether `MISSION_MODEL_STRONG` is worth
  arming. _(S/M)_
- **Strict JSON-Schema structured outputs** on the non-judgment path (where CommonStack + the model
  support it), keeping `repairJson` as fallback. Also lowers architect temperature / adds a seed if
  honored → **cuts mission-count run-to-run variance** (a $50k-trust issue). _(S/M)_
- **The one frozen-file edit** — close `detectInjection`'s 0.85–0.89 confidence-band regex gap —
  **bundled into the red-team re-run we already owe** for the model flip (one re-validation event,
  two hardenings). _(S/M)_

### Week 2 (Jul 30–Aug 5) — "Sage re-fetches reality itself."
- **Rendered evidence fetch** in the URL lane: in `fetchEvidence`, static-first; on thin (<600
  chars) or a JS-only signature → **guarded Playwright render** (reuse the field-test
  `requestGuard` interceptor **verbatim** — the evidence URL is attacker-controlled, so this is an
  adversarial browser: SSRF pivots, downloads, service workers must all be blocked; no persistence,
  hard time caps) → innerText → same `EvidenceResult`. **brain-core untouched**; flag
  `RENDERED_EVIDENCE=1`. _Fixes the single biggest genuine-evidence-holds failure in the URL lane._
  _(M/H)_
- **Passive probes v1** (`url_reached`, `text_present`): the probe schema + gate check #12 + the
  executor (§3), **shadow-logged only**. _(M/H)_
- **Entailment check**: per met-criterion-with-quote, a Haiku YES/NO "does this quote satisfy this
  criterion?"; NO → force **review**. Implemented as a pipeline post-step (like the wallet-freshness
  append) — **no brief mutation, no frozen file touched**, shadow first. The positive deterministic
  check §5.8 says is missing. _(S/M-H)_
- End of week: arm both **downgrade-only** (probe hard-fail → retryable hold; entailment NO →
  review) after shadow on self-test campaigns.

### Week 3 (Aug 6–12) — "Sage replays the mission; the concierge holds the thread."
- **Action probes** (`text_after_action`): one per mission, whitelist verbs, reusing the field-test
  interactive machinery; flake telemetry; shadow → arm fail→hold. _(M-L/H)_
- **Concierge autonomy pack** — deterministic **session-state line** (persist the active
  `inspectionId`/`campaignId` in the existing per-chat memory JSON, inject as a fresh system line
  each turn → kills the "lost the thread after 12 turns" failure deterministically, no summarizer
  needed for the common case) + a rolling summary of evicted turns + **failover mirroring
  `brain.ts`** + `MAX_TOOL_ROUNDS` 5→8 + `max_tokens` 900→1200 + extend `concierge-web.test.ts`.
  _(M/H — the Telegram-primary payoff.)_
- **Vision v2, lean + guarded**: add action→outcome observation fields grounded in the field test's
  real trigger→state transitions. **`testerPhrasings` is DEMOTED from flagship to a guarded
  optimization** (see §5) — tagged `derived` in the corpus, ≤3/state, must carry ≥1 state-specific
  token, and the bar gains a composition rule: **≥1 matched source must be a `seen` (non-derived)
  observation.** _(M/M)_
- **Reward-adaptive bar**: reward ≥ $5 → `distinctSources ≥ 4`. Bars only go up. _(S/M)_
- (Cheap add) **Real-label loop**: export founder release/reject decisions on held items (already in
  the DB) as labeled eval rows — Stage-2 seed users become the first free calibration set.

### Week 4 (Aug 13–17) — "Proven under attack, filmed on mainnet."
- **Semantic injection classifier** (Haiku, note+evidence): fires only when the regex detector
  didn't; shadow → arm at **high** severity (a med signal can't block autopay, so high is the only
  useful arming; a false positive costs a manual review — consistent with the detector's
  aggressive-by-design stance). Reused in the mission gate where `detectInjection` already runs.
- **Full matrix re-run**: P-GEN + P-JUDGE + live red-team + obs. Probe flake report → arm globally
  if clean (< ~2%).
- **Dress rehearsal on GOAT**: a real small-budget campaign, full Telegram loop,
  `DEPUTY_AUTOPILOT_MAINNET` deliberately armed for the filmed window (with the manual-review story
  as fallback — the master switch is a demo dependency, not an afterthought).

### Week 5 (Aug 18–26) — honesty buffer: video, submission, slip absorption. Not a build week.

---

## 3. Replay — the LEAN design (the one piece with real design surface)

**Rollout discipline (§2-shaped):** shadow → arm **hard-fail → hold** (subtract-only) → "probe-pass
*required* for autopay" is **deferred** until flake data says < ~2%. **Probe success never
manufactures a pay** — it enriches the decision record + the narration; only a probe *failure* can
subtract.

**Schema** — an optional field on `CandidateMission` + `MissionSpecV1`, **excluded from the spec
digest exactly like `anchors` (`schemas.ts:408`)**, so `missionSpecDigest`, settlement, and the
vault are untouched and there is **no migration** (probes ride in the locked mission-snapshot JSON):

```ts
interface MissionProbe {
  kind: "url_reached" | "text_present" | "element_visible" | "text_after_action";
  url: string;          // gate: same in-scope rule as targetSurface (check #3 reuse)
  action?: {            // only for text_after_action
    verb: "click" | "press" | "scroll";   // whitelist BY CONSTRUCTION — no type/fill/submit/goto verb exists
    target?: string;    // click: visible control text — MUST be corpus-anchored (Sage saw it)
    key?: "Enter"|"ArrowUp"|"ArrowDown"|"ArrowLeft"|"ArrowRight"|"Space"|"Escape"|"Tab";
    waitMs?: number;    // 0..10_000
  };
  expect: string;       // expected text / element label, 3..160 chars, ≥1 content word
  hard: boolean;        // THE RULE: hard ⇒ expect must be a normalized substring of the observation corpus
}
```

**Gate check #12 — `probeIssues(m, scope, corpus)`, mirrors `anchorIssues`:** probes optional, 1–4;
url must be https + inspected host + canonically observed (else `probe_out_of_scope`); `hard === true`
requires the corpus-anchored expectation (else `probe_unanchored` → mission rejected — the corrective
round fixes exact deterministic issues; if P-GEN shows yield cost, the one-line fallback is
downgrade-to-soft); a click ⇒ corpus-anchored target; ≤1 action probe per mission (bounds runtime).
**The symmetry is the point: the anchor gate means Sage only *designs* from what it saw; check #12
means Sage only treats as *decisive* what it saw.** A hallucinated probe can never gate money.

**Executor — `deputy/probe-runner.ts` (new):** field-test browser launch + the `requestGuard`
interceptor verbatim; navigate → settle (networkidle ≤ 15s) → check; per-probe 20s, run cap 60s;
**concurrency-1 via the existing singleton-lock pattern** (a 5-min sweep on the same VM as Next.js
must not pile up browser runs). Wired into `pipeline.ts` (not frozen — where the P16 b0 block +
wallet-freshness append already live), **URL-verifiable missions only** (the obs lane has its own
judge; keeping probes out of it means probe narration can never leak the private corpus — URL-lane
expectations are mission-card-public text anyway). Results go to the decision **journal + agent-log
events** (existing mechanisms — no new DB column), which `sage_get_submission`/`sage_get_proof`
already surface to the concierge.

---

## 4. The demo money-shot (Telegram, one unbroken take)

Founder sends a URL + budget → Sage inspects, designs, funds from its mandate-bound wallet → a tester
submits → **the agent-log streams Sage replaying the mission in its own browser — reached the page,
clicked the control it saw during inspection, found the expected text — then it pays** → Telegram
announces with the `/proof/<tx>` link → the founder asks "why did you pay this?" and the concierge
answers with the verbatim quote, the probe results, and the receipt. Every line is a **real** stage
event (feed-honest, invariant 6). **No UI change needed** — the narration surface is Telegram + the
concierge, which *is* the Telegram-primary story. Pitch line: *"Other agents read the work. Sage
re-does it before paying."* (Optional, founder's call: one "Sage replayed this" row on `/proof` is
the single UI exception worth granting for the video.)

---

## 5. The precision catch that the coordination surfaced (do not skip)

Everyone — including Fable's own first draft and GLM — wanted to seed the private corpus with
**predicted first-person tester phrasings** ("clicked start", "moved with arrows"). **That is a
precision *regression*, not just an enhancement.** P16's semantic-corroboration path already bridges
third-person-prose ↔ first-person-account at judgment time. Injecting *predicted* generic action
language into the corpus is exactly what a **guesser** also writes — it makes each screen easier to
hit and **erodes the guess defense** (§6.9's residual risk), because current vision prose is
*unguessably specific* and that specificity **is** part of the defense. Hence the W3 guards:
`derived` tags, the **≥1-`seen`-source** composition rule (legal — `OBS_BAR` is post-P16 code, not on
the frozen list), and the specificity filter. Recall improves via the judge; the deterministic floor
stays honest.

---

## 6. Invariants — precisely (corrected after adversarial review)

The earlier "everything is subtract-only" was **imprecise, and precision matters for a safety
claim.** The honest statement:

- **New verifier checks ARE subtract-only.** The entailment veto, the injection classifier, a
  probe *failure*, and the distinct-source bar can only force a hold/review or raise a floor —
  never manufacture a pay. A probe *pass* never manufactures a pay either (it enriches the record).
- **Capture + model changes are NON-MONOTONIC.** Swapping the payout model, rendering SPA evidence
  that static fetch missed, better vision, corpus enrichment, changed mission generation — these
  can **increase** payments (that's the recall goal). They are therefore NOT "safe by
  construction." Each requires: **shadow comparison → explicit promotion criteria (P-JUDGE
  wrong-autopay 0 + live red-team green) → a rollback flag.** No capture/model change ships to the
  money path without passing its battery.

Unchanged and absolute: no model computes a money amount; quotes stay verbatim; untrusted content
stays wrapped (rendered evidence is wrapped exactly like static evidence — and it is an
*adversarial* browser, so the field-test SSRF/request guard is reused verbatim); everything fails
closed to a hold (a malformed/truncated money-critical output fails closed — it is **never**
`repairJson`'d into a valid decision); `AUTOPAY_THRESHOLD` stays 0.85; the FROZEN payout files
force a live red-team re-run on any touch (including a model swap — jailbreak resistance is
model-dependent). **An unproven model — including the fallback — may not autopay; until it passes
P-JUDGE + red-team it is review-only.** Recall gains come from Sage capturing/knowing MORE; safety
comes from the vetoes + the batteries, not from a model's good behavior.
