# Sage — Seed User Definition

> Stage-1 deliverable. Who Sage is for, the pain it removes, and the first
> 10–20 users we onboard in Stage 2.

## Seed user (canonical)

**Early-stage web-product founders who have shipped a public product but lack enough real
users to quickly validate onboarding, positioning, and critical user journeys.** They have a
live URL and a hypothesis about what a first-time visitor should do, but not enough real
traffic to learn whether visitors actually get it. Sage turns their product + a budget into
**paid, verified testing missions** and pays testers **autonomously** inside hard on-chain
limits — so the founder gets real, evidence-backed answers without hand-judging submissions or
holding a treasury key.

## Stage 2 growth metrics

- 10–20 seed founders interviewed
- 10 founder accounts activated
- 5 funded campaigns
- 25 verified mission completions
- Median time from product URL → approved plan **< 10 minutes**
- Median time to first valid tester submission **< 24 hours**
- **100%** exactly-once payout rate · **zero** policy-limit violations
- ≥ 30% of founders launch a second campaign
- Mission usefulness rating **≥ 4/5**
- HOLD / rejection reasons tracked and published
- GEO: public agent/profile/docs discoverability across ChatGPT, Claude, Gemini, Perplexity

## Stage 1 deliverables

- [x] Agent launched — x402 configured; ERC-8004 identity **#79** registered on GOAT mainnet
- [x] Public app, project website, and product landing page (`sagepays.xyz`)
- [x] GitHub repository (public)
- [x] Seed user definition (this doc) + growth metrics proposal (above)
- [x] Complete founder → tester autonomous loop proven on Metis Sepolia (real contracts + txs)

The canonical, machine-readable ecosystem status (ClawUp / ERC-8004 / x402 / campaign network /
mainnet-autopilot) is served at `GET /api/ecosystem` — every claim backed by real evidence, never
env-presence alone.

## The core pain

Anyone who **pays many small contributors for verifiable work** hits the same
wall today. To run a bounty, quest, content push, airdrop-for-tasks, or grant
milestone, someone has to:

1. **Read every submission and judge it** — slow, subjective, and it doesn't
   scale past a handful.
2. **Hold the treasury keys** — one trusted person signs every payout, which is a
   custody risk and a single point of failure/fraud.
3. **Prove it was fair** — there's no audit trail, so disputes ("you didn't pay
   me / you paid your friends") are unanswerable.

The market's answer so far is "trust a human with a spreadsheet and the keys."
Sage replaces that with **an AI that verifies + a vault that can't be
over-spent** — delegation without custody, with an on-chain receipt for every
decision.

## Primary persona — the Campaign Runner

A **project/community operator** (founder, growth lead, DAO contributor, community
manager) who runs recurring reward programs and wants to:

- **Stop hand-checking submissions** — let a hardened AI verify against explicit
  criteria and cite the evidence.
- **Not hand anyone the keys** — fund a policy-capped vault; the AI can *propose*
  payouts but physically cannot exceed budget / per-tx / velocity caps.
- **Have proof** — every payout and every rejection is a public, verifiable
  on-chain transaction with the reasoning attached.

They already pay in stablecoins, already run bounties, and already feel the
verify-and-payout tax.

## Seed segments (priority order)

| # | Segment | The job they hire Sage for |
|---|---|---|
| 1 | **GOAT / Metis ecosystem projects** running bounties / quests / content | Verify + pay contributors in USDC without custody, with proof |
| 2 | **Hackathon & bootcamp organizers** (incl. this cohort) | Pay participants for completed tasks; auditable at scale |
| 3 | **Small DAOs & communities** paying contributors | Policy-capped, recurring, verifiable contributor payouts |
| 4 | **Grant / milestone programs** | Release funds on verified milestone evidence |

## The first 10–20 (Stage 2)

The **bootcamp cohort itself is the fastest seed pool** — every team runs its own
reward program, and Sage is the tool that runs it for them. Beyond that:

- **Where:** the OpenClaw/GOAT builder Telegram, the Metis/GOAT ecosystem, and
  direct outreach to projects currently posting bounties (Dework/Layer3-style
  tasks, Zealy quests, Discord bounty channels).
- **The offer:** "Run your next reward campaign through Sage — you fund a capped
  vault, share one link, and the Deputy verifies + pays. Every payout is on-chain
  proof, and it physically can't overspend your budget."
- **Target:** **10–20 posters** each running at least one real campaign, producing
  real settled USDC to real recipients.

## Activation journey (what a seed user does)

1. **Connect wallet + fund a PolicyVault** — set budget, per-tx cap, duration.
2. **Create a campaign** — task, acceptance criteria, reward per person.
3. **Share the `/c/<slug>` link** — participants connect, submit work + evidence.
4. **Watch the Deputy work** — each submission gets a decision receipt (criteria
   met/unmet with quotes, fraud signals, confidence).
5. **Manual approve, or turn on Autopilot** — confident, clean matches pay
   themselves, inside the vault's limits.
6. **Point to the proof** — `/proof/<tx>` per payout; `/agents/sage` for the
   running track record.

**Activation = a poster's first real settled payout.** Retention = they run a
second campaign (or top the vault up) without being asked.

## Why they stay

- It's **cheaper than a person** (an LLM decision is a fraction of a cent) and
  **faster** (seconds, not days).
- It's **safer than trusting the keys** — the vault is the enforcement, so a
  wrong or compromised AI still can't move money off-policy.
- The **track record compounds** — an ERC-8004-anchored history of fair,
  verifiable payouts becomes the reason the *next* poster trusts it.
