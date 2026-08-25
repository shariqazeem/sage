# Work Proof — generalizing verification beyond product testing

> Design locked 2026-08-25 for the Future Caribbean window (build 26–29 Aug, live run 29 Aug).
> Goal: Sage's second vertical — **milestone micro-grants and gig payouts** — on the exact
> machinery that already pays testers, without touching a frozen layer.

## What the code already has (found, not assumed)

1. **The verification contract system is built, tested, and wired to nothing.**
   `src/lib/verify/contract.ts` defines five kinds — `onchain_tx`, `onchain_state`,
   `artifact_url`, `public_url`, `observation` — with strength tiers
   (`deterministic` / `strong` / `corpus`), and `verifiers.ts` implements the pure
   matchers + async wrappers (RPC/fetch failure ⇒ HOLD, never a throw). Zero non-test
   imports today. Work Proof = wiring this in, not building it.
2. **The judge routes on `verifiabilityClass` only** (`url-verifiable` |
   `observation-based`, `src/lib/deputy/pipeline.ts`). Observation goes to the P16
   corpus judge; everything else through the url-evidence lane.
3. **The deploy machinery hangs off an inspection.** `deployments` rows require a
   `jobId` (inspectionJobs) + `revisionId` (planRevisions); the wizard
   (preview → create → approve → fund → activate → attach) and the vault agreement
   check are all keyed to a plan revision. The Mission Brain is only the *author* of
   that plan — nothing downstream cares who wrote it.

## The design (5 pieces, maximal reuse)

### A. Direct campaigns = a new author for the same plan
A **direct campaign** creates a real `inspectionJobs` row of kind `direct` (no
browsing, no field test, no Mission Brain) and a real `planRevisions` row compiled
deterministically from operator input:

```
{ title, chainId, milestones: [ { title, instructions, criteria[],
    evidence: VerificationContract (no `observation`),
    rewardUsd, slots } ], allowlist?: wallet[] }
```

The compiler validates through the existing `validateMissionPlan` + `MissionSpecV1`
path. Everything downstream — plan page, founder claim, deployment state machine,
CREATE2 vault deploy, fund, attach, marketplace, receipts — runs **unchanged**,
because it is the same rows in the same shape.

### B. Budget: operator-priced, invariant preserved
Grants are funder-priced (tranche sizes are the operator's call), so rewards are set
per milestone and `totalBudgetBase` is **derived as Σ(rewardBase × maxCompletions)**
in 6-decimal base units — the budget invariant holds by construction. Floors still
bind (`MIN_REWARD_BASE`, tangible floor). `allocateBudget` is not modified.

### C. Judging: the deterministic verifier as a PRE-gate + trusted brief section
For a mission carrying a stored `VerificationContract` (new nullable JSON column on
`missions`; null ⇒ exactly today's behavior):

1. **Pre-gate (before any LLM spend):** run the matching verifier from
   `src/lib/verify/verifiers.ts`. Fail ⇒ refuse/hold with the leak-safe
   `publicDetail`; the LLM is never consulted, autopay is unreachable.
2. **Pass ⇒ inject the verifier's result into the decision brief as a
   server-generated, trusted section** (like the sanitized /proof evidence path):
   "ON-CHAIN VERIFICATION: PASSED — tx 0x… matched required shape". The existing
   brain + `autopilotGate` then run **unchanged**: the model has hard facts to cite,
   can still refuse on fraud signals, and remains forbidden from stating amounts.

This adds an AND term *in front of* the frozen AND-gate — it can only make payouts
stricter, never wider. No frozen file is edited. The model is never the sole basis
for a payout (the deterministic anchor is), which keeps the anchor-floor rule intact
for the new lane by construction.

### D. Campaign kind + optional allowlist
- `campaigns.kind`: `testing` (default) | `grant` | `gig` — drives copy only
  (labels.ts: "recipient / milestone" vs "tester / mission") on board, campaign,
  and proof pages.
- `campaigns.allowlist` (nullable JSON wallet list): enforced **at the submit route**
  (app-level gate); caps/budget/replay stay vault-enforced. Documented honestly as
  an application-layer control — no contract change in this window.

### E. Surfaces
1. `POST /api/campaigns/direct` (SIWE founder) → compiles + creates job/revision →
   returns the plan URL; the existing wizard deploys and funds.
2. `/launch/direct` — a lean web form (milestones, evidence kind picker, amounts,
   slots, optional allowlist). The plan page renders a "defined by you" variant
   (no browsing trail to show).
3. Telegram concierge tool (stretch, only if days allow): same compiler behind a
   walletless launch.

## Frozen layers — untouched, verified by suite
`brain-core` (SYSTEM_PROMPT / detectInjection / hardenBrief), `autopilotGate`,
mandate builder, vault ABIs + settle flow, `allocateBudget` internals. Red-team
suite + P-GEN battery must stay green; anchor integrity 100% is a hard stop.

## Migrations
1. `missions.verification_contract` (JSON, nullable)
2. `campaigns.kind` (text, default `testing`) + `campaigns.allowlist` (JSON, nullable)

## Test plan
- Unit: compiler (validation, budget derivation, floor enforcement), allowlist gate,
  verifier pre-gate routing (fail ⇒ no LLM call; pass ⇒ trusted section present).
- Existing: full vitest run incl. `tests/redteam/` + P-GEN matrix before deploy.
- Live drill (Aug 29): one real milestone micro-grant on GOAT mainnet — operator
  defines 2 milestones (one `onchain_tx`, one `artifact_url`), real USDC, at least
  one autonomous settle + one refusal path exercised, receipts public.

## Out of scope (roadmap, not this window)
Second settlement rail (Base), on-chain allowlists, nested/multi-party budgets,
fiat edges, moving inference providers.
