# Sage, the company: the plan from 19 October 2026

> The founder's decision, 19 Oct 2026, effective immediately: **the hackathon era is over.** Sage stops
> being a hackathon entry and becomes **a company that builds AI agents**, backed by the two ecosystems
> that already know us: **Metis** (first place, Grand Champion, OpenClaw Summer Builder Bootcamp; Elena
> Sinelnikova, Metis cofounder, is supporting us directly) and **GOAT Network**. Every agent product we
> build ships "by Sage". The first two are **Sage Work** (today's product: verified work, paid) and
> **Called by Sage** (trading agents with records they can't fake). Sage becomes **paid**.
>
> This replaces `autonomous-paymaster.md`'s rule "no plans, no seat caps; earn on settlement and
> financing". That rule assumed settlements would happen. They didn't, so it never produced revenue.
> When this plan is implemented, CLAUDE.md §1 and §4 change to match.

---

## 0. The honest baseline (measured on prod, 19 Oct)

| Measure | Value | What it means |
|---|---|---|
| Pages / API routes | **51 / 90**, across 28 top-level sections | Far too much surface for a product with few users. People get lost. |
| Jobs ever posted (excluding sandbox) | **42**, on **5 networks**: GOAT 14, Arc testnet 15, Starknet 7, Arc 4, Metis Sepolia 2 | Spread across rails for hackathons, not for users |
| Posted by wallets that aren't ours | 28, from **7** distinct posters | Demand has been us and a handful of others |
| Distinct wallets ever paid (not ours) | 38, one farmer alone was 12 of them | Real people paid ≈ 25 |
| Submissions in the last 30 days | **10** (86 in the last 90) | Activity followed the hackathons and stopped with them |
| Workspaces / web accounts | 6 / 9 | The team product was never adopted |
| Metis Andromeda readiness | m.USDC `0xEA32…1a21` (6 dp, ≈4.16M supply) and m.USDT `0xbB06…F4dC` (6 dp) | Sage's dollar rail exists on Metis, verified on chain |

**Diagnosis.**
- **Sprawl beat depth.** Every hackathon added a rail or a surface: Arc, Starknet privacy, lender
  advances, operator, World ID, Telegram, the Caribbean pages. Each worked; together they confuse.
  Five networks collide in onboarding, accounts and launches, which the Demo Day launch failure showed:
  an email session replaced by a wallet sign-in, and the account vanished.
- **No named buyer.** Sage was a two-sided marketplace where the paying side never showed up.
- **The technology is real.** It has paid real people on mainnet since July, with an AI judge that
  refuses (26 times, each with a reason), a vault it can't overspend, receipts, sybil defences proven
  against a real farm, and a credit record. **The problem is focus and distribution, not capability.**

---

## 1. What Sage is now

**Sage builds AI agents you can trust with money.** Every Sage agent works inside limits enforced in
code, and leaves a public, verifiable receipt for everything it does.

That one sentence is the company thesis. Both products prove it:

| Product | What it does | Its receipt |
|---|---|---|
| **Sage Work** (today's sagepays.xyz) | Turns one sentence and a budget into verified, paid work: product testing, gigs, bounties, milestone grants. Pays from a vault it can't overspend, and builds each worker's credit record. | Every payout and every refusal, on chain, with the reason |
| **Called by Sage** (building now, separate repo) | AI trading agents (the Oracle, ST Quant signals, and "deploy your own agent") whose every call is committed on chain before the outcome | A track record nobody can fake |

The shared foundation, which is what makes Sage an infrastructure company rather than one app:
- **bounded autonomy:** vaults and mandates; the AI proposes, the vault disposes;
- **agent identity:** ERC-8004;
- **x402 payments;**
- **verifiable receipts;**
- **the judgment brain.**

**Global, not regional.** Sage serves anyone who pays people for work. The Caribbean stays as a
use case: multi-currency pricing (J$, TT$, EC$ and 11 more) and credit records for MSMEs. It is no
longer the identity.

---

## 2. Who pays first (the riskiest assumption, so it gets tested first)

**Hypothesis H1: the first paying customers are ecosystem programmes and web3 teams that already pay
many people.** That means bounties, grants, testnet campaigns, ambassador programmes, contributor
rewards and QA. They have stablecoin budgets and three pains Sage already solves: **sybil farming**
(proven: one person, 12 wallets, caught on chain), **manual verification**, and **payout ops plus
reporting**. Metis and GOAT are the first design partners: they run exactly these programmes and they
know us.

**H2: indie founders want real-person testing on their product** (Sage's original job). Serve this
self-serve on Free and Pro, without selling to it.

**H3: programmes in emerging markets want grants in local currency with credit records.** This is the
long sales cycle (Future Caribbean). Keep it as the Programs tier, not the beachhead.

**How we test H1 (before building plans in code):**
- 15 conversations: Metis, GOAT, and 13 programmes and teams found through them.
- The question: *"How do you pay contributors today, what does it cost you in time and in farmers,
  and would you pay $X/month for Sage to verify and pay them?"*
- Success: **3 design partners** who run a real programme on Sage in November.

---

## 3. Business model: paid plans, workers always free

The founder's call: Sage is paid, with plans the way Claude and others do it. The critical rule that
makes this work rather than shrink an already small funnel: **the free tier must deliver the first real
payout**, because a person who has seen Sage pay someone is the only person who buys.

| Plan | For | Price (hypothesis, validate in conversations) | What it includes |
|---|---|---|---|
| **Free** | Trying it | $0 | 1 live job at a time, up to $50/month paid out, standard verification, Sage branding on boards |
| **Pro** | Founders and small teams | **$29/month** | Unlimited jobs, up to $5k/month paid out, invite-only work, autopilot (the standing mandate), credit-record exports, your brand on boards |
| **Team** | Programmes and DAOs | **$149/month** | Workspaces, members and roles, private programmes, programme dashboards and audit exports, sybil reports, priority judging |
| **Programs** | Ecosystems, grant-makers, lenders | Custom | White-label, cohorts, lender API, SLA, custom verification |
| **Workers** | Anyone getting paid | **Always free** | Find work, get paid, own your record |

- **Pay in USDC on Metis or GOAT** (on chain, verified by Sage). Card comes later, once someone asks.
  A plan bought on Andromeda is also an Andromeda transaction of $2+, which is a counted Metis Rise user.
- **Design partners:** the first 10 get Team free for 3 months in exchange for a public case study.
- **Limits are enforced on the server, in code**, never by the UI alone. They gate job creation,
  monthly volume and features.
- The x402 per-settlement fee is kept for the Programs tier only, so plans stay simple.

---

## 4. Networks: two primary, two secondary, zero testnets

| Tier | Networks | Where people see them |
|---|---|---|
| **Primary** | **Metis Andromeda** (1088, m.USDC, gas in METIS): the default for new accounts once proven. **GOAT Network** (2345, USDC, gas in BTC). | Everywhere: onboarding, accounts, launch |
| **Secondary** | **Arc** (5042, USDC is the gas) and **Starknet** (private payouts) | Only under "More networks" in Settings and in advanced launch options |
| Retired | Arc testnet, Metis Sepolia | Nowhere (already done on 10 Oct) |

**Engineering rules (money paths are involved):**
- One source of truth, `PRIMARY_NETWORKS` and `SECONDARY_NETWORKS`, beside `LAUNCH_ENABLED_CHAINS`,
  with a test that every surface reads it. This is the "two lists that drift" lesson.
- **Hide, never delete,** secondary rails. Their campaigns, receipts and settlement keep working, and
  the frozen layers (vault ABIs, settle flows, mandate) stay untouched.
- Make Metis the default only **after** real payouts are proven on Andromeda. Changing
  `treasuryChainId` moves where NEW accounts open. Existing accounts keep their keys: the bare
  `web:<founder>` row carries its own chainId. Test this before the switch.
- Gas on Metis is METIS. The gas stipend (`gas-stipend.ts`) gets a Metis floor, so no founder ever has
  to go and buy METIS just to launch.

---

## 5. The product, simplified (Apple-minimal, nobody gets lost)

**Target: ~8 public pages and ~6 app screens,** down from 51.

**Public site (the company):**
- **Home:** Sage, the AI agents company. One sentence, the two products, live receipts as proof, one
  call to action.
- **Sage Work:** what it does, how it verifies, three use cases (testing, gigs, grants), with pricing
  inline.
- **Called:** the trading agents, linking to the Called app.
- **Pricing:** one table.
- **Ledger:** every payout and every refusal (today's explorer, simplified).
- **Docs:** consolidated from 13 pages down to about 4.
- **Company:** who we are, backed by Metis and GOAT, the first-place win.
- **Sign in**, plus the public board (`/c/…`), receipt (`/proof/…`) and record (`/record/…`) pages.

**The app (signed in):**
- **Home:** jobs, balance, what's happening.
- **Post:** one sentence becomes a job.
- **Jobs:** live and past.
- **Account:** fund and withdraw, primary networks as tabs.
- **Team:** members and invites, for Team plans.
- **Settings:** plan and billing, networks (including "More networks"), identity.

**Fold or remove:**
- `/vs`, `/case-studies`, `/caribbean` → use cases on the Sage Work page
- `/hire`, `/dev` → removed
- `/graph` → shown inside a job
- `/lender` and the advance → Programs tier, not public navigation
- `/agent` and `/agents` → Company and agent-identity pages
- `/outcomes` and `/explorer` → Ledger
- `/dashboard`, `/campaigns`, `/campaign` and `/workspace` → the app
- `/faq` → docs
- the legacy `/app` console → removed

**One identity, no collisions (the Demo Day failure, fixed for good):**
- **Email first.** Wallets are optional and become **linked to the same person**; signing in with one
  never replaces the other session. The declared-link machinery already exists.
- **Account choice:** the account opens automatically on the default primary network, a second network
  is one tap, and secondary networks are opt-in.
- **Launch:** the account-launch button is the only primary action when the account can pay (shipped
  10 Oct). Wallet deploy stays an advanced path.

**First-run flow, at most five screens:**
1. Sign in with email.
2. Choose "Pay people for work" or "Get paid".
3. See your account. Fund it by scanning or sending.
4. Post one sentence.
5. Watch it go live, then get paid or pay.

**Design language:** keep the brand (terracotta S with the receipt edge, Inter and JetBrains Mono,
paper and ink), move to Apple-like restraint:
- one idea per section;
- large type and a lot of whitespace;
- real product imagery (live receipts, the actual board);
- no jargon in the default path (no "vault kind", "rail", "mandate policy" in copy);
- nothing on a page that doesn't help the next action.

---

## 6. Metis: be infrastructure, not just a tenant

Metis rewards ecosystem infrastructure. Three things Sage builds that every Metis agent, Called
included, can use:
1. **Sage Work on Andromeda:**
   - the V2 vault factory on 1088;
   - m.USDC payouts;
   - METIS gas handled by the operator and the stipend;
   - receipts on Andromeda's explorer.
2. **x402 for Metis:** an open-source x402 facilitator for Andromeda (m.USDC and METIS), the payment
   capability Metis Rise explicitly lists. Sage and Called use it first; publish it as a public good.
   **Verify first** what Metis already runs (x402 support, an ERC-8004 registry, LazAI). Integrate
   rather than duplicate.
3. **Agent identity and receipts on Metis:** ERC-8004 identities for Sage's agents and Called's
   agents, with reputation backed by receipts.

**Metis Rise** (users 80%, METIS gas 20%; 15+ users, each with 3+ transactions or $2+ settled):
- Sage Work produces counted users by design: a founder's launch is 4 transactions; a worker paid $2+
  counts; a plan paid on Andromeda counts.
- **Called** applies in **October** (form by 31 Oct, ranked in November).
- **Sage** applies in **November**, once the Metis rail is live, and is ranked in December.

**GOAT stays primary.** It holds Sage's longest real-money history (the first autonomous payout, July
2026). Keep GOAT's programmes as design-partner targets, and the x402 fee rail where it already lives.

---

## 7. Sequence (critical path; the founder is at Breakpoint London 15–18 Nov)

| When | Sage | Called |
|---|---|---|
| **Now → 31 Oct** | Lock the plan. Deploy the factory on Andromeda, wire m.USDC and METIS gas, and prove a real payout on Metis. Start the 15 conversations. | **Ship v1 and apply to Metis Rise by 31 Oct** (the founder's focus) |
| **1–14 Nov** | Metis is the default; the network policy (primary vs secondary); identity linking (email first, no session replacement); the new app navigation; the first new landing | Live and onboarding users for the November ranking |
| **15–18 Nov** | Founder at Breakpoint. Use it for the conversations, with a demo on the phone. | Same |
| **19–30 Nov** | Plans, server-side limits, billing in USDC on Metis and GOAT. Design partners live. **Apply Sage to Metis Rise.** | Iterate on its record |
| **December** | x402 for Metis (public), ERC-8004 on Metis, case studies, docs consolidated, and the full public site in the Apple-minimal direction | "Deploy your own agent", as its record allows |

---

## 8. How we know it's working (measured, not felt)

- **North star:** verified payouts per month **by paying customers** (count and USD).
- **Activation:** the share of new sign-ups who reach a first payout (as payer or payee) within 7 days.
- **Revenue:** paying customers and monthly recurring revenue.
- **Ecosystem:** Metis Rise counted users (Sage plus Called), and Andromeda gas used.

**Targets by 31 Jan 2027:** 5 paying customers, 2 ecosystem programmes live, 100 people paid on
Metis, one top-3 Metis Rise finish (Sage or Called).

**Pivot rule, decided now:** if by **31 Dec** fewer than 2 paying customers exist after 30+ real
conversations with the ICP, narrow Sage to one job: paying ecosystem programme contributors, sold
directly, with everything else switched off. No more feature-building before that.

---

## 9. What we stop doing

- Adding networks, rails or surfaces because a hackathon rewards them.
- Building a feature without a named person asking for it.
- Testnets in front of users.
- Deleting money-path code (hide it; the frozen layers stay frozen).
- Claims the ledger can't back. Every number on every page is read from the chain or the database, and
  testnet never counts.
- Rehearsing in the wrong identity. Test the exact path a real user takes (the Demo Day lesson), and
  keep keys that hold real money out of temp folders (the scratchpad lesson).

## 10. Open decisions for the founder

1. **Name of today's product:** "Sage Work" (proposed), "Sage Pay", or just "Sage" with "by Sage"
   reserved for other products.
2. **Prices:** Pro $29 and Team $149 are hypotheses. Confirm, or wait for the first 5 conversations.
3. **The default primary network** once the Metis rail is proven: Metis (proposed, for Rise and
   ecosystem alignment) or GOAT.
4. **Domain:** keep sagepays.xyz for the product, or a company domain later.
5. **The first 15 conversations:** who at Metis and GOAT, and which programmes they introduce.
