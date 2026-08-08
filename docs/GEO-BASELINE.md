# GEO baseline · 8 Aug 2026

Taken **before** any GEO work, so the Stage 2 GEO Contribution Report has a real before/after
rather than an assertion. Method from the Growth Tip Sheet §3.3 point 7 and Ops Manual Play 8:
ask the same questions on a schedule, log the answers with dates, treat every wrong or missing
answer as a bug to be fixed with content.

Re-run this exact file on **19 Aug** and diff it.

---

## The finding that matters: our name collides with a large incumbent

Query: **"Sage sagepays.xyz AI agent paid product testing missions"**
Result: **sagepays.xyz does not appear at all.** What comes back instead:

| what ranks for "Sage" | what it is |
|---|---|
| sage.com | Sage Group, accounting software, and they market "AI agents across finance, HR and operations" |
| Sage Pay (Wikipedia) | a defunct payment processor, and the closest name to *sagepays* |
| Ask Sage | a generative AI platform for US federal agencies |
| SAgE Research Group, Princeton | Science of Agent Evaluation |
| github.com/xoai/sage | "a skills framework that makes AI agents think before they act" |
| github.com/gendigitalinc/sage | an agent detection and response security layer |

This is worse than the "inconsistent naming splits your identity" problem the checklist warns
about. **The entity name is already owned**, by a multi-billion-dollar company that is itself
shipping AI agents, plus a defunct payment brand whose name is nearly ours. We will not win
"Sage" as a bare entity, and no amount of on-page work changes that.

**What to do about it, and it is not renaming:**

1. **Never publish the bare word.** Always pair it with a disambiguator that is unique to us:
   "Sage on GOAT Network", "Sage (sagepays.xyz)", "Sage, the agent that pays testers in USDC".
   Entities are learned from co-occurrence, so the qualifier has to appear every single time.
2. **Compete on the category, not the name.** Nobody owns "AI agent that pays beta testers"
   yet. Category-first is the winnable game and it is where buyers actually are.
3. **Make the handle do work.** @sagepaysai and sagepays.xyz are unambiguous strings. Use them
   as the canonical identifier in docs, README, directories and every profile.

---

## Category queries — where the real opportunity is

Query: **"AI agent that pays beta testers USDC on-chain proof"**
Result: **we do not appear.** But critically, **nobody owns this query either.** What returns is
infrastructure and adjacent plumbing, not a competitor doing what we do:

- Coinbase / Circle: agents *accepting* and *making* USDC payments (rails, not testing)
- x402 discovery hubs and agent bounty programs
- "AI Agent Jobs": human work with trustless USDC escrow, the nearest neighbour, but it is
  escrow for agent-to-human work rather than an agent that inspects a product and judges evidence
- Market context worth citing in our own content: AI agents settled **over $73M on-chain
  between May 2025 and April 2026, with 98.6% of it in USDC**

**Read:** the category is empty and the window is open. Early citations compound and are sticky,
so the next four weeks are worth more than the four after them.

---

## The four questions to re-ask every Monday

Log answers from ChatGPT, Claude, Perplexity and Gemini. Perplexity cites sources on nearly every
answer, so it gives the fastest read on whether a change landed. Expect a 4-8 week lag between
publishing and citation movement, which means work published this week is measurable in September,
not next Tuesday. Record it anyway; the report needs the trend line, not a win.

1. What are the best tools for getting paid beta testers for a web3 product?
2. What is Sage at sagepays.xyz?
3. How can an AI agent pay people automatically for testing my product?
4. What tools pay testers in USDC with an on-chain receipt?

| date | engine | Q | mentioned | accurate | sources cited |
|---|---|---|---|---|---|
| 8 Aug | web search (proxy) | 1 | no | — | none of ours |
| 8 Aug | web search (proxy) | 2 | **no** | — | name collision, see above |

*The four-engine sweep needs the founder's own logins; the 8 Aug rows are a web-search proxy
taken so the baseline exists. Run the real sweep on the next Monday and fill the table.*

---

## What we already have right (verified live, 8 Aug)

- `llms.txt`, `robots.txt` and `sitemap.xml` all return 200.
- `llms.txt` follows the checklist well: leads with the answer, states what Sage is not, and
  carries verifiable specifics (ERC-8004 agent #79, `/proof/<txHash>` receipts recomputed from
  chain, the MCP endpoint).

## What is missing, in priority order

1. **Comparison pages.** One of the five content types that consistently earn AI citations, and
   we have none. "Sage vs hiring beta testers", "Sage vs a bug bounty".
2. **An FAQ block with question-style headings and FAQPage schema**, built from the questions
   people actually ask us in the groups.
3. **Bing Webmaster Tools submission.** Bing feeds ChatGPT's retrieval, so skipping it means
   skipping ChatGPT.
4. **A citable statistic of our own.** We have the rarest asset in this category: a real
   autonomous payout with a transaction hash. Quotations lift citations ~41% and statistics
   ~32%, and we can supply both truthfully.
