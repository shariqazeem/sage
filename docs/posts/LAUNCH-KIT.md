# STRK20 launch kit — 31 Aug 2026

Everything ships today. Order matters: **campaign live → video → post.**

---

## 0. Launch the campaign FIRST (Telegram one-liner)

Say this to @sagedeputybot. The board must not be empty when the post lands.

> Launch a gig on Starknet: $1 to each of 10 people who publish a public page explaining how Sage's
> private payout works on Starknet — it must name both contracts, explain the two-step release then
> escrow flow, and include one specific thing that confused them or should be improved from actually
> going through it. One reward per wallet.

Then fund it at the planUrl. Confirm it shows on /marketplace with the "Starknet · private" chip
before posting.

---

## 1. LAUNCH POST (the main one — post today)

Getting paid on-chain means publishing your salary.

Every payout writes a permanent, searchable line: this address earned this much, from this person, on this day. For a freelancer in a small market that isn't transparency. It's your income, public, forever, next to your name.

We kept meeting people who wanted the work and not the exposure. They shouldn't have to choose.

So we rebuilt how Sage pays.

Sage is an AI agent that checks someone's work and pays them for it — no application, no interview, no invoice. It now settles on Starknet, and the money never touches the worker's wallet.

The payout happens in two halves.

A Cairo vault releases the reward, bounded by rules the agent cannot exceed. The amount isn't even an argument it can pass — the vault looks it up from the mission itself.

Sage then escrows that money against a Poseidon commitment, and the worker collects it with a one-time link, to any address they name. If their wallet is registered with the STRK20 pool, they can take it straight into a shielded note, where the amount is attributable to nobody.

We are now paying people through a commitment instead of an address — and they can now collect their earnings somewhere their balance is never linked to the work that produced it.

Two contracts do it.

SageVault enforces the funding ceiling and per-wallet replay, and answers a refused payout with a code rather than reverting, so the reason lands on-chain where the person refused can read it.
0x715ab98f0d29548209259a6283d1b1db317b07b4f16441b068c02eaa40ffa87

SageClaims holds the escrowed payout against poseidon(secret) and never learns who you are. The claim leg is keyed by the commitment, not by the person. Refunds carry their own commitment and an expiry, so money can never be stranded.
0x6fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57

Sage pays the gas to collect. A worker who holds no tokens, has never used Starknet, and whose account isn't even deployed can still be paid.

What we won't overstate: the vault's spending is fully public — every amount, every mission, every decision digest, checkable by anyone. What's private is the destination.

Auditable in aggregate. Private in the destination.

It already runs without us.

An agent judged a real submission, released the reward, escrowed it, and minted the claim link with no human anywhere in the loop.

payout 0x2b03ed65…49fb
escrow 0x68ebf197…8af4

Both on Starknet mainnet. Both checkable right now.

This matters beyond crypto. We're building toward MSME and gig-worker capital, where the same person needs two things that normally contradict: a verifiable record of earning, or they can't access credit at all — and no public ledger of what they earn, or they aren't safe.

Most systems make you pick one. A credit file needs proof; privacy needs its absence.

Our answer is that the record is yours, and you decide who reads it. The vault proves the money moved. The commitment keeps your name out of it.

There's $10 USDC on the board right now to try it. One reward per wallet.

[SELF-REPLY, never in the body — in-body links cost 30-50% reach]
sagepays.xyz/marketplace

---

## 2. CAMPAIGN POST (standalone — post TOMORROW, or to Starknet Discord/TG today)

Do not fire this at the same audience an hour after the launch post; you would be competing with
yourself. Different channel today, or same channel tomorrow.

$10 USDC is on the board, and it pays privately.

Sage is an AI agent that checks your work and pays you itself. No application, no interview, no invoice.

The task: publish a public write-up of how Sage's private payout works on Starknet. Name the contracts, explain the two-step flow, and tell us one thing that confused you or should be better. That last part is the one we actually want.

$1 each, one reward per wallet, ten people.

You'll be paid on Starknet, and the money won't land in your wallet — you collect it with a one-time link, to wherever you choose. Sage pays the gas, so you need nothing to start.

If you've wanted to see Starknet privacy do something other than move test tokens between two wallets you own, this is real work and real USDC.

[self-reply]
sagepays.xyz/marketplace

---

## 3. "Is this real?" reply

A payout that already happened, judged and released by the agent with no human in the loop:
payout 0x2b03ed65…49fb
escrow 0x68ebf197…8af4
Starknet mainnet. Check them yourself.
