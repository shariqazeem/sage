# The fiat door, Crossmint, and the rails — a decision record (5 Sep 2026)

## The question

Future Caribbean's bar is "does your system change outcomes" for people who mostly cannot hold
USDC. Sage settles on GOAT Network (public receipts) and Starknet (private payouts). The founder asked
whether to move to a chain that Privy *and* Crossmint support, so a founder can fund with a card and a
worker can cash out to local currency, and whether to do it before the deadlines.

## What Crossmint offers today (researched 5 Sep 2026)

- **Onramp** — cards, Apple/Google Pay, bank transfer → USDC/USDT. Supported in all regions on
  **Solana, Polygon, Base**; Stellar outside the US; every other chain is "contact sales". Embedded
  KYC (progressive). Headless API, embedded widget, or hosted button.
- **Offramp** — local-currency payouts on Ethereum, Solana, Polygon, Base, Arbitrum. Country coverage
  is not published; Caribbean corridors are not listed.
- **Agent wallets** — non-custodial, scoped spending under user-defined rules, x402/MPP; a white-label
  SDK "that plugs into your agent framework as a tool or skill".
- **GOAT SDK** (Crossmint's "Great Onchain Agent Toolkit", no relation to GOAT Network) is archived —
  read-only — so a Sage plugin for it would ship into a dead ecosystem.

Neither GOAT Network nor Starknet is reachable by Crossmint's onramp or offramp.

## The decision

**Not before the deadlines.** Moving the public rail to Base or Polygon means deploying the
`CampaignVault` factory there, adding the chain to the registry, re-pointing the operator fee rail
(x402 is GOAT-specific) and the ERC-8004 identity, and re-validating the settlement flow with real
money — all of it on the money path, none of it verifiable without a funded wallet and a Crossmint
account with KYC configured. The rails as they stand are proven on-chain (39 payouts) and the batteries
are green; a chain migration in the last 40 hours risks the one thing both hackathons score first —
a working mainnet product.

**After the deadlines, the path is clear and cheap in code:** the chain registry (`src/lib/deputy/networks.ts`)
is the only place a rail is named; the vault contracts are chain-agnostic; the settlement dispatcher
already branches by rail, not by chain. Adding Base (Privy-supported, Crossmint-supported) as the
public rail is a factory deployment, a registry entry and a fee-rail decision — then Crossmint's
onramp funds a treasury from a card and its offramp pays a worker in local currency where the
corridor exists. The typed fiat adapter (`src/lib/settlement/adapters.ts`) is the seam it plugs into;
it already refuses in words rather than simulating money.

## The rails, stated once

- **Starknet — private payouts, the rail Sage leads with.** The Cairo vault derives the reward and
  answers a refusal with a code; a recipient collects behind `poseidon(secret)` through a claim link,
  publicly or into a shielded note. This is the STRK20 entry and the FC "banking-shy earner" answer.
- **GOAT Network — public receipts and the treasury.** Every payout is a transaction anyone can open;
  the email-embedded wallet and the operator's standing mandate live here, because that is where Privy's
  server wallets and the mandate policy exist today.
- **One account, both rails.** A founder signs in with email or either wallet; the composer asks
  "public receipts or private-capable", never "which chain".

## What would make a Sage-held Starknet treasury safe (the next design)

The operator account already holds the vault class and STRK for gas. A per-founder Starknet treasury
would be a Cairo contract holding the founder's USDC with the same policy as the mandate — weekly and
per-campaign ceilings, a reserve floor — enforced *on-chain*, so the operator can only move funds into
vaults it deploys under those limits and the founder can withdraw the rest at any time. That is the
"own wallet, own vault" the founder described, and it is a contract plus an audit, not a weekend.
