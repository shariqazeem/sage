# 00 — Product Vision & Plan

> One of four docs written for an external review (Fable 5). This one frames **what the product is, the idea behind it, what we actually built, and where it stands honestly today.** The other three go deep on the AI agent, the Telegram agent, and the web UI/UX. Written 2026-07-16, grounded in the real codebase, not the aspirational spec.

---

## 1. The one-liner

**Hire an AI worker. Give it a budget, not your keys.**

A founder points the product at their app and says "test this, here's $X." An AI agent — "the Deputy" — inspects the product, designs paid testing missions, funds an on-chain vault, and then **autonomously pays real money to real human testers for verified work**, inside hard limits it can never exceed. Every payout is backed by observable evidence and published as a verifiable receipt.

The thesis is **bounded autonomy over money**: an AI agent that can actually *spend* on your behalf, but only within an on-chain mandate that makes overspend, misdirection, or fraud structurally impossible — not "please behave," but "the vault will refuse."

---

## 2. Important: what this product IS vs what the spec says

The repo's canonical spec (`CLAUDE.md`) describes a **different, older product** — "Sage," a crypto-token investigator that issues SAFE/RISKY/SCAM verdicts on tokens launched in the last 72 hours, graded at T+30. **That product is dead.** It survives only as a disabled placeholder page (`src/app/sage/page.tsx`) and some presentational metadata (`src/lib/verdicts.ts`). There is no token investigation, no 72-hour eligibility check, and no T+30 grading anywhere in the code.

**The real, live product is the Deputy**: autonomous paid product-testing. Everything in these four docs describes that.

This matters for the review: **`CLAUDE.md` is stale.** Its design system (dark Bloomberg terminal), its integration requirements, and its whole product framing describe the dead product. Do not treat it as ground truth — treat these four docs as ground truth.

**Naming is unresolved.** The code, UI, and copy use "Sage" and "the Deputy" interchangeably; the domain is `sagepays.xyz`; the Telegram bot is `@sagedeputybot`. A first-time user cannot tell what the thing is called. This is an open branding decision we'd value advice on.

---

## 3. Why it's different (the intended wedge)

Two properties are the whole point:

1. **Bounded autonomy.** The agent moves real money without a human in the loop, but every spend is gated by an on-chain policy (a per-mission reward the vault derives itself, a daily velocity cap, a total budget, replay protection). The AI *proposes*; the *vault disposes*. Even a fully jailbroken model cannot exceed the mandate. This is the differentiator vs. "an AI that drafts a payout you then approve."

2. **Verifiability + a track record.** Every payout cites the concrete tester evidence and the model's reasoning, and is published at a public `/proof/<tx>` receipt anchored to an on-chain transaction. The agent's identity and work record are anchored to **ERC-8004** so the reputation is portable and falsifiable.

The product is deliberately narrow: it is not a generic agent platform, a bug-bounty marketplace, or a chatbot. It turns *one product + one budget* into *paid, verified testing missions* and is judged on whether the payouts hold up.

---

## 4. The two front doors

The same core engine is reachable two ways. This duality is central to the current vision.

### 4a. The web app (`sagepays.xyz`)
The original surface. A founder connects a browser wallet (MetaMask), signs in with SIWE, and walks a guided flow: describe the product → Sage inspects it and proposes an editable mission plan → approve → connect wallet → deploy a vault (create → approve → fund → activate) → campaign goes live. Human testers find the public board, submit evidence, and get paid. **Requires a crypto wallet and pre-funded USDC + gas.** (Full detail: doc 03.)

### 4b. The Telegram agent (`@sagedeputybot`) — the walletless north star
The newer, strategically-central surface. A founder does **everything from a Telegram chat with no browser and no wallet app**:

```
"test my product at example.com, budget $5"   → agent inspects, DMs a mission plan
"launch"                                        → agent mints a policy-guarded wallet for you
send USDC + a little BTC to the address         → you fund it
"fund and launch"                               → agent deploys + funds a real vault on-chain
```

