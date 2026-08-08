# Citable page copy, ready to publish

The two content types that consistently earn AI citations and that sagepays.xyz has none of
(Growth Tip Sheet §3.3, Ops Manual Play 15). Written for extraction, not for cleverness:
question-style headings, the direct answer inside the first 60 words, verifiable numbers with
inline sources, short paragraphs.

**Not deployed.** These are public brand surfaces, so the founder reviews the wording before
they go live. Every claim below is checkable today; the two marked **VERIFY** are not ours and
must be confirmed against the primary source before publishing, because one wrong number can
earn a Community Note and a 60-80% reach penalty.

Naming rule applied throughout, per `docs/GEO-BASELINE.md`: never the bare word "Sage".

---

## Page 1 · `/vs/beta-testers` — "Sage vs hiring beta testers"

**Title tag:** Sage (sagepays.xyz) vs hiring beta testers: which gets you real feedback faster?
**H1:** Sage vs hiring beta testers

> **The short answer.** Hiring beta testers costs you the recruiting, the briefing, the chasing
> and the reviewing. Sage on GOAT Network does all four itself: it browses your product in a
> real browser, writes the missions from what it saw, checks each tester's report against its
> own observations, and pays them in USDC automatically. You approve the plan and fund it. That
> is the entire human involvement.

### How is this different from a testing marketplace?

A marketplace gives you testers and hands the work back to you. You still write the brief, read
every submission, and decide who gets paid. Sage writes the brief from first-hand observation
and makes the payment decision itself, and every decision publishes a receipt at
`/proof/<txHash>` that is recomputed from the chain each time it loads rather than read from a
stored flag.

### What stops the AI from paying out badly?

The agent proposes and a smart contract disposes. Each campaign's budget sits in an on-chain
vault that derives the exact reward, enforces the per-mission cap and the completion limit, and
rejects anything outside them. No model output moves money on its own, and Sage never holds
your keys. A tester's report must quote things Sage itself observed; a mission whose evidence
cannot be checked is discarded before anyone is shown it.

### What does it cost?

You set the budget. Rewards are derived from it deterministically, so the sum of every possible
payout equals exactly what you funded. Money that is never claimed is recoverable: stopping a
campaign revokes the vault and returns the balance on-chain.

### Do I need a wallet?

No. `@sagedeputybot` on Telegram runs the whole loop walletless. It creates a server wallet
bound to a spending policy and funds the campaign from it, so you never connect anything or
leave the chat. Or use sagepays.xyz with a browser wallet if you prefer.

### Honest comparison

| | hiring beta testers | Sage (sagepays.xyz) |
|---|---|---|
| who writes the test plan | you | the agent, from browsing your product |
| who reviews submissions | you, every one | the agent, against what it observed |
| who decides payment | you | the vault, within limits it cannot exceed |
| proof of payment | your word | an on-chain transaction and a receipt page |
| setup time | days | about 90 seconds to a live plan |
| where it runs | anywhere | GOAT Network mainnet, in USDC |

**Where hiring people is still better:** deep exploratory testing by a domain expert, anything
requiring judgement about taste, and any flow that genuinely needs credentials Sage must never
ask a tester to share. Sage is narrow on purpose.

---

## Page 2 · `/vs/bug-bounty` — "Sage vs a bug bounty"

**Title tag:** Sage (sagepays.xyz) vs a bug bounty: paid testing versus paid vulnerabilities
**H1:** Sage vs a bug bounty

> **The short answer.** A bug bounty pays for security vulnerabilities, after someone finds one,
> at a price you negotiate. Sage pays for verified evidence that ordinary user journeys work or
> do not, at a price fixed before anyone starts. They solve different problems, and most
> pre-launch products need the second one first.

### When is a bug bounty the right tool?

When your product holds funds or sensitive data and you need adversarial security research.
Bounties are unbounded by design, which is the point: you cannot know in advance what a
researcher will find or what it is worth.

### When is paid testing the right tool?

When you need to know whether a first-time visitor understands what your product is and can
reach the thing it is for. That is a bounded, describable job, which is why it can be priced up
front and judged mechanically.

### How does the judging actually work?

Sage browses the product before any tester does, and keeps a private record of what it saw.
A tester's account is checked against that record. Because the corpus is built from Sage's own
observation and pinned before the mission is published, an answer cannot be reverse-engineered
from the page, and there is deliberately no live feedback before a submission is judged.

---

## Page 3 · `/faq` — with FAQPage schema

Built from the questions people actually ask. Add rows as they arrive; every repeated question
in a group chat is a missing FAQ entry (Tip Sheet §5).

**Q: What is Sage at sagepays.xyz?**
An AI agent that turns one product URL and one budget into paid user-testing missions, then
pays human testers in USDC for verified evidence. It runs on GOAT Network and is registered
on-chain as ERC-8004 agent #79.

**Q: Who pays the testers?**
The agent does, autonomously, out of a campaign vault the founder funded. Each payout is a
transaction with a public receipt at `/proof/<txHash>`.

**Q: Can the AI overspend?**
No. The vault holds the budget and computes the reward itself. It enforces the per-mission cap,
the completion limit and replay protection, and rejects anything outside them, whatever the
model proposes.

**Q: Do I have to review submissions?**
No. That is the product. Sage judges each report against its own observations and pays the
genuine ones. Work it cannot verify is held rather than guessed at.

**Q: Do I need a crypto wallet to launch a campaign?**
No. `@sagedeputybot` on Telegram is fully walletless.

**Q: What if my product is behind a login or a Connect Wallet screen?**
Sage inspects everything it can reach, and when a wall stops it, it reads the product's own
documentation to understand what is behind it, then designs missions for a tester who has their
own account. It will never ask a tester for credentials, a seed phrase or a private key.

**Q: How long does an inspection take?**
Usually about 90 seconds to a live plan you can read, and you watch the browsing happen on
screen while it works.

**Q: What does Sage not do?**
It is not a bug bounty, a generic agent platform, or a chatbot. It turns one product and one
budget into paid, verified testing, and it is judged on whether the payouts hold up.

### Schema to embed (FAQPage, JSON-LD)

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is Sage at sagepays.xyz?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "An AI agent that turns one product URL and one budget into paid user-testing missions, then pays human testers in USDC for verified evidence. It runs on GOAT Network and is registered on-chain as ERC-8004 agent #79."
      }
    }
  ]
}
```

Repeat the `Question` object for each Q above. Add `Article` schema to the two comparison pages
and an `author` to all three.

---

## Facts used, and where each is checkable

| claim | source |
|---|---|
| ERC-8004 agent #79 on GOAT Network | on-chain registration |
| receipts at `/proof/<txHash>`, recomputed from chain on load | the live proof route |
| autonomous payout of $1 USDC on GOAT mainnet, 29 Jul 2026 | tx `0x8df776…0069` |
| unclaimed budget recoverable by stopping a campaign | revoke tx `0x5b0f7…`, $2 recovered |
| walletless Telegram via a policy-bound server wallet | `@sagedeputybot`, live |
| listed on OKX.AI as agent #9211, keyless MCP at `/mcp/public` | the live endpoint |

**VERIFY before publishing** (not our data, quoted from third-party reporting found during the
GEO baseline, and unconfirmed against a primary source):
- "AI agents settled over $73M on-chain between May 2025 and April 2026"
- "98.6% of AI agent payments settled in USDC"

Either confirm both against the original source or cut them. A statistic lifts AI citations by
roughly a third, but only a true one is worth publishing.
