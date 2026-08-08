# Growth Sprint · Sat 8 Aug → Fri 21 Aug 2026

Building is done. This is the whole plan, day by day, so nothing is forgotten.

**The spine, in the founder's words:** we market Sage by funding campaigns and asking
founders. Everyone building anything is a founder of their own product, hackathon
participants included. Two front doors, always named together: **sagepays.xyz** and
**@sagedeputybot**. OKX.AI is parked for now, it is not part of the OpenClaw hackathon.

**Two accounts, never the same words on both:** @sagepaysai (official, the product speaking)
and the personal profile (opinion, story, build-in-public).

**Sources.** Tactics below marked *TS §n* / *OM Play n* come from Ben Wynn's (CMO, GOAT
Network) Growth Tip Sheet and AI Marketing Ops Manual, July 2026. We take the mechanics and
run our own strategy on top.

---

## The edge, in one sentence (TS §0 — write it or nothing else works)

> Sage is the only AI agent that browses your product live, designs paid testing missions
> from what it actually saw, and pays testers USDC itself, inside on-chain limits it cannot
> exceed.

The checkable part is the whole edge: **every payout has an on-chain receipt.** Nobody else
in this cohort can say a machine moved their money and show the transaction.

---

## Stage 2 deliverables (due Fri 21 Aug) and what feeds them

| deliverable | what fills it | filled by |
|---|---|---|
| Product Growth Report | funnel numbers straight from `var/sage.db` + on-chain payouts | Day 12 metrics pull |
| Seed User Feedback Report (10-20 users) | every submission note and founder reply, verbatim, with what we changed | logged daily from Day 1 |
| GEO Contribution Report | the GEO work in §GEO below, with before/after answers from four engines | Day 1 baseline, Day 12 re-test |

**Seed user definition** (write this into the report): anyone who completes one real loop.
A tester who submits evidence on a funded mission, or a founder who runs an inspection of
their own product. Both are in our DB and neither can be faked.

---

## Budget: $50, stretch to $100 only on evidence

Absorption is structurally 5-20%, so small budgets fill and large ones just sit locked. The
per-wallet cap of 1 payout per campaign means **more campaigns beats bigger campaigns**:
five $10 campaigns pay five different people; one $50 campaign pays one person five times.
Untouched money is recoverable via stop, proven on-chain.

| # | campaign | budget | goal text to give Sage |
|---|---|---|---|
| 1 | sagepays.xyz (dogfood) | $8 | "Verify a first-time tester understands how earning works here, reaches the marketplace, and opens a mission board. Report what you actually saw." |
| 2 | one S2 cohort product | $10 | their words, engineered with them |
| 3 | www.goat.network | $8 | "Verify a newcomer understands what GOAT Network is, learns BTC is the gas token, and locates where to bridge or get started." |
| 4 | www.metis.io | $8 | "Verify a first-time visitor understands what Metis offers builders and finds how to start building on it." |
| 5 | SuperVega options beta (his product, we fund) | $10 | he sets it; suggest "Verify a trader can find the options beta, understand how an option is opened, and reach the trade screen." |
| — | reserve, doubles the best performer in week 2 | $6 | — |

**Rules.** Stagger them so the board is never empty while traffic is arriving. Any campaign
untouched for 4 days gets stopped and reallocated. Founder picks the targets and the order.

**Goal-writing rule to give any founder** (this is the coaching line that works):
> Write it like you would brief a human tester: what should they do, and what should be true
> on screen when they are done. Avoid anything that changes daily, like live counts or
> prices, because an honest tester who submits tomorrow would be judged against yesterday.

---

## Weekend 8-9 Aug: setup only (TS §1.3 — Saturday is the worst day, never launch into it)

Nothing public ships on a weekend. Two hours of setup that makes every later day faster.

