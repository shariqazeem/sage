# Launch A — privacy rail + gigs, paired with a live campaign (ONE post, structured)

> Long-form, but written in beats with air between them. A thread's rhythm without the tap.
> ⚠ marks the one line that changes if the intent_hash event fix ships first.

---

Getting paid on-chain means publishing your salary.

Every payout writes a permanent, searchable line: this address earned this much, from this person, on this day. For a freelancer in a small market that isn't transparency. It's your income, public, forever, next to your name.

We kept meeting people who wanted the work and not the exposure. They shouldn't have to choose.

So we rebuilt how Sage pays.

Sage is an AI agent that checks someone's work and pays them for it — no application, no interview, no invoice. It now settles on Starknet, and the money never touches the worker's wallet.

The payout happens in two halves.

A Cairo vault releases the reward, bounded by rules the agent cannot exceed. The amount isn't even an argument it can pass — the vault looks it up from the mission itself.

Sage escrows that money against a Poseidon commitment. The worker collects it with a one-time link, wherever they choose. Including into a shielded note, where the amount is attributable to nobody.

We are now paying people through a commitment instead of an address — and they can now collect their earnings somewhere their balance is never linked to the work that produced it.

Two contracts do it.

SageVault enforces the funding ceiling and per-wallet replay, and answers a refused payout with a code rather than reverting, so the reason lands on-chain where the person refused can read it.
0x715ab98f0d29548209259a6283d1b1db317b07b4f16441b068c02eaa40ffa87

SageClaims holds the escrowed payout against poseidon(secret) and never learns who you are. The claim leg is keyed by the commitment, not by the person. Refunds carry their own commitment and an expiry, so money can never be stranded.
0x6fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57

What we won't overstate.

The vault's spending is fully public — every amount, every mission, every decision digest, checkable by anyone. ⚠ What's private is the destination: the money doesn't land in your wallet, and where it goes next is yours alone.

Auditable in aggregate. Private in the destination.

It already runs without us.

An agent judged a real submission, released the reward, escrowed it, and minted the claim link with no human anywhere in the loop.

payout 0x2b03ed65…49fb
escrow 0x68ebf197…8af4

Both on Starknet mainnet. Both checkable right now.

This matters beyond crypto.

We're building toward MSME and gig-worker capital in the Caribbean, where the same person needs two things that normally contradict. A verifiable record of earning, or they can't access credit at all. And no public ledger of what they earn, or they aren't safe.

Most systems make you pick one. A credit file needs proof; privacy needs its absence.

Our answer is that the record is yours, and you decide who reads it. The vault proves the money moved. The commitment keeps your name out of it.

There's $10 USDC on the board right now to try it.

Do a short piece of real work, get paid privately, and write up what that was actually like — including the parts that were confusing. One reward per wallet, so it reaches as many people as possible.

Live on Starknet mainnet today, paying real USDC.

[self-reply, never in the body — in-body links cost 30-50% reach]
sagepays.xyz/marketplace