The agent holds a **Privy server wallet** bound to a standing on-chain **mandate** (it can only create Sage vaults and spend up to a per-campaign cap you set). A person who has never touched crypto can launch a funded, autonomous testing campaign by chatting.

**This loop was proven end-to-end with real money on GOAT mainnet on 2026-07-16** — a real vault (`0x90169AB62B2bA1c61eEA442F179280Aba937E678`) was deployed and funded with 2 USDC entirely from a Telegram conversation. (Full detail: doc 02.)

The **north-star vision** (from the founder): the walletless chat *is* the account. Onboarding should feel like messaging a competent human operator, not operating a dApp. The web app should reach the same walletless simplicity (it hasn't yet — it still leads with an extension wallet).

---

## 5. Architecture at a glance

Three distinct LLM "brains," one on-chain settlement core:

| Component | What it is | Where |
|---|---|---|
| **Mission Brain** | Architect + critic LLM that *designs* testing missions from an inspected product, behind a deterministic validation gate. | `src/lib/launch/mission-brain.ts`, `mission-prompt.ts` |
| **Payout Deputy** | Skeptical LLM that *judges* tester submissions against mission criteria and proposes pay/review/hold; hardened against prompt injection; can never state an amount. | `src/lib/deputy/brain-core.ts`, `brain.ts` |
| **Telegram Concierge** | Conversational agent (Claude Haiku 4.5) with Sage's tools bound; drives the walletless flow. | `src/lib/telegram/concierge.ts` |
| **On-chain vaults** | `CampaignVault` (V2) / `PolicyVault` (V1) on GOAT/Metis. The vault derives the exact reward, enforces caps, and emits the settlement event that is the single source of truth. | `contracts/`, `src/lib/deputy/campaign-vault.ts` |

**The safety model is the star of the architecture.** Money only moves through a vault whose on-chain policy bounds it. The Deputy's operator key can *request* a payout, but the contract computes the amount, checks the caps, checks replay protection, and can reject. The Telegram agent's wallet can *only* sign transactions its Privy policy allows. Autonomy is safe because the boundary is on-chain, not in a prompt.

**How a live campaign actually runs:** there is no long-running event loop. "Autopilot" is a stateless gate fired by (a) a synchronous run when a tester submits, and (b) a cron "sweep" (~every 5 min, driven by an external pm2 watcher hitting an authenticated endpoint) that re-evaluates pending work, settles matured approvals, and pays operator fees. (Full detail: doc 01.)

---

## 6. The integration story — honest status

The old spec mandated five integrations. Here's what's actually wired:

| Integration | Intended role | Real status |
|---|---|---|
| **Privy** (not in old spec) | Walletless server wallets + on-chain mandate policies | **Live and proven.** The backbone of the Telegram walletless flow. |
| **x402** | Payment/metering rail | **Real.** Two rails: the Deputy pays $0.10 to its own paywalled evidence-verification endpoint before fetching evidence (RAIL 1), and operator fees settle over x402 (RAIL 2). Honest unpaid fallback when not configured. |
| **ERC-8004** | On-chain agent identity + reputation | **Partially real.** Identity is anchored; the "reputation" is a real, derived *payout track record* (settled payouts, blocked spends, campaigns). But it is **not** the verdict-accuracy grade the old spec described — that grading doesn't exist. |
| **GOAT Network** | Default chain (mainnet) | **Live.** chainId 2345, real USDC, native BTC gas. The proven walletless deploy ran here. Metis Sepolia is the testnet option. |
| **CommonStack** (LLM gateway) | Verifiable inference / model access | **Live.** OpenAI-compatible gateway; the Deputy and Concierge both run through it (Concierge on Claude Haiku 4.5). |
| **LazAI** | Verifiable inference / data attestation | **Absent.** Appears only as a text label on the dead page. No client, no attestation call. This is the one integration that is purely aspirational. |
| **"GOAT-compatible adapter"** | Generic tool abstraction for chains | **Does not exist as an abstraction.** On-chain access is direct viem. "GOAT" in code = the GOAT chain + the goatx402 SDK, not a pluggable tool layer. Multi-chain is a hand-rolled registry. |

---

## 7. What is proven vs aspirational (the honest scoreboard)

**Proven / real and working:**
- The full **walletless fund→launch loop** on GOAT mainnet (real vault, real 2 USDC, from chat).
- On-chain settlement against real deployed vaults, per-chain operator signing, event-decoded outcomes, replay protection, crash recovery, idempotency.
- The **Mission Brain** (architect + critic + deterministic gate) and the bounded, SSRF-guarded HTML inspector.
- The **Payout Deputy** brain with verbatim-quote enforcement, a real **prompt-injection detector** + confidence ceiling, and a deterministic red-team test suite.
- x402 payments (both rails) via a real SDK; ERC-8004 identity + a derived payout track record.
- The **Privy mandate** — enclave-enforced, unit-tested; the model can be jailbroken and still can't overspend.
- Strong unit-test coverage across the pure logic cores.

**Incomplete / unproven / aspirational:**
- **SAFE/RISKY/SCAM verdicts + T+30 grading** (the old thesis): not built.
- **LazAI**: not integrated.
- **The agent never tests products itself** — it reads server-rendered HTML and designs missions for *human* testers. JS-rendered flows, anything behind a login, and anything needing a screenshot are structurally out of reach.
- **Mainnet auto-pay is OFF by default** — real-money campaigns hold for manual approval unless an env flag is flipped (a deliberate safety default).
- **The Telegram withdraw path** (money out) is built but not yet proven on-chain.
- **Web parity for walletless** — the web app still requires an extension wallet + pre-funded gas; no in-app on-ramp.
- **Five-to-six parallel CSS design systems** in the web app with no shared tokens (see doc 03).
- **Custody caveat:** one Privy app secret is the master credential for *all* founder agent wallets. Rotating it is an open item.
- **Autonomy depends on a single persistent pm2 process** — no job queue, no retries; a restart loses in-flight notifications and pending withdrawals.

---

## 8. Where we want advice (the open questions for Fable)

The founder's next phase is **improving the AI-agent side and the overall experience.** Specific tensions worth an outside view:

1. **The AI agent's real capability ceiling.** Today it designs missions and adjudicates text evidence from public URLs — it cannot *use* the product (no headless browser, no auth, no screenshots). Is the right move to (a) invest in the agent actually testing products, (b) lean harder into the human-tester marketplace, or (c) both? What does a genuinely impressive AI-tester agent look like from here?
2. **The walletless vision vs. custody honesty.** Chat-as-account is magical, but the agent custodies keys via Privy and the "guardian" safety role is currently the same key as the owner. How do we keep the magic while making the custody/trust story honest and safe?
3. **Trust & verifiability as the product.** The `/proof` receipts + ERC-8004 track record are the accountability story. Is that the wedge to double down on? How do we make "you can verify every payout" a felt, central experience rather than a detail?
4. **One product, one identity, one design system.** The web app is five design systems and two names deep. What's the right unified identity and UX — and how much of the cinematic/terminal ambition survives contact with a simple onboarding?
5. **Autonomy posture.** Auto-pay is off on mainnet by default. What's the right trust ramp — how does an agent *earn* the right to spend without asking?

---

## 9. Reading order for the other docs

- **[01 — AI Agent: The Deputy](01-AI-AGENT-THE-DEPUTY.md)** — the mission brain, the payout brain, evidence checking, injection defense, on-chain settlement, and exactly what the agent can and can't do.
- **[02 — Telegram Agent](02-TELEGRAM-AGENT.md)** — the walletless flow end-to-end, the concierge LLM + tools, the Privy mandate, and what's proven vs not.
- **[03 — Web App UI/UX](03-WEB-APP-UIUX.md)** — the design systems, the onboarding/launch flow step-by-step, the campaign/tester surfaces, and an honest flaw audit.
