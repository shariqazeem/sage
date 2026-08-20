# Sage — Product Growth Report

*OpenClaw Summer Builder Bootcamp · Stage 2 · compiled 19 Aug 2026*

Measured against the Growth Metrics Proposal submitted at the start of Stage 2. Every figure
resolves to an on-chain transaction or a production database row; the full ledger is in
[`payout-ledger.md`](./payout-ledger.md).

---

## Target status: **MET**

> **The original target, verbatim:** *"Our first target is deliberately modest and real: one funded
> campaign with genuine payouts, then a steady rise in total USDC settled and in unique testers and
> founders, measured week over week."*

| | Target | Achieved | Status |
|---|---|---|---|
| Funded campaign with genuine payouts | 1 | **7** campaigns paid on GOAT Mainnet | **Met — 7×** |
| Rise in total USDC settled | week over week | $8.00 → **$47.55** in the final week | **Met** |
| Rise in unique testers | week over week | 3 → **15** paid, 31 submitted | **Met** |
| Rise in unique founders | week over week | see the honest gap below | **Partially met** |

---

## North star — total USDC settled to verified testers

> *"The one number that only moves when real money changes hands on-chain for real, verified work."*

| | |
|---|---|
| **Settled to external testers, GOAT Mainnet** | **$47.55** across **17** payouts |
| Unique external wallets paid | **15** |
| Including operator test wallets | $49.55 across 20 payouts |
| All chains including testnet | $51.05 across 22 payouts |

**The headline figure is $47.55.** It excludes every payout to a wallet we control and every payout
on a testnet, because the metric was defined as money that changed hands for real verified work.

Roughly **$45 of that $47.55 settled in the final 72 hours**, from two campaigns.

### Why the final week is flat

Settlement is **budget-constrained, not demand-constrained**, and the constraint is checkable: as of
19 Aug every campaign vault on GOAT Mainnet holds **0 USDC**. The two August campaigns paid out
their full budgets — $25.00 and $21.05 — and there is no unspent balance anywhere for the agent to
settle against.

The demand side did not slow down. Ten testers completed and were paid inside 45 minutes on 16 Aug,
and the tester contact list has grown since. What ran out was money, not people. We state this
rather than presenting the flat week as anything else.

---

## Acquisition & activation

| Metric (as defined at Stage 2 start) | Result |
|---|---|
| Campaigns created | **15** (12 on GOAT Mainnet) |
| Campaigns funded and paying | **7** |
| Unique testers submitting ≥1 piece of evidence | **31** |
| Tester activation — first paid mission | **15** |
| Founder activation — first funded campaign | **1** (the operator) |

**Founder activation is achieved as the proposal defined it** — *"a founder's first funded
campaign"* — and six distinct wallets have created campaigns. The honest qualifier is that the
funded ones are ours: no founder outside the team has yet funded a vault from their own wallet.
We state that rather than counting our own campaigns as outside demand.

### Demand-side pipeline, as of 20 August

Two live founder conversations, both inbound or from ecosystem outreach, both with the exchange on
record:

| Contact | Product | Where it stands |
|---|---|---|
| Builder from the GOAT Builder Hub | **AgentBazaar** — an agent-to-agent marketplace settling in USDC on GOAT, applying to the GOAT Builders grant | Priced a campaign for 10 and then 50 testers, agreed a matched-funding structure, decision pending |
| Inbound via X | Introducing founders from their own network | Terms agreed — a per-founder fee paid on-chain when a founder actually funds — and qualifying candidates |

Screenshots of both conversations accompany this report. Neither has funded yet, so neither is
counted in any figure above; they are recorded as pipeline, not as results.

---

## Engagement & quality

### Verification outcome mix

> *"That mix shows whether the agent is exercising judgment rather than rubber stamping."*

| Outcome | Count |
|---|---|
| Paid | **22** |
| Refused, with a written reason | **20** |
| Still pending or unresolved | **0** |

**48% of submissions did not result in a payout, and nothing is left unresolved.** As of 17 Aug
nine submissions were still sitting in a pending state; every one has since been closed with an
honest written reason naming the real cause — the campaign ended, the mission filled, or the
founder withdrew — rather than being left to expire silently. No tester is waiting on us. On the final campaign the split was measurable
against effort: every account of **293–1,457 characters was paid**, every account of **35–142
characters was held**, and no human made any of those calls. That is the metric doing exactly the
job it was chosen for.

