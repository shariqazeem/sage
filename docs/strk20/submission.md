# Sage — STRK20 submission package

> Privacy hackathon, deadline Sun 7 Sep (submit Sat 6 with FC — never plan on the buffer).
> Assembled 2026-09-01. The narrative post is
> [`docs/posts/2026-08-31-strk20-privacy.md`](../posts/2026-08-31-strk20-privacy.md); this file
> is the judge-facing index: what is deployed, what each transaction proves, and the exact
> privacy claim — no more, no less.

## One paragraph

Sage is an autonomous paymaster: an AI agent that takes a budget and an outcome, verifies the work
people deliver, and pays them — on Starknet, privately. The organization's spend is public and
auditable (a vault with caps it cannot exceed, a receipt for every payout, a reason for every
refusal); the recipient's side is private: the vault releases each reward to Sage, Sage escrows it
behind a Poseidon commitment, and the worker opens it by a one-time link, into a public address or
straight into a shielded note, with the gas paid. No recipient ever signs to be paid. This is the
Request-for-Startups "private payroll and treasury disbursement" shape — aggregate public, per-
recipient private, paymaster-sponsored recipients — run by an agent instead of a payroll team, on
the open door as well as the closed one: on an open campaign the agent approves at once and settles
after a finalization window it uses to watch the wallet graph, revoking copies and clusters with the
reason written out.

**Auditable in aggregate. Private in the destination. Decided by the agent.**

## Contracts (Starknet mainnet, in `strk20.json`)

| Contract     | Address                                                             | Role                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SageVault`  | `0x715ab98f0d29548209259a6283d1b1db317b07b4f16441b068c02eaa40ffa87` | Enforces the funding ceiling + per-wallet replay; derives the reward from the mission (the amount is not an argument); answers a refused payout with an on-chain CODE so the refused person can read the reason       |
| `SageClaims` | `0x6fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57`  | Holds escrowed payouts against `poseidon(secret)` — keyed by commitment, never by person; refunds carry their own commitment + expiry so money cannot strand. 35 tests; eleven money guards each verified by mutation |

Class hashes and declare/deploy transactions: [README, "Live on Starknet mainnet"](../../README.md)
— one home for hashes, deliberately.

## The qualifying transactions, and what each proves

| Tx                  | Proves                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `0xb4a7cb07…0b735`  | The pool exists and is funded — escrow is real money, not an interface                                        |
| `0x74e73f29…164cb`  | A payout escrowed against a commitment — the worker's address appears nowhere in the leg                      |
| `0x6ec8165b…ca67a3` | A bearer claim collected — the link, not the identity, is the key                                             |
| `0x27653876…dbfe4` | The autonomous payout collected into a **shielded note** (`ClaimedPrivately`) — the only agent-decided one on the list |

And the loop with **no human anywhere in it**, both on mainnet, both checkable now:
autonomous payout `0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb`
(judged from the submitter's own words → vault released → escrowed → claim link minted).
Three Starknet payouts have settled to date — listed with the same prominence as every
other settlement on https://sagepays.xyz/explorer.

## The exact privacy claim

- **Private:** the destination. The money never lands in the worker's wallet; the claim leg
  is keyed by `poseidon(secret)`; where it goes next is theirs alone — including a shielded
  note.
- **Public, deliberately:** the vault's spending — every amount, mission, decision digest —
  because the credit story requires an auditable aggregate. A worker's _record_ is theirs to
  disclose: payout amounts on `/record/<wallet>` can be withheld by the wallet's owner
  (owner-gated), and the **floor attestation** lets them prove "lifetime verified income ≥ X"
  to a lender with their own signature — disclosure as a choice, wallet-signed, oracle-safe.
- **Declared (2 Sep):** the privacy vault class `0x6d5577…` — `PayoutReleased` and `PayoutRefused`
  are keyed by `intent_hash`, so the vault's approval record names nobody; declare tx
  `0x29abc18…fb87f`. New campaigns deploy from it. The three earlier vaults remain on the previous
  class; their escrow leg was already commitment-keyed.

## Why it matters (the sentence judges keep hearing from us)

A gig worker needs two things that normally contradict: a verifiable record of earning, or
no access to credit — and no public ledger of their income, or no safety. Sage's answer:
the vault proves the money moved; the commitment keeps their name out of it; the record is
theirs, and they decide who reads it.

## What changed on 5 Sep (the agent turn)

- **The agent decides on every door.** On an open campaign it approves at once and settles after a
  30-minute finalization window in which it re-runs the near-duplicate, copied-artifact and
  wallet-cluster watch against everything that arrived since; a hit revokes with the reason on
  chain. Members-only work pays immediately. `src/lib/deputy/finalization.ts`.
- **Fund once.** A treasury — a Privy agent wallet under a mandate policy whose only reclaim address
  is the founder's own wallet — from which the agent deploys, funds and activates every approved
  plan itself. `src/lib/treasury/`.
- **No wallet to be paid, no signature to receive.** An email or a Telegram chat is the account;
  Sage keeps the wallet and pays the gas. The recipient opens the escrow by a one-time link, into a
  shielded note if they choose.
- **No plans, no seats.** Sage earns on what it settles.

## Inside companies (shipped 2 Sep)

The same private rail now runs **inside a company**: an employer hands gigs and grants to
its own people with "Only people I invite" — off every public board — and pays them through
the commitment-keyed escrow. A team's pay is neither a public ledger nor a public listing.

## The stranger-facing campaign (live 3 Sep)

`gig-1c3e_FjffE` — "Explain Sage's private payout on Starknet", ten paid slots, public. Its vault
`0x2394a632e74e60e8d46d5eda15dc6001d8a8b29dd1e93c25ee2ae0fcccb9770` is the first mainnet instance of
the declared privacy class; every settlement it makes keys its events by intent hash and names nobody.
Door: https://sagepays.xyz/c/gig-1c3e_FjffE · settlements: https://sagepays.xyz/explorer

## Live doors

Product https://sagepays.xyz · explorer `/explorer` · a real record `/record/<wallet>` ·
outcomes `/outcomes` · manifest [`strk20.json`](../../strk20.json) · X https://x.com/sagepaysai
