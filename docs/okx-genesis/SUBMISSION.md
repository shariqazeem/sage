# OKX.AI Genesis Hackathon — Sage submission package

**Deadline: Sun 27 Jul 2026, 23:59 UTC.** Prize pool $100K. Sources: the
[X Layer build page](https://web3.okx.com/xlayer/build-x-series), the
[ASP tutorial](https://www.okx.ai/tutorial/asp), and the
[HackQuest listing](https://www.hackquest.io/hackathons/OKXAI-Genesis-Hackathon).

> One source in the search results quotes an earlier close date (17 Jul). The X Layer page and the
> announcement both say **27 Jul 23:59 UTC**. Listing review takes **up to 24 hours** and an ASP that
> is not approved and live makes the submission invalid — so the listing must go in **today**, not
> on the 27th.

---

## 1. The decision (what we are submitting, and why)

**Register Sage as an A2MCP (Agent-to-MCP) ASP with a FREE endpoint.**

| Choice | Why |
| --- | --- |
| **A2MCP**, not A2A | A2MCP is a standardized MCP/API service billed per call or free. Sage already speaks MCP over the official Streamable-HTTP transport — the surface exists and is live. A2A needs price negotiation + XLayer escrow + arbitration, none of which Sage has, and it can't be built credibly in two days. |
| **Free**, not x402-paid | The tutorial allows exactly two compliant shapes: a free endpoint that returns the result directly, or an x402-paid one. Free is honest today — Sage's own money rail is USDC on GOAT Network, not XLayer, and its x402 merchant rail has been intermittent. Nothing about "free to call" weakens the pitch: **the money in Sage is what it pays testers, not what it charges agents.** |
| Category: **Software Utility** | Sage is product/dev tooling. Majors to aim at: **Best Product** (it works end to end on mainnet) and **Revenue Rocket** (every campaign moves real USDC). |

**Endpoint (live now):** `https://sagepays.xyz/mcp/public` — keyless, 5 tools, conformance 9/9.

---

## 2. Status — what is done, and what only you can do

### REGISTERED — 2026-07-25

| | |
| --- | --- |
| **Agent ID** | **#9211** (usable now, even before review) |
| Name | Sage · ASP · XLayer (chainIndex 196) |
| Owner wallet | `0x83b4b4f6348f71ffbdbb0cb046e428ca646f3c35` (Agentic Wallet, shariqshaukat786@gmail.com) |
| Register tx | `0xe1519720e085f1022af22447dec18c3eae949082cd19a7620ee2a04490c0e7f4` |
| Service | Product testing plan design · API service (A2MCP) · **0 USDT** · `https://sagepays.xyz/mcp/public` |
| Listing | **Submitted for review** — result arrives by email within 24h |

Remaining: the X post (§6), the ≤90s demo (§5), and the form (§7).


**Done (verified tonight):**
- Public ASP endpoint live and conformant: `node scripts/mcp-public-conformance.mjs` → 9/9 pass.
- End-to-end proven through that endpoint as an external agent: an inspection of `play2048.co`
  went `ready` with a real mission and an exact $2.00 budget split (`inspectionId G1TacPjNLJbc`).
- A real payout verifiable by any stranger's agent, no key:
  `sage_get_proof(0x2936…1299)` → `$0.50 paid to 0xDF70…90e3 on GOAT Network`, `verified: true`.

**Only you can do (account-bound — I can't and shouldn't):**
1. Log into an **Agentic Wallet** with your email (step 3 below).
2. Register + list the ASP (steps 4–5).
3. Post on X from your account.
4. Submit the Google form.

---

## 3. Runbook — the four steps to enter

The OKX flow is agent-driven: you paste prompts into an agent that has the Onchain OS skills
installed. Claude Code works (it's step 1's first named option).

### Step 1 — install Onchain OS

```bash
npx skills add okx/onchainos-skills --yes -g
```

Then open a **new** session so the skills load.

### Step 2 — log in to the Agentic Wallet

Paste into the agent:

```
Log in to Agentic Wallet on Onchain OS with my email
```

### Step 3 — register the ASP as A2MCP

Paste into the agent:

```
Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS
```

When it asks for the service details, use section 4 below. The endpoint is **free** — it returns
the result directly, no x402 step.

### Step 4 — list it, then post, then submit

```
Help me list my ASP on OKX.AI using Onchain OS
```

Review lands within 24h, by email + in the agent conversation. **Then** post on X (section 6) and
submit the form: **https://forms.gle/mddEUagmDbyV37ws8** (answers in section 7).

---

## 4. Listing content (paste this)

**Name:** Sage — autonomous paid user testing

**One-liner:** Hire an AI worker to test your product. Give it a budget, not your keys.

**Description:**

> Sage turns a product URL and a budget into paid, verified user testing.
>
> Point it at a live product. It browses that product in a real browser like a first-time user —
> crossing onboarding, typing into fields, reaching the screen you care about — and designs paid
> testing missions whose pass criteria are anchored to things it actually observed. Once the founder
> funds a campaign, Sage pays human testers in USDC for verified evidence, autonomously, inside
> on-chain limits it cannot exceed. Every payout publishes a receipt anchored to an on-chain
> transaction, recomputed from the chain rather than read from a database flag.
>
> The design rule is bounded autonomy over money: the AI proposes, the vault disposes. No model ever
> computes a payment amount — the vault derives the exact reward, enforces the caps and replay
> protection, and can reject. A jailbroken model still cannot move a cent.
>
> Live on GOAT Network mainnet with real USDC. Free to call as an agent service; the only money that
> moves is the founder's testing budget, from the founder's own wallet.

**Service type:** A2MCP · **Pricing:** Free · **Endpoint:** `https://sagepays.xyz/mcp/public`
· **Transport:** MCP Streamable HTTP · **Auth:** none

**Services (tool list):**

| Tool | What it does |
| --- | --- |
| `sage_start_inspection` | Inspect a live product and design paid testing missions within a budget. Prepares a plan only — never funds or pays. |
| `sage_get_inspection` | Poll the plan: honest stage, clarifying questions, or the finished missions + approval link. |
| `sage_answer_questions` | Answer Sage's clarifying question; it re-plans with the missing intent. |
| `sage_get_campaign` | Live campaign status: funded/paid/remaining, mission slots, each submission's decision and payout tx. |
| `sage_get_proof` | Verify a payout: settled/verified recomputed **on-chain**, recipient, amount, explorer + receipt links. |

**Boundaries (state these — they are the product):** this surface cannot approve, fund, settle or
sign anything; plans are prepared anonymously and the founder claims and funds them with their own
wallet; payout receipts are recomputed from the chain, never a stored flag.

---

## 5. The 90-second demo (shot list)

Record real screen, no slides. Every number on screen must be real.

| Time | Shot | Say |
| --- | --- | --- |
| 0:00–0:08 | Terminal: an agent calls `sage_start_inspection` on a live product URL with a $2 budget | "I'm an agent. I'm hiring another agent to test a product." |
| 0:08–0:25 | Sage's live feed: browsing stages, real screenshots from its field test | "Sage opens the product in a real browser and uses it — onboarding, typing, reaching the actual screen." |
| 0:25–0:40 | The finished plan: missions with pass criteria + the exact budget split | "It writes missions from what it saw, and splits the budget exactly. No model picks the amounts." |
| 0:40–0:52 | Founder approves + funds in the web app; the vault deploys | "Two human moments in the whole lifecycle: approve, and fund." |
| 0:52–1:10 | A tester submits evidence; Sage judges it and pays | "Sage verifies the evidence itself and pays USDC — no human in the loop." |
| 1:10–1:25 | `/proof/<tx>` receipt + the GOAT explorer tx | "Every payout publishes a receipt anchored to the chain. Verified means recomputed, not remembered." |
| 1:25–1:30 | End card: endpoint + "AI proposes, vault disposes" | — |

Real assets you can use: proof `0x2936293ef62364ffb04e6968593f135af2508e4574110aa32d6d9939e3331299`
($0.50, GOAT mainnet) and inspection `G1TacPjNLJbc` (planned through the public MCP endpoint).

**Use the wallet-connected web or Telegram flow for the demo**, not the anonymous MCP path — a
wallet-bound founder gets Sage's strongest planner (see §8).

---

## 6. X post (≤90s demo attached, #OKXAI required)

> I built an AI worker you can hire — and give a budget, not your keys.
>
> Point Sage at a product. It browses it in a real browser like a first-time user, designs paid
> testing missions from what it actually saw, then pays human testers in USDC for verified evidence
> — autonomously, inside on-chain limits it can't exceed.
>
> The AI proposes. The vault disposes. No model ever computes an amount, and every payout publishes
> a receipt anchored to the chain.
>
> Live on GOAT Network mainnet. Now an Agent Service Provider on OKX.AI (Agent #9211) — any agent
> can call it, free: sagepays.xyz/mcp/public
>
> #OKXAI @OKX @XLayerOfficial

---

## 7. Google form answers

| Field | Answer |
| --- | --- |
| ASP name | Sage — autonomous paid user testing |
| What it does | Turns a product URL + budget into paid, verified user testing: browses the product in a real browser, designs missions anchored to real observations, and pays human testers USDC for verified evidence inside on-chain limits. |
| Service type | A2MCP (free endpoint) |
| Endpoint | https://sagepays.xyz/mcp/public |
| Category | Software Utility |
| Real-world use case | Early-stage founders can't get honest first-use feedback. Sage hires and pays real testers automatically and publishes a verifiable receipt for every payout, so the spend is auditable. |
| Live product | https://sagepays.xyz · Telegram: @sagedeputybot |
| Chain / assets | USDC on GOAT Network mainnet (chainId 2345); on-chain CampaignVault enforces caps + replay protection. |
| X post | (link after posting) |
| Demo | (≤90s video link) |
| Repo | https://github.com/shariqazeem/sage |

---

## 8. Honest notes (do not oversell these)

1. **The anonymous MCP path gets Sage's baseline planner, not its strongest one.** The grounded
   planner — ordered goal checkpoints, deterministic mission compiler, criterion-level evidence —
   requires a server-verified founder wallet, which an anonymous agent caller does not have. An
   external agent gets a real, anchored plan; the founder then claims it with their own wallet and
   can re-plan under the full engine. Demo the wallet-bound flow.
2. **Free-to-call is a deliberate choice, not a missing feature.** If OKX asks about monetization:
   the paid rail is the campaign itself, and the endpoint can be flipped to x402 once Sage's
   merchant rail is stable.
3. **No XLayer integration.** A2MCP does not require one. Don't imply otherwise.
4. **The public endpoint is capped** (3 inspections/day per caller, 40/day globally) and can be
   turned off instantly with `PUBLIC_MCP_ENABLED=0` in the prod `.env` + a restart.
