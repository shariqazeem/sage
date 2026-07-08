# Sage — the control layer for AI agents that spend real money

> **Give an AI agent an allowance, not your keys.**

Sage is an autonomous **Payout Deputy**. You fund a policy-capped, on-chain vault
and define a task; people submit work; Sage's AI brain **verifies each submission
against your criteria and releases USDC** — or the vault blocks it. Every payout
is a real, verifiable on-chain transaction, and the agent's track record is
anchored to its **ERC-8004** identity.

**The guarantee:** the AI proposes *who* and *how much*; the **vault decides
whether money can move.** Anything off-policy is blocked on-chain *before* funds
move — even if the AI is wrong or compromised.

---

## Why it's different

- **The AI cannot be jailbroken into paying.** The brain is hardened with
  untrusted-data delimiters, a server-side injection detector, verbatim-quote
  enforcement, and a confidence ceiling — **15 / 15 adversarial attacks held**
  (see `tests/redteam/`).
- **Verifiable, not vibes.** Every decision cites the exact evidence quotes it
  read; every payout is a public `/proof/<tx>` page a stranger can re-check.
- **Accountable.** The reputation is derived from real on-chain rows and anchored
  to ERC-8004 — a track record, not a self-assertion.

## Live

| | |
|---|---|
| **App** | https://sage.80.225.209.190.sslip.io |
| **Agent identity** | [`/agents/sage`](https://sage.80.225.209.190.sslip.io/agents/sage) · ERC-8004 **#79** on [8004scan (chain 2345)](https://8004scan.io/agents?chain=2345) |
| **Telegram** | [@sagedeputybot](https://t.me/sagedeputybot) — `/agent`, `/status <slug>` |
| **A real autonomous payout** | [proof page](https://sage.80.225.209.190.sslip.io/proof/0x757e45437fecb13a0fae772559753a092646e94b5c7ceb00b00818ccb50a5eba) · [explorer](https://sepolia-explorer.metisdevops.link/tx/0x757e45437fecb13a0fae772559753a092646e94b5c7ceb00b00818ccb50a5eba) |

## Bootcamp integrations

- **x402** — live payment rail (GOAT mainnet, merchant `sage`; real settled txs).
- **ERC-8004** — on-chain agent identity + reputation (**#79**, chain 2345).
- **GOAT Network (2345)** + **Metis Sepolia (59902)** — the payout chains, per-vault.
- **GOAT-compatible adapter** — all chain access behind one interface (`src/lib/deputy`).

## How it works

1. **Fund a PolicyVault** — budget, per-tx cap, daily velocity cap, duration.
2. **Create a campaign** — task, acceptance criteria, reward per person.
3. **People submit** work + an evidence link.
4. **The Deputy verifies** — fetches the evidence, checks it against the criteria
   with an LLM, and produces a **decision receipt**: criteria met/unmet with
   verbatim quotes, fraud signals, confidence, and the x402 verification fee.
5. **Manual** → you approve and it settles. **Autopilot** → the Deputy pays
   confident, clean matches on its own, *inside the vault's enforced limits*.
6. Every payout / block → a public **`/proof/<tx>`** page.

## Stack

- **Next.js 15** (App Router, server-first RSC) · React 19 · **TypeScript strict**
- **Solidity + Foundry** (`PolicyVault`, `contracts/`) · **viem**
- **drizzle-orm + SQLite** · LLM brain over any **OpenAI-compatible** endpoint

## Quickstart

```bash
npm install
cp .env.example .env      # fill in — every var is documented inline
npm run dev               # http://localhost:3000
```

Quality gates (all green):

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

The `PolicyVault` ABIs are checked in, so the app builds without Foundry. To
rebuild the contracts: `cd contracts && forge build`.

## Repo map

```
src/app/            Next.js routes (/app, /agents/sage, /proof/[tx], /api/*)
src/lib/deputy/     the brain (LLM verify + hardening), pipeline, chain adapter
src/lib/campaigns/  campaigns, settle-flow, journal, reputation
src/lib/x402/       the GOAT x402 payment rail
contracts/          Foundry PolicyVault + factory
docs/CURRENT_STATE.md   the authoritative "where we are"
docs/AGENT.md           operator runbook
```

## Built for

The **OpenClaw Summer Builder Bootcamp 2026** (GOAT / Metis / ClawUp). Sage's
thesis: the agent economy needs a *payroll rail with a leash* — autonomous where
it's safe, physically bounded where it counts.
