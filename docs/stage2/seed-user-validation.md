# Sage — Seed User Validation Report

*OpenClaw Summer Builder Bootcamp · Stage 2 · compiled 19 Aug 2026*

Every number in this report resolves to a transaction on GOAT Mainnet (chain 2345) or a row in
the production database, and each section names where its figures come from so they can be
re-derived. Nothing here is self-reported by the agent.

Measured against the **Seed User Definition** submitted at the start of Stage 2, which defined two
matched sides: **founders** who need real product testing without handing over keys or a card, and
**testers** who want real money for small, concrete tasks.

---

## Summary

| | |
|---|---|
| Distinct testers who submitted paid mission work | **33** all-time · **20** in the Stage 2 seed window |
| Distinct testers who received real USDC | **18** wallets |
| Autonomous payouts | **22** · 20 on GOAT Mainnet, 2 on Metis Sepolia |
| **USDC settled on mainnet** | **$48.10** across 16 wallets |
| Submissions judged | **42** — 22 paid, **20 refused (48%)** |
| Written feedback through the widget | **15 messages from 13 distinct people** |
| Products the agent inspected | **68** distinct URLs (733 inspection jobs) |
| Defects found by real users and fixed | **9** (traced to commits below) |

Two independent evidence channels each clear the 10–20 seed user requirement on their own: **20
distinct wallets** that did paid work, and **13 distinct contacts** that wrote in through the
widget. Wallets and email/social contacts are separate identifier spaces and we cannot prove
whether any person appears in both, so we report them separately rather than summing them.

---

## 1. Seed users, tracked per campaign

The two Stage 2 campaigns are reported separately, as requested. There is **no wallet overlap
between them** — every tester in one is a different person from every tester in the other.

### Campaign A — Testing campaign · sagepays.xyz

