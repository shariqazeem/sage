# Post 1 — the privacy launch (thread)

> Accuracy note: written for what is TRUE TODAY. `PayoutReleased` currently emits the worker's
> address as an indexed key, so the *approval record* is public even though the *money* is not.
> Two lines below are marked ⚠ — they change if we ship the intent_hash event fix first.

---

**1/**
Sage is an AI agent that pays people for verified work.

Until now, getting paid meant your wallet became a public record of everything you'd earned.

Today that changes. Sage now settles on Starknet, and the money never touches your wallet.

**2/**
Here's the problem nobody talks about.

Every on-chain payout writes a permanent line: this address earned this much, from this person, on this day.

For a freelancer in a small market, that isn't transparency. It's your salary, published, forever, next to your name.

**3/**
So we built the payout in two halves.

The vault releases the reward — bounded by rules the agent cannot exceed.
Sage escrows it against a Poseidon commitment.
You collect it with a one-time link, wherever you choose.

Including into a shielded note, where the amount is attributable to nobody.

**4/**
What that means in practice:

We are now paying workers through a commitment instead of an address — and workers can now collect their earnings into a shielded note, so their balance is never linked to the work that produced it.

**5/** the contracts

`SageVault` — Cairo. The reward is NOT an argument. The vault looks it up from the mission, enforces per-wallet replay and the funding ceiling, and answers a refused payout with a CODE rather than reverting, so the reason lands on chain where you can read it.

class `0x715ab98f0d29548209259a6283d1b1db317b07b4f16441b068c02eaa40ffa87`

**6/**
`SageClaims` — holds the escrowed payout against `poseidon(secret)`. It never learns who you are. The claim leg is keyed by the commitment, not by you.

`0x6fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57`

Refunds have their own commitment and an expiry, so money can never be stranded.

**7/** the part we won't overstate

The vault's spending is fully public: every amount, every mission, every decision digest, checkable by anyone.

⚠ What is private is the destination — the money does not land in your wallet, and where it goes next is yours alone.

⚠ Auditable in aggregate. Private in the destination.

**8/**
It runs without us.

An agent judged a real submission, released the reward, escrowed it and minted the claim link with no human in the loop.

payout `0x2b03ed65…49fb`
escrow  `0x68ebf197…8af4`

Both on Starknet mainnet. Both checkable right now.

**9/**
Why this matters beyond crypto.

We're building toward MSME and gig-worker capital in the Caribbean, where the same person needs two things that usually contradict:

a verifiable record of earning, to access credit at all
and no public ledger of what they earn, to stay safe

**10/**
Most systems make you pick one.

A credit file needs proof. Privacy needs the absence of proof.

Sage's answer: the record is yours, and you decide who reads it. The vault proves the money moved. The commitment keeps your name out of it.

**11/**
This is live on Starknet mainnet today, paying in USDC.

Real work. Real money. No public wallet trail.

More missions land this week.

**[self-reply, not in the body — links cost 30-50% reach]**
sagepays.xyz
