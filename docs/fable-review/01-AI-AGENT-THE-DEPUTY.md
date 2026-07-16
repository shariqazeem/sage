# 01 — The AI Agent ("the Deputy")

> How the AI agent is actually built and coded, how it works, how it creates missions, how it checks evidence, how it decides to pay, and what it genuinely can and cannot do. Grounded in the code as of 2026-07-16. Honest about stubs and gaps. File:line references throughout so claims are checkable.

---

## 0. Orienting fact: there are three brains, and one dead product

The spec's "token investigator that issues SAFE/RISKY/SCAM verdicts" **does not exist in code** — it's a disabled placeholder (`src/app/sage/page.tsx`) plus presentational metadata (`src/lib/verdicts.ts`). The real product is an **autonomous payout agent for paid product-testing missions.**

There are **three** LLM brains, which are easy to confuse:

1. **Payout Deputy** — `src/lib/deputy/brain-core.ts` (pure logic) + `brain.ts` (network orchestrator). *Judges* tester submissions and proposes pay/review/hold.
2. **Mission Brain** — `src/lib/launch/mission-brain.ts` + `mission-prompt.ts`. Architect + critic that *designs* missions from an inspected product.
3. **Telegram Concierge** — `src/lib/telegram/concierge.ts`. Conversational front-end (covered in doc 02).

This doc covers brains 1 and 2 and the on-chain settlement they drive.

---

## 1. The autonomous loop (there isn't one, exactly)

**There is no long-running agent process or event stream.** "Autopilot" is a stateless gate invoked by two triggers:

- **Trigger A — synchronous, per submission.** `src/app/api/campaigns/[id]/submit/route.ts:150-156`: after the HTTP response flushes, `after(() => runDeputyOnSubmission(submissionId))` runs the pipeline once.
- **Trigger B — a cron "sweep."** `src/app/api/deputy/sweep/route.ts` (GET+POST), authenticated via `x-deputy-cron-secret` or Vercel Cron's bearer. Each sweep (`runSweep`, line 39): recovers rows stuck in `settling` >300s; re-runs `runDeputyOnSubmission` for pending items; re-fires settlement for approved-but-unsettled items (matured timelocks); pays operator fees over x402. A singleton lock (`acquireLock(LOCK, 55s)`) makes overlapping ticks no-ops; `LOCK_TTL=55` is "< the 5-minute cron interval," so intended cadence is ~5 min.

**Nothing in the repo schedules the sweep** — no `vercel.json` cron or systemd timer in the tree. Per project notes it's an **external pm2 watcher on the VM** that POSTs the endpoint. So "autonomy" = an out-of-process timer hitting an authenticated route every few minutes + a best-effort synchronous run at submit time.

The single decision path is `runDeputyOnSubmission` (`src/lib/deputy/pipeline.ts:245`): sandbox bail → `ensureDecision` (brain) → `gateFromBrief` → Sybil dedup → `preflight`/`preflightV2` → CAS `pending→settling` → `settleApprovedSubmission`. It never throws for control flow — any failure resets the submission to `pending` for the next sweep.

**Mission-generation trigger:** `POST /api/launch` → `after(() => runInspectionJob(job.id))` (`src/app/api/launch/route.ts:37`). Also reachable via the authenticated Agent API and the MCP server.

---

## 2. Inspection → mission generation

### 2.1 The critical fact: the agent does NOT test the product

**It reads server-rendered HTML and designs missions for humans. It never interacts with the product.** This is explicit and load-bearing:

- `inspectProduct` (`src/lib/launch/inspect.ts`) crawls **up to 9 same-origin pages, depth 2** (`DEFAULTS`, line 38-45), fetching **top-level HTML only** — "no JS execution, no subresources, no forms/mutations" (lines 10-12). Client-rendered flows are reported as a `limitation`, never inspected. SSRF-guarded per hop + a DNS private-IP re-resolution check. **There is no Playwright/Puppeteer/headless browser anywhere in `src/`.**
- The mission architect is told the *human* tester submits evidence: `mission-prompt.ts:40` (rule 6, "EVIDENCE CAPABILITY (hard platform limit)") — a tester submits "a PUBLIC HTTPS URL + the EXACT quoted text observed there + a short text observation… Sage CANNOT ingest a screenshot, image, photo, video, screen recording, uploaded file/document, or any private/authenticated (logged-in) content."

