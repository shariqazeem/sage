# Self-canary release package (PREPARED, not deployed)

`founderCanaryReady = true` (Phase 3, `canary-runtime-closure-v2.json`). `productionDeployed = false`.

## Three exact configurations

### 1. DARK (default — byte-identical to today)
```
MISSION_GROUNDING_MODE=off
PAYOUT_ACTION_REPLAY_MODE=off
```

### 2. OBSERVE (measure only; no behaviour change)
```
MISSION_GROUNDING_MODE=shadow
PAYOUT_ACTION_REPLAY_MODE=shadow
```
Grounded plans are computed alongside legacy (never selected); replay runs and journals but never alters a
payout. Inspect the shadow journals.

### 3. SELF_CANARY (one wallet only)
```
MISSION_GROUNDING_MODE=canary
PAYOUT_ACTION_REPLAY_MODE=canary
MISSION_CANARY_ALLOWLIST=<the founder's ONE verified wallet, 0x+40hex>
MISSION_MODEL=google/gemini-3.1-flash-lite-preview
MISSION_GROUNDING_CRITIC_MODEL=google/gemini-3.1-flash-lite-preview
# migrations 0026 + 0027 applied; existing mainnet-autopilot flags UNCHANGED
```
Only the allowlisted wallet gets grounded selection + payout replay; every other founder stays on existing
behaviour. The kill switch is setting both modes back to `off` (or `shadow`).

## Preflight command
`npm run canary:preflight` — verifies env modes, exactly one valid allowlisted wallet, Flash-Lite routing,
migration 0026/0027 present, no ambiguous in-flight replay, chromium, egress proxy, kill switch. In SELF_CANARY
mode it EXITS NON-ZERO on any hard failure. Per-campaign gates (approved revision, policy digest,
campaign/mission/probe binding, wallet/gas/token balances) are re-verified at launch by the deputy's fail-closed
gates + the runtime preflight (`payoutReplaySchemaReady`).

## Operator runbook
1. **Deploy DARK.** `npm run canary:preflight` should read DARK; app behaves exactly as today.
2. **Verify health** (normal smoke: a launch, a submission, a manual payout).
3. **Enable OBSERVE.** Watch shadow journals (`payout_replay_journal`, grounding shadow telemetry) for a few
   days. Confirm zero unexplained disagreements.
4. **Enable SELF_CANARY for the one wallet.** Re-run `npm run canary:preflight` (must be all-green).
5. **Create ONE $5–$10 campaign** from that wallet. Manually watch the first submissions.
6. **On ANY mismatch** (a hold you don't understand, a policy-binding failure, a duplicate settle attempt, a
   replay outcome you can't explain, a receipt that doesn't match its committed decision) → immediately set the
   modes back to `shadow`/`off` (kill switch) and investigate.

**Do NOT recommend $50–$100 yet.** Scale beyond $10 only after ALL of:
- ≥ 5 correct end-to-end submission decisions;
- zero policy-binding failures;
- zero duplicate settlement attempts;
- zero unexplained replay outcomes;
- every transaction receipt matches its committed decision;
- the kill switch has been tested (flip to off, confirm no canary behaviour).
