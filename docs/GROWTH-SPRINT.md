# Growth Sprint · Aug 8–21

Building is paused. The next two weeks buy exactly three artifacts for Stage 2 (due Aug 21):
the **Product Growth Report**, the **Seed User Feedback Report (10–20 users)**, and the
**GEO Contribution Report**. Every action below feeds at least one of them.

**Seed user definition (write this into the report):** anyone who completes one real loop —
a tester who submits evidence on a funded mission, or a founder who runs an inspection of
their own product. Both are measurable in our DB; neither can be faked.

---

## Budget engineering ($50, stretch $100 only on evidence)

Small budgets absorb fully (fair rate ~$0.20/min, rewards ~$0.30–2.50); the per-wallet cap
of 1 payout per campaign means MORE campaigns = more people paid, not one person farming.
Money in an untouched vault is recoverable via stop (proven live).

| # | campaign | budget | goal to give Sage (engineered: stable facts, no volatile counts, wall-aware) |
|---|---|---|---|
| 1 | sagepays.xyz (dogfood) | $8 | "Verify a first-time tester can understand how earning works here, reach the marketplace, and open a mission board. Report what you actually saw." |
| 2 | clawup.org | $10 | "Verify a first-time visitor understands what ClawUp offers, how its pricing works, and can reach the start of agent creation." |
| 3 | www.goat.network | $8 | "Verify a newcomer can understand what GOAT Network is, learn that BTC is the gas token, and locate where to bridge or get started." |
| 4 | www.metis.io | $8 | "Verify a first-time visitor can understand what Metis offers builders and find how to start building on it." |
| 5 | SuperVega gift (his product, his campaign; we fund) | $10 | offered in DM; he sets the goal, we suggest: "Verify a trader can find the options beta, understand how an option is opened, and reach the trade screen." |
| — | reserve (double the best performer in week 2) | $6 | — |

Both target sites verified reachable via `sage_first_look` on 2026-08-08, no auth walls.
Launch 1–2 first (day 1), 3–4 on day 2–3, staggered so the marketplace never shows empty.
Rule: a campaign untouched for 4 days gets stopped and its budget reallocated.

---

## Week 1 (Aug 8–14): seed the board, then drive people at it

**Day 1 — the board is never empty again**
- Launch campaigns 1 + 2. Screenshot the live marketplace.
- @sagepaysai: campaign-live post (point 15 wording, cleaned): rewards, board link,
  "walletless from Telegram too."
- Personal: the "types of agents" take (point 13) quote-tweeting the campaign post.

**Day 2 — GOAT day**
- Launch campaign 3. Post from @sagepaysai tagging GOAT: testing on GOAT, paid in USDC on
  GOAT, receipts on-chain. Personal account quote-tweets with the builder angle.
- Send the Telegram-group message (template C) to GOAT/hackathon groups you're in.

**Day 3 — Metis day**
- Launch campaign 4. Same pattern tagging Metis.
- DM ellibenson (template A) and SuperVega (template B). Log send time.

**Day 4 — organizers**
- Ask 2–3 hackathon organizers (template D): "inspect your own product, it takes about 90
  seconds, tell me what it got wrong." Their own-product inspection is the demo AND a seed
  user event. Offer them a funded mission link so they can experience a payout.
- Personal: "every user is becoming a builder" story (point 12).

**Day 5–7 — follow-ups + the comment habit**
- Follow up unanswered DMs once, politely, never twice.
- Daily habit (point 11): comment under 2–3 fresh product launches from either account,
  short and specific, never copy-paste: "if you want paid beta testers on this, Sage can
  browse it and set up missions in a few minutes, happy to fund a small one."
- @sagepaysai: proof post — first payout receipt of the week with the /proof link.

**Every DM and reply ends with one question.** That's the feedback report filling itself.

## Week 2 (Aug 15–21): scale what moved, write the reports