- **`positioning.md` and `guardrails.md`** (OM Play 1 + 2). The edge sentence above, the
  one-liner, who exactly, their pain, proof, activation moment, competitors, links. The
  guardrails "never" list matters most: no em dashes, no superlatives without a source, no
  unverifiable claims, plain professional wording, never the word "Deputy" in public copy.
- **`llms.txt` + sitemap + Google Search Console + Bing Webmaster** (TS §4, OM Play 15).
  Bing feeds ChatGPT's retrieval, so Bing is not optional. *I can build these.*
- **GEO baseline**, so the report has a before: ask ChatGPT, Claude, Perplexity and Gemini
  the same four questions and log the answers with the date. *I can run and log this.*
  1. "What are the best tools for getting paid beta testers for a web3 product?"
  2. "What is Sage / sagepays.xyz?"
  3. "How can an AI agent pay people automatically for testing my product?"
  4. "What tools pay testers in USDC with on-chain proof?"
- **Idea inbox** (OM Play 14): one note, one line per idea, acted on the same day.
- **S2 cohort message may go out now** — 16 people, warm, a group chat is not an algorithm.
  The 485-member Builder Hub waits for Monday.

---

## Week 1 · the board fills and people are driven at it

### Mon 10 Aug — directories and the quiet groundwork (OM Play 10 Monday)
- Launch **campaign 1** (dogfood, $8). Screenshot the live board.
- Submit to directories: AI-agent directories, DappRadar, any GOAT/Metis ecosystem list
  (TS §12). Models read directories, so listings feed GEO as well as humans.
- Post **GOAT Builder Hub** message (485 people). Monday morning, not Saturday night.
- Personal account: point 13, the "types of agents" take. No link in body.

### Tue 11 Aug — PEAK DAY, the real launch (TS §1.3 Tue/Wed peak, 13:00-17:00 UTC)
- @sagepaysai launch thread, 3-5 posts, **no link in post 1**, ending "Link below". Post 2
  is the self-reply carrying sagepays.xyz. Link penalty is 30-50% of reach (TS §1.1).
- Post 1 is a **30-60 second screen recording** of Sage browsing a real product and
  designing missions, outcome in the first 3 seconds, captions on, URL on the end card
  (TS §2). Native video only, never a pasted link.
- Launch **campaign 2**. Be online all afternoon answering every reply: a reply you respond
  to is the single highest-leverage action on the platform (TS §1.2).
- Personal: point 9, "you don't have to find beta testers anymore", different words.

### Wed 12 Aug — GOAT day (still peak)
- Launch **campaign 3** (goat.network). Post tagging GOAT: tested on GOAT, paid in USDC on
  GOAT, receipts on-chain. Personal account quote-tweets with the builder angle.
- **Reply habit begins and never stops:** 15 thoughtful replies a day under fresh launches
  and founder posts (TS §10, point 11). Short, specific, never copy-paste:
  > if you want paid beta testers on this, Sage can browse it and set up missions in a few
  > minutes. happy to fund a small one.

### Thu 13 Aug — the 20 personal DMs (OM Play 10 Thursday, TS §15)
- Launch **campaign 4** (metis.io). Post tagging Metis.
- DM the first 20 target founders. **Personalise every one**, a template that reads like a
  template converts like one. Three sentences: who you are and proof you did the work, the
  concrete value to them, one small ask. Follow up once after 4 days adding one new piece
  of value, then stop.
- DM **ellibenson** (Starknet) and **SuperVega** (options beta just shipped).
- Send the **Areej** reply and book the call.

### Fri 14 Aug — ecosystem media and cross-launches (OM Play 10 Friday)
- Pitch Metis / GOAT / ClawUp channels and crypto newsletters. Bootcamp projects are a
  natural story for them and the worst case is silence (TS §12).
- Coordinate a **cross-launch with another bootcamp team**: shared audience, doubled reach,
  zero cost. This is the single most underused free amplifier in the sheet.
- @sagepaysai: first payout receipt of the week with the /proof link. **A real receipt is
  our best content and nobody else has one.**

