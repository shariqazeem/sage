# Sage — Stage 2 growth metrics

*OpenClaw Summer Builder Bootcamp · compiled 16 Aug 2026*

Every number here is either a transaction on GOAT Mainnet or a row in the production database.
Nothing is self-reported by the agent, and each figure names where it comes from so it can be
re-derived.

> **Incomplete.** The Product Growth Report needs the original Stage 2 growth-metrics target to
> state Met / Not Met against. This document is the measured half.

---

## Headline

| Metric | Result | Source |
|---|---|---|
| Autonomous USDC payouts, mainnet | **22** | settlement journal + on-chain tx |
| Distinct external wallets paid | **16** | submissions, operator wallets excluded |
| Strangers paid in final 48h | **14** | clawup + sagepays campaigns |
| Distinct products inspected | **65** | `inspection_jobs`, unique product URL |
| Inspections completed to a plan | **570** of 722 | status = ready |
| Inspections, last 7 days | **197** | `inspection_jobs` |
| Campaigns funded with real USDC | **12** | campaigns on chain 2345 |
| External feedback submissions | **13** | feedback table, self-tests excluded |

Full ledger: [`payout-ledger.md`](./payout-ledger.md) · Full feedback: [`feedback-log.md`](./feedback-log.md)

---

## The two funded campaigns

### clawup.org — 13–14 Aug · $20 · 4 slots

Filled in **ten hours**. Four testers paid autonomously; four more submissions refused by the
fairness controls (one duplicate account at 96% text similarity, one wallet already paid, two
arriving after the slots filled).

Testers created ClawUp agents, connected messaging channels, and returned two genuine defects in
ClawUp itself — most notably a resend-code button with no countdown and no confirmation, reported
independently by two people.

### sagepays.xyz — 15–16 Aug · $25 · 10 slots

Filled in **under six hours** from a single X post (1.2K views). Ten strangers paid, each for
running a Sage inspection on a product of their choosing and reporting what the agent got right and
wrong.

The verification bar tracked effort almost exactly:

| Outcome | Account length |
|---|---|
| Paid (10) | 293 – 1,457 characters |
| Held (3) | 35 – 142 characters |

No substantive submission was held; no thin one was paid.

---

## Seed users — 21 identifiable

| Group | Count | How they are identified |
|---|---|---|
| Paid testers | 16 | recipient wallet + public settlement transaction |
| Feedback authors | 13 | the contact handle they left (required to submit) |
| Named builders | 4 | ClawUp (Areej), Aporix, Triage, TokenWatcher |

Groups overlap; distinct identifiable individuals total **21**, above the 10–20 band.

### Validated assumption — strangers do real work for small USDC

Four ClawUp testers independently reproduced the same channel-credential map (Telegram → Bot Token;
Feishu → App ID + Secret; Slack → xoxb + xapp), the deployment state sequence, and the exact pairing
command. Two pasted their agent's own reply, and the two replies were unrelated — which is also how
the anti-copy check cleared them.

### Invalidated assumption — unpaid feedback follows paid work

Zero of four paid ClawUp testers responded to a request for feedback afterwards. The second campaign
was rebuilt around that: feedback became the paid deliverable itself, and a contact handle became
mandatory. Thirteen feedback submissions followed.

---

## Product changes made from user feedback

| Reporter | What they found | Status |
|---|---|---|
| promicom1 | Inspection failed on jumia.com.ng — "reviewer returned an unusable response" | **Fixed** — mission reader now handles every output shape; re-tested on the same URL, completes in 181s |
| @brendajiggy | Same failure on origin.osero.org | **Fixed** — model output was valid but wrapped in prose |
| femirichard144 | Sage read the product name as "Fantry" instead of "Pantry" | Open |
| simonakobi5 | Mission design hung 20+ minutes before restarting | Open |
| ms0dev | Used Sage on iOS Chrome — a surface never tested | Open |
| esorvand | Thin account revealed the mission summary understated the task | Fixed in tester communications |
| ClawUp testers ×2 | ClawUp's resend-code button shows no countdown | Delivered to founder |

---

## What the agent does

A founder gives Sage a product URL and a budget. Sage opens the product in a real browser, uses it,
and designs paid testing missions from what it observed — then deploys a vault the founder owns and
pays testers USDC for verified evidence, inside limits the contract enforces and the agent cannot
exceed. A tester's written account is checked against what Sage saw for itself. Every payout is a
public transaction: the agent proposes, the vault disposes.