`launch-sagepays-xyz-w6ynbw` · GOAT Mainnet · vault [`0xC2c6a90c…D5c9`](https://explorer.goat.network/address/0xC2c6a90c910BD78c037ae9eE11808a01f1deD5c9)

| | |
|---|---|
| Distinct testers who submitted | **14** |
| Paid | **10** |
| Refused | 4 |
| Reward per mission | $2.50 USDC |
| **Total settled** | **$25.00 USDC** |
| Window | 16 Aug 2026, 03:50 → 04:36 UTC |

**The campaign paid ten strangers in 45 minutes**, with no human approving any of the ten
payments. This is the single strongest supply-side result of Stage 2: it establishes that the
constraint on Sage is budget, not tester availability.

This is also the campaign where testers were asked to use Sage itself, which is why it produced
most of the widget feedback in section 3 — the mission report and the feedback message are two
independent records of the same session.

### Campaign B — Testing campaign · clawup.org

`launch-clawup-org-tf62c8` · GOAT Mainnet · vault [`0xa3BFc35a…1537`](https://explorer.goat.network/address/0xa3BFc35a5eB2c1B52Ee9dcCb84d9a80380211537)

| | |
|---|---|
| Distinct testers who submitted | **6** |
| Mission reports filed | **8** |
| Paid | **4** |
| Refused | 4 |
| Reward per mission | $5.263165 USDC |
| **Total settled** | **$20.00 USDC** |
| Window | 14 Aug 2026, 05:34 → 07:23 UTC |

Missions were *Create Your First ClawUp Agent and Chat With It* and *Connect a Messaging Channel to
a Fresh Agent* — so every tester in this campaign signed up for ClawUp, created a working agent,
and connected a live messaging channel to it. Their verbatim reports are in
[`feedback-log.md`](./feedback-log.md).

> **Note on the "8 ClawUp testers" figure.** Eight *mission reports* were filed on this campaign,
> from **six distinct wallets** — two testers completed both missions. Both readings are correct;
> we state both rather than picking the flattering one.

### Earlier campaigns (Stage 2 window, pre-seed)

| Campaign | Chain | Paid | Each | Total |
|---|---|---|---|---|
| `founding-testers` | GOAT | 2 | $0.50 | $1.00 |
| `launch-yara-garden-cerk8k` | GOAT | 1 | $1.00 | $1.00 |
| `launch-yara-garden-6qfuo7` | GOAT | 1 | $0.50 | $0.50 |
| `launch-yara-garden-8frabo` | GOAT | 1 | $0.50 | $0.50 |
| `launch-yara-garden-btynnl` | GOAT | 1 | $0.50 | $0.50 |
| `launch-yara-garden-343gb2` | Metis Sepolia | 1 | $1.00 | $1.00 |
| `xS-R5fmJro` | Metis Sepolia | 1 | $0.50 | $0.50 |

Full transaction-by-transaction ledger with proof links: [`payout-ledger.md`](./payout-ledger.md).

---

## 2. The refusals — 20 of 42

Half of what was submitted was **not** paid. This matters more than the payout count: an agent that
can only say yes is not judging anything. Every refusal carries a written reason, and every reason
is honest about whether it reflects on the tester's work.

| Reason given | Count |
|---|---|
| Campaign ended, budget fully paid out — *"Not a judgement on your work"* | 9 |
| Mission filled up before this submission could be released | 7 |
| Founder stopped the campaign and withdrew before judging | 2 |
| Wallet already paid on a one-payout-per-wallet campaign | 1 |
| Stale pre-launch test submission | 1 |

**The distribution of these reasons is itself a finding**, and it drove the largest batch of product
changes in Stage 2 (section 5). Before those changes, testers in the first three rows received no
explanation at all — they simply waited forever. The honest reason strings above are the shipped fix.

---

## 3. The feedback widget — 13 distinct people

15 messages from 13 distinct contacts (excluding our own self-tests). Every message is attributable:
mid-Stage 2 we made a contact field **mandatory on every surface the button appears on**
(`7810f18`, `734d020`), precisely so that validation evidence could not be anonymous.

Representative verbatim messages, unedited:

> "It was super easy and fun to use. I truly think anyone can do it." — Arieltro78@gmail.com

> "Sage successfully opened www.blood-strike.com and mapped 12 different visual states across the
> game homepage. It captured the news section and featured character artwork accurately during
> exploration before proceeding to draft missions." — udemetreasure@gmail.com

> "Sage successfully loaded arenabreakout.com and correctly identified the 'Level Infinite Pass'
> registration/login popup. It did a great job mapping 15 different states and capturing the email
> verification flow during the exploration phase." — tylerevoux@gmail.com

> "The AI agent successfully loaded the initial webpage and mapped the basic layout, but it got
> stuck during the 'Designing testing missions' stage for over 20 minutes before restarting."
> — simonakobi5@gmail.com

> "Sage called the platform Fantry when it's actually Pantry. And the task for yesterday was a bit
> too basic. The budget segment was on point." — femirichard144@gmail.com

> "The launch form was nice, the budget step was easy to understand, the feedback panel zooms in on
> mobile if that's intended… (by on mobile I meant iOS Chrome browser)" — ms0dev@proton.me

> "It didn't go through saying 'Sage couldn't finish this one — Sage's reviewer returned an unusable
> response.'" — @brendajiggy

> "Sage failed to complete the inspection for www.jumia.com.ng and returned an error stating that
> the reviewer returned an unusable response." — promicom1@gmail.com

The complete log, including the long structured walkthrough left by @Samirahcheni, is in
[`feedback-log.md`](./feedback-log.md).

---

## 4. The original assumptions, tested

Stated verbatim from the Seed User Definition submitted at the start of Stage 2, with an honest
verdict on each.

### ✅ "Testers want small, fast, genuinely real USDC for well-defined tasks, not points and not 'maybe later'."

**Validated, decisively.** 33 distinct people submitted real mission work; 18 received real USDC. A
$25 campaign filled and paid out completely in 45 minutes. Nothing about the supply side is
speculative any more.

### ✅ "Founders get verified evidence back rather than noise, because every submission is judged."

**Validated.** 48% of submissions were refused. Each payout cites the exact evidence it read, and
each refusal names its reason. The mission reports in `feedback-log.md` are specific enough to act
on — testers named real UI states, real error strings, and real timings.

### ✅ "They are reachable in bulk through a single builder group or testing community."

**Validated.** Both campaigns filled from existing builder communities without paid acquisition.

### ⚠️ "Founders never hand over keys or a card, because the vault caps every payout on-chain."

**Built and proven, not yet validated by an external founder.** The mechanism works end to end on
mainnet — vaults deploy, fund, cap, settle, and withdraw. But no founder outside our own wallet has
yet funded their own campaign, so the *claim about founder psychology* remains untested. We state
this plainly rather than counting our own campaigns as founder activation.

### ⚠️ "The public proof receipt is the referral."

**Partially validated.** Every payout produces a public `/proof/<tx>` page and testers do share
them, but we did not instrument referral attribution, so we cannot put a number on how many testers
arrived through a receipt. Counted as a learning, not a result.

### ✅ "The walletless Telegram path lowers the bar to 'message a bot, name your product and a budget'."

**Validated technically.** The full fund→launch loop is proven on GOAT mainnet through Telegram,
with 29 distinct conversations handled by the concierge. Adoption of that path is early.

---

## 5. What we changed because of users

This is the trail from real user → identified issue → shipped fix. Every row names the commit.

| What a user hit | Fix | Commit | Status |
|---|---|---|---|
| Two testers reported *"the reviewer returned an unusable response"* on real inspections | The model's reply was wrapped in a markdown fence, and our parser treated a fence as malformation. The grounded planner had been dead for two days. | `5f9c16e`, `a00cd5f`, `d8c245e`, `c911cae` | **Fixed** |
| Four testers waited indefinitely on submissions that could never pay — the campaign had ended | Terminal campaigns now resolve every dependent submission with an honest written reason instead of leaving it pending forever | `2bab8c5` | **Fixed** |
| Testers submitted to missions whose slots were already gone | The slot check now runs *before* judging, and an invitation to retry holds the tester's place | `f033d73`, `96d33dc` | **Fixed** |
| 239 hold notifications fired for 4 submissions | A hold is a state, not an event | `9404e3e` | **Fixed** |
| A $5 campaign paid one tester and stranded the rest | A $0.50 reward floor, so a small budget pays several people | `dc3a31f` | **Fixed** |
| Founders could not see what the testers they paid had actually written | The founder console *is* the tester reports now | `d8e5752`, `1a52a5a`, `337fe05` | **Fixed** |
| "Explore live missions" on the landing page pointed at a campaign that filled weeks ago | Points at live work only | `f323265` | **Fixed** |
| Payouts could be broadcast against a stale chain head or a broken gas estimate | Never sign a payout against a chain we cannot show is current; never broadcast at the bare estimate | `305b47c`, `2f9c442`, `48cb4ad` | **Fixed** |
| A retried inspection re-ran the whole pipeline and billed twice | One retry, and the sweep's LLM upgrade retry is bounded | `e47342c`, `88c3fff` | **Fixed** |
| Feedback arrived with no way to reach the person | Contact required on every feedback surface | `7810f18`, `734d020` | **Fixed** |

### Still open — reported by users, not yet fixed

Listed because a validation report that claims everything was fixed is not a credible one.

| Issue | Reported by | Why it is still open |
|---|---|---|
| Mission design hung ~20 minutes before restarting | simonakobi5@gmail.com | Reproduced; the fix touches the mission brain, which requires a full P-GEN matrix run before deploy |
| Product name misread — "Fantry" for "Pantry" | femirichard144@gmail.com | Confirmed. Name extraction needs to prefer the rendered brand mark over the URL slug |
| Feedback panel zooms in on iOS Chrome | ms0dev@proton.me | Confirmed. Mobile Safari/Chrome remain untested surfaces |
| Reward weighting ignores effort | Internal, from tester time data | A 15-minute core-action mission paid $7.40/hr while a 5-minute homepage read paid $37.80/hr. Fix is scoped; it changes budget math, which is a frozen layer |

---

## 6. Key insights

**1. The constraint was never tester supply.** Ten strangers did paid work in 45 minutes. Every
model we had of "how hard will it be to find testers" was wrong in the optimistic direction. The
binding constraint is founder-side budget.

**2. The refusals are the product.** Building an agent that pays is easy. Building one that looks at
work and declines is the entire difficulty, and it is what makes a payout mean something. 48% is
not a failure rate — it is the evidence that judgment is happening.

**3. We mistook a missing screen for missing feedback.** We initially recorded "paid testers give no
feedback" as a finding. It was wrong. Their feedback had been inside their submissions the whole
time; we had simply never built a screen that showed a founder what the people they paid had
written. The lesson generalises: before recording an absence as a fact about users, check whether
you built the surface where it would have appeared.

**4. Users find defects that diffs cannot.** Every fix in section 5 was invisible in code review and
visible only when a real person used the product against a real URL. The two "unusable response"
reports uncovered a planner that had been dead for two days with a green test suite.

**5. Honest refusal text converts a dead end into a relationship.** Rewriting refusals to say *"this
is not a judgement on your work"* and to name the real cause is the cheapest trust intervention we
made all of Stage 2.

---

## 7. Supporting materials

| Evidence | Where |
|---|---|
| Verbatim mission reports + widget feedback | [`feedback-log.md`](./feedback-log.md) |
| Transaction-by-transaction payout ledger with proof links | [`payout-ledger.md`](./payout-ledger.md) |
| Growth metrics, measured against the submitted proposal | [`growth-metrics.md`](./growth-metrics.md) · [`product-growth-report.md`](./product-growth-report.md) |
| GEO content and engagement | [`geo-contribution.md`](./geo-contribution.md) |
| Public proof page for any payout | `https://sagepays.xyz/proof/<tx>` |
| Live campaign boards | `https://sagepays.xyz/missions` |
| Source, including every commit cited above | [github.com/shariqazeem/sage](https://github.com/shariqazeem/sage) |

Every payout above is independently verifiable on the GOAT Network explorer without our
cooperation. That is the point: none of it rests on our word.
