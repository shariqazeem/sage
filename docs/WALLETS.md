# Sage — Wallet & contract registry

> The single record of which wallet plays which role, on which network, and where its key
> lives. Addresses are public; **keys are never in this file or in git** — only the source
> that holds each key is named.

## Wallets

| Address | Network | Role | Key source (never printed) |
|---|---|---|---|
| **`0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6`** | **GOAT mainnet (2345)** | **Canonical agent/commerce wallet** — ERC‑8004 **#79** identity · GOAT signer · **x402 merchant "sage"** · owner + operator of the GOAT vault below | `contracts/.env:GOAT_AGENT_PRIVATE_KEY` + VM `.env:GOAT_AGENT_PRIVATE_KEY` |
| `0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35` | Metis Sepolia (59902) | **CampaignVault operator** (bounded payout authority — pipeline only) | `.env.staging.metissafety:OPERATOR_PRIVATE_KEY` + VM `.env:OPERATOR_PRIVATE_KEY` |
| `0xb77e6f5466cf52524e8465859277f192Be0bCfe4` | Metis Sepolia (59902) | Founder / deployer of the demo campaign | `contracts/.env:PRIVATE_KEY` |

**Separation is deliberate:** `0x0deF` = identity + commerce (GOAT); `0x7704E5` = bounded
CampaignVault payout operator (Metis Sepolia), which can spend **only** through the pipeline.
Never merge them.

## Balances (GOAT mainnet, as traced 2026‑07‑13)

- `0x0deF` — **0 USDC**, ~0.0000092 BTC (gas). ← **fund the x402 payer by sending USDC here**
- GOAT vault `0x987b93bf3b5E245211eB7Cb164C03cdfCC9c0850` — **1.5 USDC** (the live `founding-testers` campaign budget; owner+operator = `0x0deF`, recoverable via `withdrawRemaining`).

## Contracts

| What | Address | Network |
|---|---|---|
| ERC‑8004 registry (`AgentIdentity`, agent #79) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | GOAT 2345 |
| GOAT USDC | `0x3022b87ac063DE95b1570F46f5e470F8B53112D8` | GOAT 2345 |
| GOAT CampaignVault (`founding-testers`) | `0x987b93bf3b5E245211eB7Cb164C03cdfCC9c0850` | GOAT 2345 |
| GOAT factory | `0x09c95428d9CdDF42A7E83A6028F2FddDE5eE20FC` | GOAT 2345 |
| Metis Sepolia demo vault (`launch-yara`, 1.0 mUSDC) | `0x44A7E62016dF7C5Bcce618d23e2D809919fb22BB` | Metis Sepolia 59902 |
| Metis Sepolia mUSDC (test, valueless) | `0xF176f521290A937d81cc5878dfc19908f4D681A1` | Metis Sepolia 59902 |
| Metis Sepolia campaign factory | `0x2249b773aFEd5594985F7D350581A1b55f279C7f` | Metis Sepolia 59902 |

## ClawUp / Privy wallet (your question — you're right the docs mention it)

The official ClawUp **"GOAT & Metis Agent"** identity provisions a **Privy** policy-guarded
server wallet, and its curated ERC‑8004 + x402 skills default to signing with a
`GOAT_PRIVATE_KEY`. The guide documents two models:

- **Option A** — Privy is the single wallet; the GOAT skills sign via a Privy adapter.
- **Option B (our choice)** — give the GOAT skills the **existing `0x0deF` key** as
  `GOAT_PRIVATE_KEY`; Privy exists but is secondary.

**We use Option B** so ERC‑8004 **#79** and the x402 merchant **stay on `0x0deF`** and we do
**not** mint a duplicate Sage identity. So the x402 payer/merchant = `0x0deF` → **fund `0x0deF`**.
If, during the ClawUp install, the x402 skill turns out to *require* the Privy wallet, we can
either point it at `0x0deF` or move funds from `0x0deF` to the Privy wallet (we hold `0x0deF`'s
key, so it's reversible) — we confirm that during install, before any payment.
