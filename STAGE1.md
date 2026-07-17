# Sage — Stage 1 deliverables

> **Hire an AI worker. Give it a budget, not your keys.** Sage turns one product URL +
> one budget into paid, verified testing: it inspects the product, designs missions, deploys
> a policy-capped on-chain vault, and **autonomously pays human testers USDC for verified
> evidence** — inside hard limits it can never exceed, with a public on-chain receipt for
> every payout.

The thesis judged here is **bounded autonomy over money**: the AI proposes *who* and *how
much*; the **vault decides whether money can move.** Anything off-policy is blocked on-chain
*before* funds move — even if the model is wrong or jailbroken.

---

## Deliverables

| Deliverable | Status | Proof |
|---|---|---|
| **Agent launched** — live, autonomous **mainnet** payouts running | ✅ | https://sagepays.xyz · [`/agents/sage`](https://sagepays.xyz/agents/sage) |
| **x402** — real paid verification rail (GOAT) | ✅ | `<x402 payment receipt tx>` <!-- HOT-SWAP --> |
| **ERC-8004 identity** — registered, reputation from real settlements | ✅ | agent **#79** · [8004scan chain 2345](https://8004scan.io/agents?chain=2345) · `<registry tx>` <!-- HOT-SWAP --> |
| **Funding request** submitted | ☐/✅ | `<status / link>` <!-- confirm with Areej --> |
| **Public GitHub repo** | ✅ | `<repo link>` <!-- HOT-SWAP after public flip --> |
| **Project website** | ✅ | https://sagepays.xyz |
| **Product landing page** (live receipts) | ✅ | https://sagepays.xyz · [`/agents/sage`](https://sagepays.xyz/agents/sage) |
| **Seed-user definition** | ✅ | [GROWTH.md](GROWTH.md) |
| **Growth-metrics proposal** | ✅ | [GROWTH.md](GROWTH.md) |

## The headline proof

A real, autonomous, on-chain payout to a human for verified work:

- **Proof receipt (GOAT mainnet, real USDC):** https://sagepays.xyz/proof/0xd2483e5cfccd7dbe979683dfd8948cf9b022fe7348fa81fa127f91e785a8ffc4
- **Second mainnet payout:** https://sagepays.xyz/proof/0x95e513daab18b096dfb2dbe8578d5d4378de5bda76b15841aeef33333521028f
- **Agent track record:** [`/agents/sage`](https://sagepays.xyz/agents/sage) — settled total, payouts, and each receipt, all derived from on-chain rows.
- **Live campaign:** `https://sagepays.xyz/c/<slug>` <!-- HOT-SWAP: tonight's $20 campaign -->
- **Release-from-chat clip:** `<canary recording>` <!-- HOT-SWAP -->

Every payout page shows the human fact (who got paid, how much, for which mission), the AI's
verification receipt (the reasoning + the verbatim evidence quote it read), and the on-chain
transaction — re-checkable by anyone.

## What makes it real (not a demo wrapper)

- **The AI can't be jailbroken into paying.** Untrusted-data delimiters, an 8-family
  server-side injection detector, verbatim-quote enforcement, and a confidence ceiling —
  and the vault is the final gate regardless. Guarded by `tests/redteam/`.
- **It uses the product.** With the Field Test on, Sage browses the inspected product in a
  real headless Chromium and feeds screenshots/JS-rendered content to mission design.
- **Two front doors, one engine.** Web (SIWE + browser wallet) and **walletless Telegram** —
  a founder runs the entire lifecycle from chat: inspect → fund → autonomous payouts →
  **review held work** (release/reject) — with no wallet app.
- **Observable, honest autonomy.** A live activity feed and per-payout receipts, projected
  only from real rows; held/blocked lines carry a coarse class only, never evidence content.

## The three evidence classes to watch during the live campaign

A deliberately-aggressive judge produces the *strongest* evidence set, because it shows
judgment, not a rubber stamp:

1. **Clean autopays** → autonomy (Sage paid verified work with no human in the loop).
2. **Held → released from chat** → control (the founder overrode a hold live, from Telegram).
3. **A blocked payout / injection attempt** → integrity (the vault refused off-policy spend).

## Honest state

Real money is live on GOAT mainnet. Mainnet auto-pay is flag-gated and threshold-gated;
with no LLM key the judgment brain degrades to a heuristic that can never auto-pay. The
pay-side judgment eval is currently a small control set (n=1 clean control paid at 0.92) —
richer eval is Stage 2. See `CLAUDE.md` for the full spec, invariants, and known drift.