---

## Week 2 · scale what moved, then write the reports

### Mon 17 Aug — read the funnel, cut the dead
- Stop any campaign untouched for 4 days, recover the USDC on-chain, reallocate.
- Double the **one** campaign that actually filled, using the $6 reserve.
- Second wave of DMs, warm signals only (people who liked, replied, or opened).

### Tue 18 Aug — the compounding content (peak day)
- Publish the **comparison page** (OM Play 15): "Sage vs hiring beta testers" and "Sage vs
  a bug bounty". Comparison pages rank for humans and get quoted by AI engines, and they
  are one of the five content types that consistently earn citations (TS §3.3).
- Publish the **FAQ/docs pages** built from the five questions people actually asked us in
  the groups this week. Question-style headings, direct answer in the first 60 words.

### Wed 19 Aug — the proof post (peak day)
- The strongest asset we will ever have: a thread walking through one real payout end to
  end. Product URL in, missions designed, tester submits, Sage judges, USDC moves, receipt
  on-chain. Every claim clickable. Bookmarkable, which is the most overweighted signal on
  the platform (TS §1.2).
- Re-run the **GEO monitor** and log the four engines' answers against the Day 1 baseline.

### Thu 20 Aug — write the reports
- Pull metrics from `var/sage.db`: inspections by non-operator founders, campaigns launched,
  submissions, payouts with tx hashes, total USDC paid.
- Seed User Feedback Report: every note and reply verbatim, with what we changed because of
  it. We have already fixed a long list of defects from live feedback and that history is
  the report's spine.

### Fri 21 Aug — submit
- All three reports. Final screenshot of the board and the receipts.

---

## SEO + GEO, run properly (TS §3, §4 · OM Play 8, 15)

GEO matters more than SEO for us right now, and the numbers say why: AI-referred visitors
convert at roughly 10-16% versus about 1.8% from classic organic search, and the overlap
between Google's top 10 and what AI engines actually cite has collapsed to roughly 17-38%.
Ranking on Google no longer buys AI visibility. It is a separate game and **early citations
compound**, so a new category like "AI agents that pay testers" is a window that closes.

What measurably lifts citations, from the Princeton KDD 2024 study: quotations (+41%),
statistics (+32%), inline source citations (+30%). Keyword stuffing performs **worse than
doing nothing**.

Our GEO work, in priority order:
1. **One name everywhere.** "Sage" spelled identically across site, docs, GitHub, X,
   directories. Inconsistent naming splits the entity in the models' eyes.
2. **Lead with the answer** in the first 60 words of every page.
3. **Publish citable assets.** We have something rare: real numbers. "Sage judged a tester's
   report and paid $1 USDC on GOAT mainnet autonomously, transaction 0x8df776…0069." That
   is a verifiable statistic with an inline citation, which is exactly the shape that gets
   quoted.
4. **Be where models look:** public docs, GitHub README, directories, ecosystem blogs.
5. **Cover the pipes:** Bing Webmaster, `llms.txt`, crawlable docs.
6. **Monitor weekly**, expect a 4-8 week lag. Perplexity cites sources most often, so it is
   the fastest feedback loop for testing whether a change landed.

SEO in parallel, one keyword-mapped post per week, targeting intent not volume: "how to get
beta testers for a web3 product", "pay testers in USDC", "AI agent that tests my product".
Judge it on impressions in Search Console, not clicks, for the first months.

---

## The three messages, ready to send

Send as-is. The founder sends these, not the agent.

### 1 · S2 cohort group (16 people)

