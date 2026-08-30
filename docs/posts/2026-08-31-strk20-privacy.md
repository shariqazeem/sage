# Post 1 — the privacy launch (ONE post, premium long-form)

> Threads hide behind a tap. One post that stands on its own gets read.
> Accuracy: written for what is TRUE TODAY. `PayoutReleased` still emits the worker's address as an
> indexed key, so the approval record is public even though the money is not. The line marked ⚠
> is the one that changes if the intent_hash event fix ships first.

---

Getting paid on-chain means publishing your salary.

Every payout writes a permanent, searchable line: this address earned this much, from this person, on this day. For a freelancer in a small market that isn't transparency — it's your income, public, forever, next to your name. We kept meeting people who wanted the work and not the exposure, and had to choose.

So we rebuilt how Sage pays.

Sage is an AI agent that checks someone's work and pays them itself — no application, no interview, no invoice. As of today it settles on Starknet, and the money never touches the worker's wallet.

The payout happens in two halves. A Cairo vault releases the reward, bounded by rules the agent cannot exceed — the amount isn't even an argument it can pass, the vault looks it up from the mission itself. Sage then escrows that money against a Poseidon commitment, and the worker collects it with a one-time link, wherever they choose. Including into a shielded note, where the amount is attributable to nobody.

We are now paying people through a commitment instead of an address, and they can now collect their earnings somewhere their balance is never linked to the work that produced it.

Two contracts do it:

SageVault — enforces the funding ceiling and per-wallet replay, and answers a refused payout with a code rather than reverting, so the reason lands on-chain where the person refused can read it.
class 0x715ab98f0d29548209259a6283d1b1db317b07b4f16441b068c02eaa40ffa87

SageClaims — holds the escrowed payout against poseidon(secret) and never learns who you are. The claim leg is keyed by the commitment, not by the person. Refunds carry their own commitment and an expiry, so money can never be stranded.
0x6fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57

What we won't overstate: the vault's spending is fully public. Every amount, every mission, every decision digest, checkable by anyone. ⚠ What's private is the destination — the money doesn't land in your wallet, and where it goes next is yours alone. Auditable in aggregate, private in the destination.

It already runs without us. An agent judged a real submission, released the reward, escrowed it and minted the claim link with no human anywhere in the loop — payout 0x2b03ed65…49fb, escrow 0x68ebf197…8af4, both on Starknet mainnet, both checkable right now.

This matters beyond crypto. We're building toward MSME and gig-worker capital in the Caribbean, where the same person needs two things that normally contradict: a verifiable record of earning, or they can't access credit at all — and no public ledger of what they earn, or they aren't safe. Most systems make you pick. A credit file needs proof; privacy needs its absence. Our answer is that the record is yours and you decide who reads it: the vault proves the money moved, the commitment keeps your name out of it.

Live on Starknet mainnet today, paying real USDC. Missions land this week.

[self-reply, never in the body — in-body links cost 30-50% reach]
sagepays.xyz
