# OKX Dev Day 2026 — Builder Application (Sage)

> Copy-paste ready. Verified against prod + the live OKX listing on 2026-08-28.
> **Applications close 11 September 2026, 23:59 UTC.** Primary track: **OKX AI**.

---

## Verified facts (checked today, not remembered)

| Fact | Value | Source |
|---|---|---|
| OKX agent | **#9211 "Sage", ASP, active, "Listed — eligible for task recommendations"** | `get-my-agents` live |
| OKX sold count | **0** | same call |
| Products inspected | **54 distinct products**, 593 completed inspection runs | prod DB |
| Submissions judged | **51** | prod DB |
| Paid | **28 payouts · $52.60 USDC · 22 distinct earners** | prod DB |
| Refused | **23 → a 45% refusal rate**, zero human approvals | prod DB |
| AI agent paid | **1** — an autonomous agent earned $0.50 under the same rules as a human | tx `0xb01203…d827` |
| Bootcamp | **1st place**, OpenClaw Summer Builder Bootcamp (announced 26 Aug 2026) | @MetisL2 |

**Correction to the earlier draft:** it said 68 products / 42 judged / 22 paid / 20 refused / 48%.
Those numbers are stale. Use the table above. And "price the four services through x402" is not
future work — **that rail is already built and tested** (EIP-3009 `TransferWithAuthorization` on
X Layer 196 in USD₮0 `0x779ded0c…713736`, `src/lib/x402/okx.ts`). The services are listed at
`fee:"0"` because paid listing needs an **OKX Developer Portal API key** we do not have; their
facilitator returns `50103` without one. That is the single thing standing between agent #9211 and
revenue, and it is exactly what Dev Day's technical support unblocks. Say so plainly — it reads as
a builder who reached the wall, not one who never started.

---

## Application answers

### Country of residence
```
Pakistan
```

### Can at least one team member attend the live finale in Singapore on 6 October 2026?
**Yes**

### How many people on your team?
```
1
```

### Team name
```
Sage
```

### Tell us about your team. What is your background?

```
Solo founder, based in Lahore, Pakistan.

Sage is already live on OKX.AI as Agent #9211, an active listed ASP with four services. I built
that during an earlier OKX hackathon. I am coming back to Dev Day to turn a listing into a market.

Two days ago Sage took first place at the OpenClaw Summer Builder Bootcamp, built solo over eight
weeks and judged on Demo Day by Metis, GOAT Network and ClawUp. It is not a prototype. It runs on
mainnet with real users and real money: 54 different products inspected, 51 tester submissions
judged, 28 paid in USDC to 22 different people, and 23 refused. A 45% refusal rate, and no human
approved a single payment. Every payout is a public on-chain receipt. Full numbers and where to
verify them: https://sagepays.xyz/case-studies/autonomous-paid-testing and the live ledger at
https://sagepays.xyz/explorer

The result I care about most happened last week: an autonomous AI agent found one of Sage's paid
jobs through the public MCP endpoint, did the work, signed the same evidence claim a human signs,
was judged by the same verifier, and was paid $0.50 USDC. Receipt:
https://sagepays.xyz/proof/0xb0120330aba99dcf25d5aba913d1c8ecf341782653f1b20b4eaafa575155d827
An agent earned money from another agent's budget, under rules neither of them controlled.

Sage is also entering the Future Caribbean Buildathon under Finance, Payments and MSME Capital.

Before Sage I built KyvernLabs, an on-chain policy program for AI agents on Solana, where the
reference agent ran autonomously for 48 days and processed over 17,000 on-chain transactions under
continuous adversarial probing with zero losses. Seven hackathon wins in two years, including
second place at the x402 Solana Hackathon.

Stack: Solidity, TypeScript, Next.js, Node, Playwright for real-browser inspection, and Claude for
agent reasoning, across X Layer, GOAT Network, Metis and Solana. I already have the OKX x402 rail
implemented against X Layer and USD₮0 with EIP-3009 signed authorizations. I ship in two to four
week cycles and I attack my own systems in production. The 17 to 25 September window is exactly the
cycle I work in.
```

### What do you plan to build? Briefly describe the problem and your solution.

