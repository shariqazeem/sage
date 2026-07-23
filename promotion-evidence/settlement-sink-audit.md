# Phase 2 — repository-wide settlement-sink audit

**Broadcast entrypoint:** `settleApprovedSubmission` (`src/lib/campaigns/settle-flow.ts`) is the single function
that leads to money movement — it calls the vault adapter's `requestPayout` → `writeContract` (the only
on-chain broadcast; `src/lib/deputy/campaign-vault.ts`, `signer.ts`). No other code path broadcasts a payout.

## Every caller of `settleApprovedSubmission`, and whether the replay gate dominates

| # | Call site | Trigger | Replay gate? |
|---|-----------|---------|--------------|
| 1 | `src/lib/deputy/pipeline.ts:566` (`runDeputyOnSubmission`) | **AUTOMATED** (submission `after()` + sweep) | ✅ Dominated. Payout action-replay runs at step `c0`, BEFORE preflight/CAS/settle. Preflight schema check runs even earlier (before any decision). Proven: `pipeline.test.ts` "Phase 6C" (veto → held, broadcast spy 0) + "Phase 2" (missing schema → held before decision). |
| 2 | `src/app/api/deputy/sweep/route.ts:59` (pending autopilot loop) | **AUTOMATED** (cron) | ✅ Dominated — goes through `runDeputyOnSubmission` (same c0 gate). |
| 3 | `src/app/api/deputy/sweep/route.ts` (matured-approval timelock loop) | **AUTOMATED** (cron) | ✅ Dominated — this sprint added the subtractive replay guard before `settleApprovedSubmission`: canary + action mission + non-reproduced → skip (never broadcast). |
| 4 | `src/lib/campaigns/review-actions.ts:130` | **HUMAN** (operator out-of-band review release) | ⚪ Not applied by design — a human operator explicitly releases a specific payout; the operator is the authority. Documented as an operator override, not an autonomous path. |
| 5 | `src/app/api/campaigns/[id]/submissions/[sid]/decide/route.ts:103` | **HUMAN** (authenticated founder/operator decides in the UI) | ⚪ Not applied by design — human-initiated. |
| 6 | `src/app/api/campaigns/[id]/submissions/[sid]/settle/route.ts:51` | **HUMAN** (authenticated manual settle) | ⚪ Not applied by design — human-initiated. |

**Conclusion:** the payout action-replay veto (+ the preflight) dominates **every automated** broadcast path
(1, 2, 3). The three human-operator paths (4, 5, 6) are explicit manual overrides where the operator is the
authority; the replay is intentionally not interposed, and they are gated by SIWE/admin auth. For the
self-canary release the founder runs in **autopilot**, so their payouts flow through path 1 (fully gated).

## Fail-closed guarantees at the automated gate (canary mode)
Held (never broadcast; settlement spy 0) on: missing migration schema (preflight); policy absent / malformed /
digest-mismatch / plan-mismatch (loader fail-closed); wrong campaign/mission/probe binding; action mission
without a valid probe; any non-`reproduced` replay outcome; an internal/timeout/egress error. `reproduced`
only ALLOWS an already-qualified decision to continue — it never turns a non-paying decision into PAY.
