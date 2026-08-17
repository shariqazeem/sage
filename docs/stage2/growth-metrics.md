# Sage — Stage 2 growth metrics

*OpenClaw Summer Builder Bootcamp · compiled 16 Aug 2026*

Every number here is either a transaction on GOAT Mainnet or a row in the production database.
Nothing is self-reported by the agent, and each figure names where it comes from so it can be
re-derived.

> Target status is stated in [`product-growth-report.md`](./product-growth-report.md), measured
> against the Growth Metrics Proposal submitted at the start of Stage 2. **Status: MET.**

---

## Headline

| Metric | Result | Source |
|---|---|---|
| **USDC settled to external testers** (north star) | **$47.55** | settlement journal, operator wallets and testnet excluded |
| Autonomous payouts, GOAT Mainnet | **20** | settlement journal + on-chain tx |
| Distinct external wallets paid | **15** | submissions, operator wallets excluded |
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

## Seed users — measured against our own definition

The Seed User Definition submitted at the start of Stage 2 names **two matched groups**. Reported
here in those terms rather than as one undifferentiated count.

### Supply side — *"crypto-curious people who already hold a wallet… reachable through builder communities… who convert because the payout is real and provable"*

| | Count | Identified by |
|---|---|---|
| Submitted at least one piece of evidence | **31** | wallet, bound by signature |
| **Activated — completed a first paid mission** | **15** | recipient wallet + public settlement transaction |
| Left written feedback with a contact | **13** | the handle they chose to leave |

They arrived exactly where the definition predicted: builder groups and X. And the mechanism the
definition predicted is what recruited them — the second campaign filled ten slots in under six
hours *after* the first campaign's proof pages were public.

### Demand side — *"early, crypto-native builders shipping a product who need honest signal"*

| Founder | Product | State |
|---|---|---|
| Areej / ClawUp | clawup.org | Campaign run, 4 testers paid, 2 defects returned |
| Zainab / TokenWatcher | AI API cost tracker | Onboarded, campaign in progress |
| Aporix | LLM token-cost reduction | In progress |
| Triage | Crypto tax forensics | In progress |

| | Count |
|---|---|
| Founders engaged | **4** |
| **Activated — funded their own campaign** | **0** |

**Total activated seed users: 19** (15 testers + 4 engaged founders), inside the 10–20 band.

**The honest gap:** founder activation was defined as *"a founder's first funded campaign"*, and no
external founder has reached it — every campaign so far has been funded by us. Supply behaved as the
definition predicted; demand is slower and heavier than we assumed. That asymmetry is the real
constraint on the north star, and closing it is the first job after Stage 2.

### Validated assumption — strangers do real work for small USDC

Four ClawUp testers independently reproduced the same channel-credential map (Telegram → Bot Token;
Feishu → App ID + Secret; Slack → xoxb + xapp), the deployment state sequence, and the exact pairing
command. Two pasted their agent's own reply, and the two replies were unrelated — which is also how
the anti-copy check cleared them.

### Corrected assumption — feedback arrives as the work, not as a reply

Zero of four paid ClawUp testers responded to a request for feedback afterwards, which we first read
as "paid testers won't give feedback". Wrong: all eight had written detailed feedback inside their
submissions — pairing commands, credential shapes, deployment states, a resend button with no
countdown. We had built no screen showing a founder what the people they paid had written, and
mistook that silence for absence.

Both halves are now fixed: feedback is the paid work on newer campaigns (13 submissions followed),
and the founder console shows every account, including held and refused ones.

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
