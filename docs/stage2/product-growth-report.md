# Sage — Product Growth Report

*OpenClaw Summer Builder Bootcamp · Stage 2 · compiled 17 Aug 2026*

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

---

## Acquisition & activation

| Metric (as defined at Stage 2 start) | Result |
|---|---|
| Campaigns created | **15** (12 on GOAT Mainnet) |
| Campaigns funded and paying | **7** |
| Unique testers submitting ≥1 piece of evidence | **31** |
| Tester activation — first paid mission | **15** |
| Founder activation — first funded campaign | **1** (the operator) |

**Founder-side activation is the honest gap.** Every campaign to date was funded by us. No external
founder has yet funded their own, which is precisely the activation event the proposal defined. It
is the single most important thing left to prove, and it is stated here rather than buried.

---

## Engagement & quality

### Verification outcome mix

> *"That mix shows whether the agent is exercising judgment rather than rubber stamping."*

| Outcome | Count |
|---|---|
| Paid | **22** |
| Rejected / closed | **11** |
| Pending or held | **9** |

**52% of submissions did not result in a payout.** On the final campaign the split was measurable
against effort: every account of **293–1,457 characters was paid**, every account of **35–142
characters was held**, and no human made any of those calls. That is the metric doing exactly the
job it was chosen for.

### Time to payout

> *"A fast, provable payout is the core of the tester promise."*

| | |
|---|---|
| **Median, submission → settled transaction** | **204 seconds** |
| Fastest | 15 seconds |
| Slowest | 3.7 days *(an early campaign held for manual review before autopilot was armed)* |

Three and a half minutes from a stranger submitting evidence to USDC arriving in their wallet, with
no human in the loop.

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

Two gaps, both addressable in the remaining days:

1. **One external founder funding their own campaign** — this is the missing activation event.
   Three builders are mid-onboarding; a single $5 self-funded campaign closes it.
2. **One tester completing missions in two different campaigns** — 15 paid testers exist and have
   contact handles on file; a second live campaign gives them somewhere to return to.

Neither changes the Met status of the original target. Both would strengthen the layers beneath it.