- Double the best campaign with the reserve; stop the dead ones, recover funds.
- Second wave of DMs only to warm signals (likes, replies, opens).
- Aug 18–19: pull metrics from the DB (script below) and draft all three reports.
- Aug 20: Seed User Feedback Report — every submission note + every founder reply, verbatim,
  with what we changed because of it (we already fixed 11+ defects from live feedback; that
  IS the report's spine).
- GEO Contribution Report: OKX.AI listing live (agent #9211, 4 free services any agent can
  call), funded testing campaigns for GOAT + Metis + ClawUp ecosystem products, x402 rails
  on GOAT, ERC-8004 identity #79.

**Metrics query (run on the VM, feeds the Growth Report):** inspections by non-operator
founders, campaigns launched, submissions, payouts with tx hashes, marketplace payout total
— all in `var/sage.db`, all verifiable on-chain.

---

## DM templates (polite, concise, no hype; adjust names, never mass-send)

**A — ellibenson (warm, Starknet founder):**
> Hey, quick offer rather than a pitch. I built Sage, an AI agent that browses a product
> and turns it into paid testing missions, then verifies testers' work and pays them in
> USDC on its own. I'd like to fund a small testing campaign for any product you're
> building, my budget, your product. If you send me a URL and what you'd want verified,
> I'll send back the live mission board within the hour. If it's useless to you, that's
> exactly the feedback I need.

**B — SuperVega (options beta just launched):**
> Congrats on shipping options on Starknet. Beta is exactly the moment structured testing
> pays off, so here's a concrete offer: I'll fund a $10 USDC testing campaign for the beta
> through Sage, my AI agent that browses your product, designs specific missions, verifies
> testers' reports itself, and pays them automatically. You'd get real users walking the
> flow and their firsthand reports, at no cost to you. Want me to set it up? I just need
> the URL and what you most want verified.

**C — Telegram groups (send once per group, not spam):**
> We just funded paid testing campaigns on Sage. Real USDC on GOAT mainnet, paid by an AI
> agent that checks your work itself, usually within minutes. Do a short mission, describe
> what you actually saw, get paid to your wallet. Board: sagepays.xyz/marketplace. Founders:
> it can inspect your product and build missions for it too, from Telegram, no wallet
> needed: @sagedeputybot

**D — organizers/judges:**
> Would you try something for me? Paste any product you run into sagepays.xyz/launch and
> watch what the agent does. It browses it in a real browser, live on screen, and designs
> paid testing missions from what it saw, about 90 seconds. I want to know what it gets
> wrong on YOUR product. And if you want to feel the payout side, do one mission from our
> marketplace and the agent will pay you in USDC with an on-chain receipt.

---

## Post map (their 15 points → calendar; one post per account per day max; never identical text on both accounts)

- pt 15 (campaign live) → Day 1 official · pt 13 (types of agents) → Day 1 personal
- GOAT tag post → Day 2 official · builder QT → Day 2 personal
- Metis tag post → Day 3 official · pt 9 ("you don't have to find beta testers") → Day 3 personal
- pt 12 (everyone-becomes-a-builder story) → Day 4 personal · organizer thank-you/proof → Day 4 official
- pt 1 (give your growth agent Sage via OKX) + pt 8 (buy Claude → okx.ai) → Day 5, official, as one playful post
- payout receipt proof post → whenever the first stranger is paid, both accounts, different words
- pt 11 (comment under launches) → daily habit, personal account
- pts 6/7 (Starknet/SuperVega) → only after he says yes; his campaign, his tag

## Rules (the engineering discipline)

1. Max 5–10 DMs/day per account; personalized first line always; one follow-up ever.
2. Stagger campaigns; the marketplace must never be empty while we drive traffic at it.
3. Every payout gets a proof-link post. Every claim we make must be checkable on-chain.
4. Feedback goes into one running doc the day it arrives, verbatim, with source.
5. Stop-loss: untouched campaign after 4 days → stop, recover, reallocate.
6. Stretch past $50 only when a campaign's slots actually fill.
