# Sage — Technical documentation (Future Caribbean submission)

Repository: https://github.com/shariqazeem/sage · License: MIT · Live: https://sagepays.xyz
Setup: `npm install && npm run dev` (see README → "Commands"); every integration degrades honestly
when its secret is absent, so the app runs with no keys and says what is pending.

## Architecture — the agentic workflow

Three model "brains" and a browser agent do the reasoning; a deterministic compiler, a deterministic
gate and an on-chain vault decide anything that touches money. The AI proposes, the vault disposes.

```mermaid
flowchart TD
  F["Founder / funder / business<br/>one intent: URL or work + budget<br/>(web wallet · Telegram walletless)"] --> C["Concierge agent<br/>tool loop · stated-terms check · testimony gate"]
  F --> L["Launch API"]
  C --> L
  L --> I["Inspection agent<br/>HTML crawl + Field Test (Playwright)<br/>goal journey · safe-transition replay"]
  I --> V["Vision lane<br/>screens → observed facts"]
  I --> MB["Mission Brain<br/>Architect → Critic (batched) → deterministic validate gate<br/>anchors must be verbatim · count rule floor/ceiling"]
  V --> MB
  MB --> BC["Budget compiler (deterministic)<br/>Σ reward × completions = budget, exact<br/>fair-rate cap · exact spread · no model states an amount"]
  L --> DC["Direct compiler (deterministic)<br/>gigs · bounties · milestone grants · 14 currencies at a stamped rate"]
  DC --> BC
  BC --> A["The founder's intent, once<br/>approve the plan — or a standing mandate"]
  A --> FUND["Funded once: the treasury<br/>Privy agent wallet under a mandate policy · reclaim = the founder's wallet<br/>the agent deploys, funds and activates each vault<br/>EVM CampaignVault (GOAT) · Cairo SageVault (Starknet)"]
  FUND --> BOARD["Workspace board · members-only or public<br/>workers submit evidence + a free signature (or from Telegram, no wallet app)"]
  BOARD --> PRE["Deterministic pre-gate<br/>artifact fetch + wallet marker · on-chain reads · public-page text<br/>sanctions snapshot · dedup · artifact fingerprint · GitHub provenance · funding graph"]
  PRE -->|refuse / hold| REC
  PRE --> PB["Payout brain (judge)<br/>frozen rubric · injection detector · verbatim quotes · confidence hardener<br/>never states an amount"]
  PB --> OJ["Observation judge<br/>tester account vs Sage's own private corpus"]
  OJ --> GATE{"Autopilot gate<br/>engine = llm · confidence ≥ 0.85<br/>mainnet armed · identity + plan digests match"}
  PB --> GATE
  GATE -->|hold| H["Held with the reason — the worker revises; the founder may release"]
  GATE -->|pay · members-only| D["Settlement dispatcher (one place)<br/>rail = evm | starknet"]
  GATE -->|pay · open campaign| FW["Finalization window (30 min)<br/>approved at once · the watch re-runs against everything that arrived since<br/>near-duplicate · copied artifact · wallet cluster → revoke with the reason"]
  FW --> D
  D --> EV["CampaignVault.requestPayout<br/>vault derives the reward, checks caps + replay"]
  D --> SV["SageVault.request_payout (Cairo)<br/>refusal = a code on chain · escrow by commitment · one-time claim · shielded note"]
  EV --> REC["Ledger + receipts<br/>/explorer · /proof · /record (credit signals) · /lender · /outcomes"]
  SV --> REC
  REC --> ADV["Capital in: the advance facility<br/>capacity = published arithmetic · waterfall on the next verified payout"]
  SW["Sweep watcher (pm2, ~5 min)<br/>re-evaluates holds · settles matured approvals · reaps stalled jobs"] -.-> PRE
  SW -.-> D
  X402["x402 rails<br/>paid verification calls · $0.10 operator fee per settlement"] -.-> PB
  ID["ERC-8004 agent identity #79"] -.-> D
```