> Shariq here, building Sage (sagepays.xyz).
>
> Every one of us in this group is a founder of our own product, and we all hit the same
> wall: getting real people to actually test it.
>
> Sage is an AI agent that solves that. You give it your product URL, what you want tested,
> and a budget. It opens your product in a real browser and you watch it explore, live on
> screen. From what it actually saw, it designs specific testing missions with clear pass
> criteria. You fund it, and you get a shareable link.
>
> Then you post that link anywhere and say "earn USDC by testing this." People do the
> missions, submit what they saw, and Sage verifies their work against what it saw itself
> and pays the genuine ones automatically. You never review a submission manually.
>
> Two ways in, whichever you prefer:
> • Web: sagepays.xyz
> • Telegram: @sagedeputybot, fully walletless. It creates a wallet for you and funds the
> campaign from it, so you never connect anything or leave Telegram.
>
> If you want to try it on your Stage 2 product, drop your URL and what you'd want tested.
> Happy to help you get the first campaign live.

### 2 · GOAT Builder Hub (485 people) — Monday morning

> Sage is live on GOAT mainnet: sagepays.xyz
>
> If you're building something, Sage gets you beta testers. Give it your product URL, what
> you want tested, and a budget. It opens your product in a real browser, designs testing
> missions from what it actually saw, and you fund it. You get a link to share, and anyone
> who completes a mission gets paid in USDC automatically once Sage verifies their report.
> Every payout has an on-chain receipt.
>
> You can run the whole thing from Telegram without a wallet: @sagedeputybot creates one for
> you and funds the campaign from it.
>
> Or web: sagepays.xyz
>
> Builders, this is the fastest way to turn a budget into real users testing your product.
> Happy to answer anything here.

### 3 · Areej reply

> Hi Areej, a meeting works great. I'm UTC+5, free most days between 2pm and 9pm my time,
> so pick whatever suits you.
>
> Yes to the Builder Livestream panel too. UTC+5, flexible on days.
>
> For the call: we've paused building and are all-in on growth for the final two weeks. Sage
> is live and we're funding USDC testing campaigns for other builders' products to get real
> seed users. Biggest help would be getting it in front of the right founders, plus the
> ClawUp referral content.

---

## Post map — the founder's 15 points against the calendar

One post per account per day maximum. Never identical text on both accounts.

| point | account | day |
|---|---|---|
| 15 · campaign live | official | Tue 11 (launch thread) |
| 13 · types of agents | personal | Mon 10 |
| 9 · you don't have to find beta testers | personal | Tue 11 |
| GOAT tag post | official | Wed 12 |
| builder-angle quote tweet | personal | Wed 12 |
| Metis tag post | official | Thu 13 |
| 12 · everyone became a builder | personal | Thu 13 |
| organiser thank-you + proof | official | Fri 14 |
| 11 · comment under fresh launches | personal | daily habit from Wed 12 |
| payout receipt proof | both, different words | whenever the first stranger is paid |
| 6/7 · Starknet + SuperVega | both | only after he says yes, his campaign, his tag |
| 1 + 8 · OKX.AI, buy Claude | — | **parked**, not part of this hackathon |

---

## Operating rhythm (OM closing section — about 90 minutes a day)

- **Daily 10-15 min:** watchdog on the funnel numbers, replies on X, publish one piece from
  the week's batch, capture ideas the moment they arrive.
- **Weekly 90 min:** one source asset through the content engine producing five outputs (a
  30-second clip, a thread, a blog/docs post, a newsletter section, an FAQ entry), the GEO
  monitor, and two or three genuine outreach attempts.
- **Per launch:** the runbook above.

## The rules that decide whether this works

1. Max 5-10 DMs a day per account. Personalised first line always. One follow-up, ever.
2. The board must never be empty while we are driving traffic at it.
3. Every claim we make is checkable on-chain. Every payout gets a proof link.
4. Feedback goes into the running doc the day it arrives, verbatim, with its source.
5. Never buy followers or engagement. It poisons the account score permanently and it
   poisons our credibility with the AI engines that are now reading social signals.
6. Never publish an unverified number. One wrong figure earns a Community Note, and a note
   carries a 60-80% reach penalty plus lasting account damage.
7. **Most people quit at week three, right before compounding starts.** The sprint ends
   21 Aug; the habit should not.
