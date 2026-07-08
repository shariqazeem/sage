# Sage — Growth Metrics Proposal

> Stage-1 deliverable. How we measure whether Sage is working — grounded in
> **real economic activity**, not vanity. Every metric below is derived from real
> rows (the on-chain journal + decision receipts), so it is auditable and cannot
> be inflated.

## North-star metric

**Real USDC settled autonomously to real recipients.**

This is the one number that captures the whole thesis: an AI agent that people
trust enough to let it move real money for verified work. It is on-chain, it is
verifiable, and it is exactly the "real economic activity" the bootcamp grades.

## Metric tree

We track a funnel from "a poster shows up" to "money moved safely, provably."

| Stage | Metric | Source |
|---|---|---|
| **Acquisition** | Campaigns created · distinct posters (vault owners) | `campaigns` |
| **Activation** | Campaigns with ≥1 verified submission · **first settled payout per poster** | journal |
| **Engagement** | Submissions received · **decisions made** (LLM) · distinct recipients | `submissions`, `decisions` |
| **Economic ★** | **Total USDC settled** · avg payout · **% auto-paid vs manual** · x402 fees | `events` (settled) |
| **Integrity** | **Blocks by the vault** · **wrong auto-pays (target: 0)** · T+30 grade accuracy · avg confidence | `events` (blocked), grading |
| **Retention** | Repeat campaigns / poster · vault top-ups · returning recipients | journal |

★ = the north-star family.

## The integrity KPI (our differentiator)

Most agents optimize a single "did it act" number. Sage's headline is the
**opposite guarantee**, and we measure it explicitly:

- **Wrong auto-pays = 0.** The Deputy must never autonomously pay a submission
  that didn't meet the criteria. This is the trust metric; it is worth more than
  raw volume.
- **Blocks are a feature, not a failure.** Every off-policy attempt the vault
  refuses is logged (`blocked`, with the failed check index) and shown as proof
  the leash holds.
- **Calibration.** Auto-pays fire only above the confidence threshold; we track
  the distribution so the threshold stays honest.
- **T+30 grade accuracy.** Verdicts are re-checked against on-chain reality later,
  so the record is falsifiable — reputation is earned, not asserted.

Already-live surfaces exposing these: `GET /api/agent/card`,
`/api/campaigns/<slug>/public`, `/agents/sage`, and per-payout `/proof/<tx>`.

## Stage-2 targets (with 10–20 seed posters, ~4 weeks)

| Metric | Target |
|---|---|
| Campaigns created | **≥ 20** |
| Distinct posters running a real campaign | **10–20** |
| Submissions verified by the Deputy | **≥ 100** |
| **USDC settled autonomously** | **≥ real, non-zero and growing week-over-week** |
| Distinct recipients paid | **≥ 30** |
| **Wrong auto-pays** | **0** |
| Vault blocks recorded (integrity signal) | **> 0** (proves enforcement fires) |
| Repeat posters (ran ≥ 2 campaigns) | **≥ 30%** |

We report week-over-week deltas on settled USDC and active posters; the absolute
dollar figure will start small (real testnet + mainnet, honestly) and the story
is the **slope and the zero wrong-pays**, not a vanity headline.

## Instrumentation

Nothing here is a mock. Metrics come from the same rows the product runs on:

- `reputation-core.deriveReputation()` folds the journal into settled totals,
  payout counts, blocks, distinct recipients, decision stats — deduped by tx so a
  single payout counts once.
- The `/api/agent/card` endpoint (cached 60s) is the machine-readable source of
  truth; a dashboard reads it directly.
- Because everything is on-chain + journaled, any judge can independently
  reproduce every number.