**Agents and their boundaries.** The Concierge (Telegram and web) turns a founder's sentence into
tool calls and never does money math. The Inspection agent browses the product in a real browser,
fills safe forms, replays safe transitions, and records only what it saw. The Mission Brain
(architect and critic, two calls with a deterministic validate gate between them and after them)
designs paid missions from that record. The Payout brain judges evidence and proposes pay, review or
hold — it is forbidden from stating an amount, its rubric and injection detector are frozen code,
and a confidence hardener can only lower confidence. The Observation judge scores a tester's account
against Sage's own private observations so a copied mission card can never pass. Every money
decision is made by deterministic code: the budget compiler, the pre-gate, the autopilot gate, and
finally the vault, which derives the amount itself and can refuse.

**Human moments.** Two by design — state the intent, fund it — and both can be done once: a
treasury under a mandate lets the agent deploy, fund and activate every subsequent plan itself.
Nothing else needs a person. On an open campaign the agent approves at once and settles after a
finalization window it uses to watch the wallet graph; a hold carries its reason and the worker's
revise path; a kill switch, campaign stop and withdraw exist and are tested; real-money autonomy
must be explicitly armed. Sage earns on what it settles (a per-settlement fee over x402) and on
financing (the advance facility), never on seats.

**Multi-provider lanes.** Each job (mission design, payout judgment, observation judging, vision,
concierge) runs on its own provider by configuration, with a fallback provider after a measured
failure; token budgets are declared as answer sizes and each provider's reasoning overhead is added
by a profile. Compute is spent where it changes an outcome: the browser loop makes zero model calls,
deterministic checks run before any model, and refusals cost nothing.

## Data sources

- **The product itself** — fetched HTML, rendered pages, screenshots, console errors (the Field Test).
- **On-chain state** — GOAT Network and Starknet mainnet via RPC: vault state, settlement events, transaction receipts; the ledger is derived from settlement events, never typed in.
- **Submitted evidence** — public URLs, created artifacts, transaction hashes; fetched by Sage, confined inside untrusted-data markers.
- **OFAC SDN list** — vendored, dated snapshot; screened at three doors.
- **World Bank WDI `SI.RMT.COST.IB.ZS`** — inbound remittance cost per receiving country (Jamaica 3.59%, Haiti 4.70%, Dominican Republic 2.52%, Guyana 7.92%, 2023), vendored and dated; the corridor each Caribbean obligation is measured against.
- **Exchange rates** — a stamped, source-attributed quote per obligation currency at composition time.
- **GitHub public API** — repository provenance (fork flag, creation date) for artifact gigs, degrading to no signal when rate-limited.

## Models

- **MiniMax-M3** — mission design (architect, critic) and the payout judge; promotion-gated on the live batteries (P-JUDGE zero wrong auto-pays across 57 rows; P-WORK 14 attacks zero leaks, 12 honest zero false holds).
- **Claude Haiku 4.5** (via an OpenAI-compatible gateway) — the concierge, and the fallback provider for mission design.
- **Gemini 3.1 Flash-Lite** — the vision lane and the grounded (observation-cited) architect.
- The observation judge and every gate are deterministic code; no model computes an amount.

## Third-party tools and infrastructure

Next.js 15 (App Router, Turbopack) · TypeScript strict · SQLite via better-sqlite3 + Drizzle · Playwright (Field Test, video pipeline) · viem (EVM) · starknet.js (Starknet) · Solidity `CampaignVault` (GOAT, Metis Sepolia testnet) · Cairo `SageVault` + `SageClaims` (Starknet mainnet, privacy class `0x6d5577…5aa0`) · Privy server wallets under a mandate policy (walletless founders) · x402 (paid verification, operator fee) · ERC-8004 agent identity · Telegram Bot API · pm2 on a 2-vCPU VM · Vitest (4,000+ tests incl. a red-team suite) · MIT license.

## Live evaluation batteries (the quality gate)

P-GEN (13 product categories, anchor integrity must be 100%), P-DIRECT (founder briefs → compiled
gigs and grants), P-WORK (gig judging: attacks and honest work), P-JUDGE (payout judge promotion),
P-ROUTE (tool routing across both surfaces), P-VERIFY (verification contracts), and a Starknet
dry-run that must refuse a control row. Every battery imports production's own prompts and tools.