**So the Deputy is a mission *designer* and evidence *adjudicator*, not a product tester.** A whole class of testing (JS-rendered flows, anything behind auth, anything needing a screenshot) is structurally out of reach. This is probably the single most important thing for the review to weigh.

### 2.2 The mission-generation mechanism

Pipeline `inspectAndPlan` (`src/lib/launch/pipeline.ts:49`): `inspectProduct` → optional `inspectRepo` (public GitHub only) → deterministic `buildProductMap` → `runMissionBrain` → `allocateBudget` → `compilePlan`. Every stage stamps real progress via `onStage` (no fake timers — a deliberate "no fabricated feed" rule).

`runMissionBrain` (`src/lib/launch/mission-brain.ts:263`) is **architect → critic → deterministic gate**:

- **Architect** (`architect`, line 186): `llmCompleteJson` with `ARCHITECT_SYSTEM`, up to **5 attempts** with jitter and temperature variation (0.3/0.15/0.45), designing **3 to 6 missions**. Each is coerced into a `CandidateMission` (`coerceMission`, line 80) with heavy clamping.
- **Critic** (`critic`, line 215): an *independent* LLM pass (`CRITIC_SYSTEM`, temp 0) returning accept/revise/merge/reject/needs_input per candidate.
- **Deterministic gate**: `validatePlanMissions` (`src/lib/launch/validate-mission.ts`) is the real backstop — "model output is untrusted until it passes the gate." If everything is rejected, it feeds the exact validation errors back to the architect **once** (corrective round, line 286-290).

**Prompt shape** (`mission-prompt.ts`): strict JSON, versioned `MISSION_PROMPT_VERSION="mb-v1"`. The inspected product is wrapped in `<<<UNTRUSTED_INSPECTED_PRODUCT>>>` markers (the "TRUST BOUNDARY"); `stripMarkers` neutralizes forged delimiters. Missions must cite `inspectedUrls`, be non-destructive, and be verifiable from a public URL. Per-mission output schema includes: `missionKey, title, objective, instructions, targetSurface, criteria[], evidenceRequirements[], whyItMatters, sources[], priority, riskCategory (11 enum values), effortMinutes, rewardWeight (1-10), maxCompletions, verificationMethod, confidence, assumptions[], disallowed[]`.

### 2.3 Rewards are deterministic, not the LLM's job

The LLM only proposes **weights**; money is computed by a deterministic compiler. `allocateBudget` (`src/lib/launch/budget.ts`): the founder enters one total budget; this turns `rewardWeight`/`priority`/`maxCompletions` into exact per-completion rewards in **6-decimal base units**, enforcing `Σ(rewardBase × maxCompletions) === totalBudgetBase` via a "balancer" mission that absorbs the exact remainder. Constants: `MIN_REWARD_BASE=100_000` (=$0.10), `MAX_COMPLETIONS=50`. If the budget can't fund a meaningful plan it drops the lowest-priority mission or returns `ok:false`. `compilePlan` (`src/lib/launch/plan.ts`) produces canonical `MissionSpecV1` + on-chain hashes and **self-checks against the live payout invariant** `verifyPublicIdentity` (line 120) — if Sage's own plan can't pass the same check that guards a payout, it refuses to mark it deployment-ready.

---

## 3. Evidence evaluation (the Payout Deputy)

`ensureDecision` (`src/lib/deputy/decisions.ts:119`) is the adjudication entrypoint (idempotent — an existing decision short-circuits the brain unless `force`).

- **What's judged.** For **V2** (mission-scoped) it judges against the **immutable locked mission snapshot** — task instructions, target surface, criteria, required evidence — all treated as *trusted founder-authored context* (line 187-199). The submitter's `note` is untrusted. It **fails closed to HOLD** if the mission is missing/draft/drifted or fails the pre-LLM `verifyPublicIdentity` invariant. For **V1** it judges the campaign's own criteria.
- **Evidence fetch.** `fetchEvidence` (`src/lib/deputy/evidence.ts:91`): 5s timeout, **250 KB cap**, 2 redirects (each SSRF-re-validated per hop — DNS-rebind defense), HTML stripped to text (surfaces `href` targets so "links to explorer" criteria are checkable), truncated to **40 000 chars**. Unreachable/oversized/blocked is a *signal* (`ok:false + failReason`), never an exception.
- **Accepted evidence: fetchable TEXT from one public URL only.** No screenshots, images, video, uploads, authenticated content, or direct on-chain reads. An "on-chain proof" a mission requires is verified only insofar as the tester links a public page (e.g. an explorer URL) whose text Sage can fetch.

