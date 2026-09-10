# ETHOnline 2026 · Continuity Track · Sage on Arc

**Bounty:** Arc — Best DeFi or Agentic Application (Continuity). Also entered: nothing else; one category, done well.

## Project description (short)

Sage is an AI agent that moves money on verified work. A founder funds one account; the agent designs
paid work, verifies every deliverable, refuses fraud, and pays people in USDC from a vault it cannot
exceed. It has already paid real people on GOAT mainnet (41 payouts) and on Starknet (13, on the
private rail). For ETHOnline it moved its default rail to **Arc**: one account on Arc that anyone can
fund from anywhere — USDC from any wallet or exchange, or bridged in from Ethereum, Base or Arbitrum
through Circle's App Kit over CCTP v2 — and the agent launches, pays and settles from it, on the chain
where USDC is the gas. Withdraw to any address through a one-time permit that re-locks to the mandate.

## What is new for the hackathon (the continuity delta)

- Arc as the default EVM rail: registry entry, factory deployed, operator, gas semantics (USDC is gas —
  the BTC gas stipend problem is gone), Privy signing for the wallet's own chain.
- The account (`/workspace/account`): a Privy-held wallet on Arc under the on-chain mandate; fund with a
  QR/address, **bridge in from other chains with Circle's App Kit (CCTP v2, forwarder destination)**,
  live balance, activity read from Arc's explorer, withdraw to any address.
- The full loop proven on Arc testnet, unattended: the agent launched a gig from the account (four
  signatures inside the mandate), a worker was judged and paid on Arc, the founder withdrew.
- Landing, docs (`/docs/arc`) and receipts speak Arc; GOAT's history is kept behind an explicit choice.

## How it's made (Circle / Arc tooling)

- **Arc** (chain 5042002): our `CampaignVaultFactory` at `0xfAc019eF6d8B36FE33233244ff0b97f0D9e99B8c`; USDC native gas + the ERC-20 face at `0x3600…0000`.
- **App Kit** (`@circle-fin/app-kit`, `@circle-fin/adapter-viem-v2`): `kit.bridge({ from: {adapter, chain}, to: { chain: "Arc_Testnet", recipientAddress: account, useForwarder: true } })` — the founder signs only on the source chain; Circle's forwarder mints on Arc into the account.
- **CCTP v2** underneath the kit (Arc domain 26).
- **Arc explorer (Blockscout)** for the account's token-transfer history.
- **Privy** server wallets + policies for the account and the mandate; **viem** for everything on chain.

## Programmable money flows (what the judges asked for)

- Conditional payments: the vault pays only on the agent's verified decision, and only the reward the
  vault itself derives.
- Multi-step settlement: milestone grants released per milestone; escrow legs; an advance repaid by
  waterfall from the next payout.
- On-chain automation: the standing mandate decides *where* to buy work, never *how much*; the vault
  enforces caps and replay protection; every payout publishes a receipt.

## Links

- Live: https://sagepays.xyz · the account: https://sagepays.xyz/workspace/account (sign in)
- Docs: https://sagepays.xyz/docs/arc · architecture: `docs/ethonline/architecture.png`
- Repo: https://github.com/shariqazeem/sage (branch `arc` merged to `main` on 11 Sep)
- Receipts on Arc testnet: see the README's Arc table (factory, funding, launch ×4, payout, withdrawal)
- Video: (add the link)

## Mainnet by 30 September

Arc mainnet opens 16 September. The plan: deploy the factory on mainnet, add the mainnet registry entry
(`ARC_*` env), fund the operator with USDC on Arc, and run one real gig with real USDC — the same
account, mandate and receipts. The Bridge Kit gains the Arc mainnet identifier with Circle's release.
