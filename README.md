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
| **App** | https://sagepays.xyz |
| **Founding testers** | [`/c/founding-testers`](https://sagepays.xyz/c/founding-testers) — test Sage, get paid real USDC on GOAT mainnet |
| **Agent identity** | [`/agents/sage`](https://sagepays.xyz/agents/sage) · ERC-8004 **#79** on [8004scan (chain 2345)](https://8004scan.io/agents?chain=2345) |
| **Telegram** | [@sagedeputybot](https://t.me/sagedeputybot) — `/agent`, `/status <slug>` |
| **A real autonomous payout** | [proof page](https://sagepays.xyz/proof/0x757e45437fecb13a0fae772559753a092646e94b5c7ceb00b00818ccb50a5eba) · [explorer](https://sepolia-explorer.metisdevops.link/tx/0x757e45437fecb13a0fae772559753a092646e94b5c7ceb00b00818ccb50a5eba) |

## Bootcamp integrations

- **x402** — live payment rail (GOAT mainnet, merchant `sage`; real settled txs).
- **ERC-8004** — on-chain agent identity + reputation (**#79**, chain 2345).
- **GOAT Network (2345)** + **Metis Sepolia (59902)** — the payout chains, per-vault.
- **GOAT-compatible adapter** — all chain access behind one interface (`src/lib/deputy`).

## Real on mainnet vs. testnet (the honest split)

| | Metis Sepolia — testnet | GOAT mainnet |
|---|---|---|
| ERC-8004 identity | — | ✅ **#79**, live on 8004scan |
| x402 merchant + payments | — | ✅ merchant `sage`, real txs |
| Policy Vault (deployed + funded) | ✅ | ✅ |
| Full autopilot loop (verify → auto-pay) | ✅ **proven**, real payout | ✅ armed |

Testnet is the sandbox, not a demo: destructive testing (the kill switch, the
break-it gauntlet) runs on Sepolia **by design**; real money moves on GOAT mainnet.
Nothing in Sage is simulated — every payout, block, decision, and fee is a real row
or a real transaction.

**Two kinds of replay safety, kept distinct.** The upgraded `PolicyVault` consumes
each committed intent on-chain (check 7), so a settled intent can never move funds
again — **contract-level** replay protection. Separately, the app keeps a durable
settlement ledger and resumes crashed settles instead of blind-resending —
**application-level** recovery. These are not the same guarantee: a vault deployed
before the upgrade has the app-level ledger but **not** the on-chain guard, so it is
a *legacy* vault. The Deputy's mainnet autopilot **refuses to auto-pay from a legacy
(or unreadable) vault** and holds for manual approval; a freshly deployed vault gets
the on-chain guard automatically. Combined track-record totals are shown as combined
and split per chain — a mainnet figure never silently includes testnet USDC.

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

## Field Test (optional) — Sage actually uses the product

By default the inspector reads server-rendered HTML only. Set `FIELD_TEST_ENABLED=1`
to also run a **Field Test**: Sage opens the product in a real headless Chromium
(reusing the same SSRF/public-host guards), navigates the entry page + a few ranked
same-origin pages, and captures screenshots, JS-rendered content, console errors, and
broken requests — feeding them to the Mission Brain and surfacing a "Sage used your
product" strip on the results page. It never fills or submits forms; interaction is
same-origin GET navigation only, and any failure degrades gracefully to the HTML-only
inspection (the inspection job never fails because of it).

Install the browser once:

```bash
npx playwright install --with-deps chromium
FIELD_TEST_ENABLED=1 npm run dev
```

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

## Seed user & Stage 2 growth

**Seed user:** early-stage web-product founders who have shipped a public product but lack
enough real users to quickly validate onboarding, positioning, and critical user journeys.
Sage turns their product + a budget into paid, verified testing missions and pays testers
autonomously inside hard on-chain limits.

Stage-2 growth targets (interviews, activations, funded campaigns, verified completions,
URL→plan and time-to-first-submission medians, exactly-once payout rate, zero policy
violations, second-campaign rate, mission usefulness, GEO discoverability) and the Stage-1
deliverables checklist live in [docs/SEED_USERS.md](docs/SEED_USERS.md).

**Honest ecosystem status:** `GET /api/ecosystem` returns the one canonical model —
ClawUp / ERC-8004 / x402 / campaign network / mainnet-autopilot — where every "verified /
paid / live" is backed by real evidence (on-chain `ownerOf`, a settled x402 tx, the flagship
campaign's actual network), **never** environment-variable presence alone.

## Built for

The **OpenClaw Summer Builder Bootcamp 2026** (GOAT / Metis / ClawUp). Sage's
thesis: the agent economy needs a *payroll rail with a leash* — autonomous where
it's safe, physically bounded where it counts.