### Time to payout

> *"A fast, provable payout is the core of the tester promise."*

| | |
|---|---|
| **Median, submission → settled transaction** | **175 seconds** |
| Payouts settled in under 90 seconds | **11 of 22** |
| Fastest | 15 seconds |
| Slowest | 3.7 days *(an early campaign held for manual review before autopilot was armed)* |

Under three minutes from a stranger submitting evidence to USDC arriving in their wallet, with no
human in the loop. Half of all payouts landed inside 90 seconds.

---

## Retention & expansion

| Metric | Result |
|---|---|
| Testers active in more than one campaign | **1** |
| Founders launching a second, larger campaign | **1** (the operator: $20 → $25) |
| Average budget per funded campaign | ~$7 across all; **$22.50** for the two real campaigns |
| Missions completed per paid tester | 1.1 |

**Retention is the least proven layer**, and honestly so: most testers arrived within the last 72
hours and have had one campaign to return to. The mechanism exists — the per-wallet cap is
per-campaign, so a paid tester is free to earn again on the next one — but the evidence does not
exist yet.

---

## Key learnings

### The receipt is the referral — confirmed

The second campaign filled **10 slots in under six hours** from a single post, after the first
campaign's payouts were public. The first took ten hours to fill four. The proof pages did the
recruiting, exactly as the proposal predicted.

### Feedback does not arrive as a reply — it arrives as the work

Zero of four paid testers on the first campaign responded to a request for feedback afterwards, and
we recorded that as an invalidated assumption: paid testers are not willing feedback sources.

**That reading was wrong, and finding out why was the most valuable thing Stage 2 taught us.** All
eight ClawUp testers had written detailed feedback — the exact pairing command, the three channel
credential shapes, the deployment state sequence, a code-verification timing, a resend button with no
countdown. It was in their submissions the entire time. Nobody was withholding anything. We had
simply built no screen that showed a founder what the people they paid had written, and then
concluded from that silence that the feedback did not exist.

Two changes came out of it:

1. **Feedback became the paid work itself** on the second campaign — a mission Sage can only settle
   after verifying the person used the product and reported on it. Result: **13 pieces of real
   feedback** in a few hours, four containing genuine bugs, two fixed and deployed the same day.
2. **The founder console now shows every tester's written account**, including submissions Sage held
   or refused. The feedback from the first campaign became readable weeks after it was given.

The lesson generalises past this product: *a metric reading zero is a claim about your instrument
before it is a claim about the world.*

### Small, real, fast beats large and promised — confirmed

Strangers did careful work for $2.50. Four testers independently reproduced the same credential map
and the same exact pairing command without seeing each other's work.

### Supply is easy; demand is the hard side — new

The proposal planned to seed supply first, and that worked better than expected: 31 testers arrived
from two posts. Founders are slower and heavier. **That asymmetry, not tester supply, is the real
constraint on the north star.**

---

## Still reachable before 21 August

Two gaps, both addressable in the remaining days, and both downstream of the same thing:

1. **One external founder funding their own campaign** — the missing activation event. Outreach is
   live with builders shipping on GOAT who need user-validation evidence for grant applications,
   which is the clearest case where a funded Sage campaign pays for itself.
2. **One tester completing missions in two different campaigns** — 18 paid testers exist with
   contact handles on file. They have nowhere to return to until a vault holds money again.

Neither changes the Met status of the original target. Both are the same constraint: with every
vault at zero, the agent has nothing to spend, and both gaps close the moment one does.

---

## Companion reports

| Report | Covers |
|---|---|
| [`seed-user-validation.md`](./seed-user-validation.md) | The 20 seed testers, tracked per campaign, and every defect they found |
| [`clawup-ecosystem-growth.md`](./clawup-ecosystem-growth.md) | The six ClawUp activations, the MCP server, and #ClawToTheTop |
| [`payout-ledger.md`](./payout-ledger.md) | Every payout, transaction by transaction |
| [`feedback-log.md`](./feedback-log.md) | Every word a real user wrote, verbatim |
| [`geo-contribution.md`](./geo-contribution.md) | Public content and engagement |