**The brain call** — `verifySubmission` (`src/lib/deputy/brain.ts:210`): OpenAI-compatible `/chat/completions`, `temperature:0`, `response_format:{type:"json_object"}`, `max_tokens:1200`. Chain: **PRIMARY (3 attempts, backoff) → FALLBACK provider (1 shot, if `LLM_FALLBACK_*` set) → HEURISTIC**. A fallback success is still `engine:"llm"` and can auto-pay; only the heuristic cannot.

**The rubric** is the frozen `SYSTEM_PROMPT` (`brain-core.ts:136-171`): skeptical-but-fair; **never states a payout amount** ("THE LLM PROPOSES, THE VAULT DISPOSES"); **verbatim quotes only** (fabricating a quote is "the single worst failure"); an explicit trust boundary; a calibration ladder where **0.85 is the autonomous-payment bar**. Output is strict JSON: `criteria[]{criterion,met,confidence,quote?}`, `fraudSignals[]{signal,severity,reason}`, `recommendation (pay|review|hold)`, `reasonCode`, `confidence`, `summary`.

**Server-side post-processing (model-independent):** `repairJson` (4 fallback parse strategies) → `parseBriefContent` (coerce/clamp) → **`enforceQuotes`** (drops any quote that isn't a verbatim substring of the evidence; keeps the finding) → **`hardenBrief`** (injection detection + confidence ceiling, §5).

**Keyless heuristic** (`src/lib/campaigns/assess.ts`): a transparent token-overlap/keyword matcher. Honest ("no LLM key configured") and, by the gate's `engine==="llm"` rule, **can never auto-pay**. So with no `LLM_API_KEY`, the "AI agent" degrades to a regex/token matcher.

---

## 4. Payout decision + on-chain settlement

**The gate** — `autopilotGate` (`src/lib/deputy/autopilot.ts:45`) returns `pay:true` **only if all hold**: `autonomy==="autopilot"` AND `status==="pending"` AND `engine==="llm"` AND `recommendation==="pay"` AND no high-severity fraud signal AND `confidence >= threshold` (default `AUTOPAY_THRESHOLD=0.85`). **Extra mainnet gate:** if `chainId===2345` (GOAT) and `DEPUTY_AUTOPILOT_MAINNET` is not truthy, it **holds for manual approval** (line 51-56). That flag **defaults OFF** (`src/lib/env.ts:162`) — so real-money auto-pay is disarmed unless explicitly flipped.

**Preflight caps** (`pipeline.ts`): reads live vault state and holds on: vault not active, insufficient remaining budget, amount > per-tx cap, amount > 24h velocity cap, mission completions exhausted, recipient already paid, and — on mainnet — the vault must prove on-chain intent-replay protection (`isIntentUsed`). V2 additionally enforces DB↔chain agreement and re-derives every identity hash *before signing*. These are courtesy pre-checks; **the vault is the real enforcement** and soft-rejects anyway.

**How money moves.** After CAS `pending→settling`, `settleApprovedSubmission` → the chain adapter:
- **V2** (`src/lib/deputy/campaign-vault.ts` `requestPayout`, line 507): calls `requestPayout(missionId, recipient, decisionDigest, intentHash)` — **NO amount** (the vault derives the exact reward from the immutable mission), no recipient allowlist. Decodes the vault's own `PayoutSettled`/`PayoutRejected` event as the single source of truth, validating the emitting contract == expected vault and chain.
- **V1** (`src/lib/deputy/signer.ts` `submitRequestSpend`, line 186): `requestSpend(vendor, amount, intentHash)` — amount *is* passed and the recipient must be allowlisted (governance the Deputy won't self-sign → holds for owner signature).

**The signer** (`signer.ts`): operator key resolved **per chain** — GOAT (2345) uses `GOAT_AGENT_PRIVATE_KEY` (the *same wallet* holding the ERC-8004 identity and paying x402); Metis uses `OPERATOR_PRIVATE_KEY`. Writes go through `sendVaultWrite`: Metis = legacy gas +20%; GOAT = EIP-1559 with legacy fallback. Idempotency by `intentHash` + `(kind,txHash)` journal dedup; tx identity persisted before broadcast for crash recovery.

**x402 rails are real** (`goatx402-sdk-server`): RAIL 1 — the Deputy pays **$0.10** (`VERIFICATION_FEE_USD`) to its own paywalled `/api/verify/evidence` before fetching evidence, when all `GOATX402_*` creds present. RAIL 2 — operator fees in the sweep. If not live or a payment fails, it **falls back to a direct unpaid fetch** and records the honest status — never a simulated tx.

---

## 5. Prompt-injection defense

Two independent layers; the second is the real one.

1. **Prompt-level (model-dependent):** the trust-boundary paragraph in `SYSTEM_PROMPT`, untrusted-data markers `<<<UNTRUSTED_SUBMITTER_NOTE>>>` / `<<<UNTRUSTED_FETCHED_EVIDENCE>>>`, `stripDelimiters` (defeats forged close-markers), and note/evidence truncation.

2. **Server-level (model-independent) — the real defense:** `detectInjection` (`brain-core.ts:514`) scans the untrusted note (+ external evidence) against **8 regex families** (`INJECTION_PATTERNS`): override-instructions, instruct-verdict, instruct-confidence, role-play-authority, approve-imperative, fake-brief-json, jailbreak-lexicon, hidden-control/bidi chars. Any hit → one **HIGH-severity** fraud signal. `hardenBrief` then (a) injects that signal, (b) **caps confidence at 0.5 when evidence couldn't be fetched** (`NO_EVIDENCE_CONFIDENCE_CEILING`), and (c) forces `reasonCode="prompt_injection"`. Because the gate blocks on any high-severity signal, **even a fully-jailbroken model returning `pay`/`1.0` cannot clear the gate.**

**Trusted-proof exemption (a real footgun that was fixed):** Sage's own `/proof/<tx>` pages render a decision receipt containing "recommendation to pay," a confidence %, even the word "jailbreak" — which self-tripped the detector. `isTrustedSageEvidence` (only `sagepays.xyz/proof/*`) + `sanitizeTrustedProofEvidence` excise that block; a false-positive-correction path can release a held brief *only* when the note is clean, all criteria met, and the only high signal was the false injection. External pages stay fully scanned.

**How strong / how tested:** `tests/redteam/brain-redteam.test.ts` drives **16 fixtures**: 7 "detector" (regex-catchable), 2 "ceiling," 1 "control," 6 "model." The deterministic suite proves detector+ceiling defeat the worst-case jailbroken model. **But the 6 "model"-class attacks are explicitly *not* regex-catchable — the LLM is their only defense**, "proven live" by a non-deterministic script not in CI. So: the regex layer is a hard floor against an *enumerated* attack set; **semantic/novel injections rely on the model behaving.** The detector is deliberately aggressive (false-positive = a manual review), so legitimate submissions that merely *quote* instruction-like text can get held.

---

## 6. Verdict / T+30 grading

**Unbuilt.** No SAFE/RISKY/SCAM issuance, no 72-hour eligibility, no token investigation, no T+30 grading job anywhere in `src/`. The `reasonCode` enum is described as "the seed of the automated T+30 grading story," but no grader consumes it.

What *does* exist is a different, **derived reputation** (`src/lib/erc8004/reputation-core.ts`): a work record counted from real journal rows — settled payouts (deduped by `chainId:txHash`), blocked spends (the "integrity signal"), distinct campaigns/recipients, decision-confidence stats. Honestly zero until real work happens. Anchored to the ERC-8004 identity, but it's a **payout track record, not a verdict-accuracy grade.**

---

## 7. LLM models + providers actually used

| Where | Env vars (in order) | Hardcoded default |
|---|---|---|
| Payout Deputy | `LLM_API_KEY`\|`COMMONSTACK_API_KEY`; `LLM_BASE_URL`\|`COMMONSTACK_BASE_URL`; `LLM_MODEL`\|`DEPUTY_MODEL` | base `https://api.commonstack.ai/v1`, model `deepseek/deepseek-v4-flash` |
| Deputy fallback | `LLM_FALLBACK_API_KEY`+`_BASE_URL`+`_MODEL` (all 3) | none (opt-in) |
| Mission Brain | same primary vars | same defaults |
| Telegram Concierge | `CONCIERGE_MODEL` → … → default | default; **deployed = `anthropic/claude-haiku-4-5`** |

All are the same OpenAI-compatible Chat Completions shape; provider is inferred from the base URL and stamped on the brief so a receipt shows which host decided.

**Caveats to flag:** the model IDs in `MODEL_PRICES` (e.g. `deepseek/deepseek-v4-flash`, `xai/grok-4.1-fast-reasoning`) don't correspond to verifiable public models — CommonStack aliases or placeholders; prices are hardcoded and cost is *estimated* from token usage, not billed. The frozen header comment says the verified LIVE primary was **gemini** (fallback deepseek), which disagrees with the code default of deepseek — the "verified" config and the checked-in default are not the same model.

---

## 8. What is REAL vs stubbed/mocked/hardcoded

**Real and working:**
- On-chain settlement via viem against real deployed vaults (V1 `PolicyVault` / V2 `CampaignVault`), per-chain operator signing, event-decoded outcomes, intent-replay + CAS + `(kind,txHash)` idempotency, crash recovery.
- x402 payments via a real SDK (RAIL 1 paid evidence verification + RAIL 2 operator fees), honest unpaid fallback.
- The Payout Deputy brain, quote enforcement, `detectInjection` + confidence ceiling, deterministic red-team suite.
- The Mission Brain (architect+critic+deterministic gate), the bounded SSRF-guarded inspector, the exact budget compiler.
- ERC-8004 identity + derived payout reputation. Strong Vitest coverage across the pure cores.

**Stubbed / mocked / degraded / hardcoded:**
- **SAFE/RISKY/SCAM + T+30 grading: not built** (placeholder UI only).
- **LazAI: absent** (text label only; no client/attestation).
- **The "GOAT-compatible adapter" abstraction doesn't exist** — on-chain access is direct viem; multi-chain is a hand-rolled `CHAINS` registry (`networks.ts`).
- **The agent never tests products** — HTML inspection only; humans test.
- **Mainnet autopilot OFF by default** — real-money campaigns hold for manual approval.
- **Keyless mode** silently degrades every brain to a keyword heuristic (honest label, never auto-pays).
- **Hardcoded/unverified constants:** `VERIFICATION_FEE_USD=0.10`, `MODEL_PRICES` with likely-fictional IDs, autopay threshold 0.85, inspection bounds (9 pages / depth 2). Cost is *estimated*, never reconciled.
- **The "JUDGMENT LAYER FROZEN" banners** are a comment convention, not enforced; the "frozen verified" primary (gemini) differs from the code default (deepseek).
- **No in-repo scheduler** for the sweep — autonomy depends on an external pm2/cron watcher.

### File map
- Payout brain: `src/lib/deputy/brain-core.ts`, `brain.ts`, `decisions.ts`, `autopilot.ts`, `pipeline.ts`
- Evidence: `src/lib/deputy/evidence.ts`, `src/lib/x402/verify-evidence.ts`
- Settlement: `src/lib/deputy/campaign-vault.ts` (V2), `signer.ts` (V1), `src/lib/campaigns/settle-flow.ts`
- Mission generation: `src/lib/launch/inspect.ts`, `mission-brain.ts`, `mission-prompt.ts`, `budget.ts`, `plan.ts`, `pipeline.ts`; `src/lib/llm/complete.ts`
- Injection tests: `tests/redteam/brain-redteam.test.ts`, `attacks.json`, `scripts/redteam-brain.mjs`
- Config: `src/lib/deputy/networks.ts`, `src/lib/env.ts`, `src/lib/x402/facilitator.ts`
- Dead thesis: `src/lib/verdicts.ts`, `src/app/sage/page.tsx`; reputation: `src/lib/erc8004/reputation-core.ts`

---

## 9. The biggest questions this raises for improvement

1. **Capability ceiling.** The agent designs missions and reads text evidence; it can't use the product (no headless browser, no auth, no screenshots). The most impactful improvement is probably here — should the agent actually *drive* products (a real browser-using tester), and how does that interact with the on-chain payout guarantees?
2. **Evidence modality.** "Public URL + verbatim quote" is a hard limit that shapes every mission. Screenshots/authenticated flows are the majority of real product testing. What's the trust-preserving way to expand accepted evidence?
3. **Semantic injection.** The regex floor is solid for enumerated attacks; novel semantic injections rely on the model. Worth a stronger, tested semantic layer given real money is at stake.
4. **Model config honesty.** Placeholder model IDs, an estimated (not billed) cost, and a "frozen" config that differs from the default. The inference layer deserves a real, verifiable footing (this is also where LazAI was *supposed* to live).