```
The problem is the one visible on my own OKX agent page. Agent #9211 says "Rating: No rating yet"
and "Sold: 0". Every agent marketplace has the same cold start: nobody hires an agent with no
history, and no agent gets history until somebody hires it. Reviews do not fix it, because a review
is a claim and claims are free. The missing primitive is proof of work actually delivered and
actually paid for.

Sage already produces that primitive. It is an autonomous agent that verifies work and pays for it.
A funder states a job in one sentence. Sage compiles it into missions with a machine-checkable
verification contract, funds an on-chain vault with hard caps it cannot exceed, then checks every
submission itself: it opens the product in a real browser, fetches the artifact the worker created,
or reads the chain. Work that verifies is paid in seconds. Work that does not is refused with the
reason on the record. No human approves anything. The 45% refusal rate is the product, not a flaw:
anyone can build an agent that pays, and building one that looks at work and says no is the entire
difficulty, because it is what makes a payment mean something.

Every earner then accumulates a public, receipt-anchored Verified Work Record with deterministic
credit signals: how many jobs verified, how many were refused, how many distinct funders, over what
period. Not a score I invented, published formulas over on-chain receipts. Example:
https://sagepays.xyz/record/0xccbfb9bba88f282282a29aa1338175cc835e768d

That record belongs to an AI agent, and that is the whole idea for Dev Day. For OKX I want to build
the trust layer for agent-to-agent commerce, in three parts:

1. Settlement on X Layer. The agent already lives on X Layer while payouts settle on GOAT. I move
   the payout vault to X Layer in USD₮0, so the agent and the money are finally on the same chain.
   The x402 rail for this is already implemented with EIP-3009 signed authorizations; arming the
   paid services is blocked only on an OKX Developer Portal API key, which is the concrete
   technical unblock I would use Dev Day support for.

2. Hiring in both directions. Today an OKX agent can buy Sage's services. I want any OKX agent to
   also be hired through Sage: take a posted job, deliver, be judged by the same evidence check as a
   human, and be paid on delivery. Sage has done this once already on GOAT; on X Layer it becomes
   native to the marketplace agents are already listed in.

3. Reputation that is earned, not claimed. Every verified job an agent completes writes to its
   public work record, queryable through Sage's API. That turns "Sold: 0, no rating" into a history
   another agent can check before transacting, and it is fully composable: any OKX agent, or OKX
   itself, can read it.

The end state is that two agents who have never met can transact on work neither of them has to
trust, because a third one verified it and the receipt is public. Sage stops being one agent selling
four services and becomes the verification, payout and reputation layer underneath the marketplace.
```

### Telegram username
```
[FILL IN — and join https://bit.ly/okx-dev-day]
```

---

## The 9-day build plan (17–25 September)

They said it plainly: *"working products, not pitch decks."* The hard part exists and is proven.
Nine days is for making it X Layer native and making it a market.

| Days | Ship |
|---|---|
| 1–2 | **Vault on X Layer.** Deploy the CampaignVault to X Layer 196, settle in USD₮0, run one real end-to-end payout. Closes the agent-and-money-on-different-chains gap. |
| 3 | **Arm the paid services.** With a Developer Portal key, flip `OKX_X402_PAY_TO` — the paywall and listing already read one price table, so this is a switch, not a build. First paid call from another agent = the revenue proof. |
| 4–5 | **Agents get hired.** An OKX agent takes a Sage job, delivers, is judged by the same verifier, is paid on X Layer. Agent-as-worker, not just agent-as-customer. |
| 6 | **Reputation API.** Verified work records queryable per agent wallet, so any OKX agent can check another's delivery history before transacting. |
| 7 | **Run a real campaign end to end through OKX.AI** — real jobs, real workers, real refusals, on X Layer. |
| 8 | **The watchable surface.** Live feed of payouts and refusals with reasons. Judges need to watch it decide, not read that it does. |
| 9 | Rehearsal, README, demo video, submission. |

### The demo (3–5 minutes)

Show two things live, back to back:

1. **A payout** — worker submits, Sage verifies against the real artifact, USD₮0 moves on X Layer,
   receipt in the explorer.
2. **A refusal** — a submission that does not clear, refused, with the reason it found.

**Lead with the refusal.** Everyone demos things working. Almost nobody demos their system
correctly saying no, and a room building agent payments knows instantly that it is the hard part.
Then put **45%** on the screen and stop talking.

The line worth saying out loud:
> "Anyone can build an agent that pays. Building one that looks at work and says no is the entire
> difficulty, and it's what makes a payout mean anything."

---

## Before you submit

- [ ] **Telegram username** in the form + join the TG group
- [ ] Ask OKX for a **Developer Portal API key** in the application or the TG group — it is the one
      blocker on revenue for agent #9211, and asking early may get it before the build window
- [ ] Case study + explorer links load: `sagepays.xyz/case-studies/autonomous-paid-testing`,
      `sagepays.xyz/explorer`
- [ ] Read both long answers out loud once
- [ ] Submit before **11 September 23:59 UTC**

## Travel — start now, book nothing

Finalists are confirmed **28–30 September** for a **6 October** finale. That is roughly six days.
Singapore visa processing for Pakistani passport holders goes through authorised agents and is not
same-day — verify the current requirement and turnaround with an authorised agent yourself, this
week, so the timeline is known rather than discovered.

- [ ] Passport valid 6+ months beyond 6 October
- [ ] Current visa requirement + processing time, from an authorised agent
- [ ] Supporting documents assembled (bank statements, founder proof, photos to spec)
- [ ] Flight prices known
- [ ] **OKX pays nothing** — travel, hotel, visa are yours
- [ ] **Do not book non-refundable travel** until OKX confirms your finalist place in writing

## Notes

- **Claude Code Singapore is a listed partner** and Sage runs on Claude. Worth one natural mention.
- **Do not hedge the numbers.** 54 products, 51 judged, 28 paid, 23 refused, 45%, zero human
  approvals, one AI agent paid. Every one is checkable on the live explorer.
- **If a judge asks what you got wrong:** last week Sage's own funding-graph check proved that four
  "different" testers on one campaign were one person rotating wallets — and that a payout I had
  publicly called an organic stranger was part of that cluster. Sage now detects it, and the
  write-up is public. Auditing your own measurements is rarer than shipping.
