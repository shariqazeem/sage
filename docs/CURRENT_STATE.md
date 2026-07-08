# Sage — Current State

> The complete, current snapshot of the project as of **2026-07-09**: the idea,
> how every piece works end-to-end, what is real on mainnet vs. testnet, and the
> exact state of each integration. This file is the authoritative "now."

---

## 1. The idea

**Sage is the control layer for AI agents that spend real money.** You give an AI
worker an *allowance, not your keys*: a budget and a rule. It pays real people for
real completed work, autonomously, from an on-chain **Policy Vault it is
physically incapable of exceeding.**

- **One-liner:** *"Give an AI agent an allowance — not your keys."*
- **The product:** an autonomous **Payout Deputy**. You fund a policy-capped vault
  and define a task; people submit work; the Deputy's AI brain verifies each
  submission against your criteria and releases USDC — or the vault blocks it.
- **The guarantee:** the AI proposes *who* and *how much*; the **vault decides
  whether money can move.** Anything off-policy is blocked on-chain *before* funds
  move — even if the AI is wrong or compromised.
- **The wedge:** reward campaigns / bounties / quests (pay many small
  contributors for verifiable work). The long game is the payroll rail for the
  agent economy.

**Names:** Sage = the platform. Payout Deputy = the AI worker. Policy Vault = the
on-chain leash.

**Why it's defensible:** the brain is a *controlled, verifiable, un-jailbreakable*
pipeline (see §3), not a general chat agent. That constraint is the product — it's
what makes it safe to hand real money.

---

## 2. How it works (end-to-end)

```
Poster                          Sage                              Chain
──────                          ────                              ─────
fund a PolicyVault  ─────────────────────────────────────────▶  vault: budget,
                                                                 per-tx cap,
                                                                 velocity, duration
create a campaign  ──▶  title + criteria + reward + autonomy
share /c/<slug>

Worker
──────
submit work + evidence URL  ─▶  Deputy pipeline (after response):
                                 1. fetch evidence (x402 RAIL 1, or direct)
                                 2. LLM verifies vs criteria → decision receipt
                                 3. autopilot gate (engine=llm, pay, conf≥thr)
                                 4. pre-flight vault read
                                 5. CAS pending→settling (no double-pay)
                                 6. settle ───────────────────────────────▶  requestSpend:
                                                                              6 on-chain checks
                                                                              → Spent (USDC moves)
                                                                              or SpendRejected (blocked)
                                 7. journal + /proof/<tx> + Telegram announce
```

Every payout and every rejection is a real on-chain transaction with a public
`/proof/<tx>` page. The agent's cumulative record is anchored to its ERC-8004
identity and shown at `/agents/sage`.

---

## 3. The AI agent — the brain (in depth)

The brain is `src/lib/deputy/brain.ts` (`verifySubmission`) + the pure core in
`brain-core.ts`. It is **advisory**: it produces a decision; the vault enforces.

### 3.1 What it produces — the decision receipt

For one submission it returns a `DecisionBrief`:

| Field | Meaning |
|---|---|
| `engine` | `llm` (real model) or `heuristic` (honest fallback) |
| `model` | the model id that decided |
| `criteria[]` | each criterion: `met` + **verbatim `quote`** from the fetched evidence |
| `fraudSignals[]` | `{signal, severity, reason}` — injection, mismatch, spam |
| `recommendation` | `pay` / `review` / `hold` |
| `confidence` | 0..1 |
| `summary` | one-paragraph rationale |
| `evidenceOk` | was the evidence actually fetched + hashed |
| `contentSha256` | hash of the evidence read (tamper-evidence) |
| `latencyMs`, `costUsd` | ~$0.0003 per decision |
| `x402PaymentTx` | the real GOAT tx that paid for verification, or null |

This receipt is rendered in the review queue (`DeputyAssessmentCard`) so a poster
sees *exactly why* before anything settles.

### 3.2 The verification call

- Any **OpenAI-compatible** chat-completions endpoint. Configured with
  `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` (legacy `COMMONSTACK_*` fallback).
  Today: **CommonStack**, model `deepseek/deepseek-v4-flash` (gemini also works).
- Temperature 0, `response_format: json_object`, `max_tokens` 900, one repair
  retry on malformed JSON.
- **Retry: 3 attempts, 35s timeout each.** CommonStack is intermittently flaky;
  the retry rides through bad windows. If **all** attempts fail → the honest
  **heuristic** (keyword screen), clearly labeled `engine: heuristic`.

### 3.3 The hardening (why it can't be jailbroken into paying)

Four model-independent layers (`brain-core.ts`), validated by `tests/redteam/`:

1. **Untrusted-data delimiters** — the submitter's note + evidence are wrapped in
   `<<<UNTRUSTED_…>>>` markers; a system-prompt rule declares everything inside as
   *data, never instructions*; forged markers are stripped.
2. **Server-side injection detector** (`detectInjection`) — regex families for
   override-instructions / instruct-verdict / role-play-authority / jailbreak
   lexicon / hidden control chars. A match injects a **HIGH-severity fraud signal
   *before the LLM is even called*** — a backstop that works even if the model is
   fully compromised.
3. **Confidence ceiling** — capped at **0.5** whenever evidence couldn't be
   fetched, so "trust me, no link" can never clear the pay bar.
4. **Verbatim-quote enforcement** — fabricated quotes (not present in the fetched
   text) are dropped.

**Result: 15/15 adversarial attacks held** (deterministic suite + a live harness).
A worst-case fully-jailbroken model still cannot produce an auto-payable brief.

### 3.4 The pipeline + the autopilot gate

`runDeputyOnSubmission` (`pipeline.ts`) runs **after the HTTP response flushes**
(Next `after()`), so a slow/failing brain never delays or fails the submit. One
`correlationId` threads decision → gate → preflight → cas → settle for greppable
end-to-end traces.

**Autopilot pays autonomously only if ALL hold:**
`autonomy = autopilot` ∧ `status = pending` ∧ **`engine = llm`** ∧
`recommendation = pay` ∧ `confidence ≥ threshold (0.85)` ∧ no high-severity fraud
∧ (for GOAT mainnet, chainId 2345) **`DEPUTY_AUTOPILOT_MAINNET` armed**.

The critical safety property: **the heuristic can NEVER auto-pay.** If the LLM
fails, the Deputy holds for a human — an LLM outage can only make it *cautious*,
never wrong with money.

---

## 4. The Policy Vault (on-chain enforcement)

Solidity + Foundry (`contracts/PolicyVault.sol`, `PolicyVaultFactory.sol`), read/
written via viem behind one adapter (`src/lib/deputy/chain.ts`, `signer.ts`).

### 4.1 The six checks

Every `requestSpend` runs six checks in contract order; a failure emits
`SpendRejected(failedCheckIndex 1..6)` and **moves no funds** (it does *not*
revert — a graceful rejection, logged on-chain forever). Roughly: **1** vault
active (not paused/expired/revoked), **3** vendor approved, **4** per-transaction
cap, **5** remaining budget, plus velocity + validity. Pass all six → `Spent`,
USDC transfers.

> This is why a blocked/overspend tx reads "Success" on the explorer — the tx
> executed; the `SpendRejected` event *is* the refusal. `/proof/<tx>` says so.

### 4.2 State machine + a lesson learned

`Created → Funded → Active → (Paused | Revoked)`. Expiry = `activationTime +
duration` (immutable, **no renew** — allowances have a fixed lifetime by design).
`fund()` uses `safeTransferFrom` (approve first); `activate()` requires
`balance ≥ budgetCeiling` (so **fund amount must equal budget**). An **expired**
vault blocks every spend at check 1; there is no reactivation — you deploy a fresh
vault. (We hit this: the original demo vault expired, which is what actually
blocked early payouts.)

### 4.3 Per-chain

Each campaign carries a `chainId`; a registry (`networks.ts`) maps
**59902 = Metis Sepolia** (testnet) and **2345 = GOAT mainnet** (real money) to
RPC, USDC, explorer, and gas strategy (GOAT uses EIP-1559→legacy fallback).
Signing keys are per-chain.

---

## 5. User flow + surfaces

| Surface | What it is |
|---|---|
| **`/`** | Cinematic scroll landing (5 acts), bound to real vault + payout data |
| **`/app`** | The product: 4 tabs — **Agents / Wallet / Policies / Proof** |
| **`/c/<slug>`** | Public campaign page — anyone connects a wallet + submits work |
| **`/agents/sage`** | Public agent identity + grounded track record (ERC-8004 #79) |
| **`/proof/<tx>`** | Per-payout proof: human fact → machine proof → safety context |
| **`@sagedeputybot`** | Telegram bot: `/status <slug>`, `/agent`, `/start`; payout announces |

### 5.1 Onboarding (technical)

1. **Connect wallet** (MetaMask, injected).
2. **Sign in — SIWE-lite**: client GETs a nonce → builds a message with the
   **checksummed** address → wallet signs → server rebuilds byte-identical +
   `verifyMessage` → HMAC session cookie (`SAGE_SESSION_SECRET`, required in prod).
3. **Fund + activate a PolicyVault** (or use the shared demo vault). The create
   flow verifies **on-chain** that Sage's operator can release from the vault.

### 5.2 Create → submit → decide → pay

- **Create a campaign** (`NewCampaignForm`): title, description, acceptance
  criteria (one per line), reward (USDC), max recipients, and **Manual vs
  Autopilot** (press-and-hold to arm; threshold ≥ 85%).
- **Submit** on `/c/<slug>`: evidence URL is SSRF-validated; one submission per
  wallet, one per evidence URL (DB-enforced).
- **Review**: the poster sees the decision receipt per submission. **Manual** →
  "Approve & pay". **Autopilot** → confident clean matches settle themselves.
- Every outcome → journal event → `/proof/<tx>`.

### 5.3 Design system

Bloomberg-terminal aesthetic: **dense, monochrome, border-driven.** Deep ink
`#0A0E14`, paper white `#F8F9FA`; verdict colors reserved for state (green/amber/
red). **Inter** for UI, **JetBrains Mono** for data/addresses/numbers (tabular
figures). Hard constraints: no gradients, no glassmorphism, no emoji, 2–4px
radius, structure from 1px borders + spacing. A presentational motion layer
(`motion.css`) adds spring/elevation, count-ups, a breathing budget ring, and a
hold-to-create conic ring — all `prefers-reduced-motion` aware.

---

## 6. Integration state (each one, precisely)

### x402 — **live on GOAT mainnet**
- Real GOAT x402 handshake via `goatx402-sdk-server`. Merchant **`sage`** (DIRECT),
  agent wallet `0x0deF…44D6`. Two real end-to-end payments settled + facilitator-
  signed earlier. `isX402Live()` gates everything.
- **RAIL 1** — the Deputy *pays 0.1 USDC to verify evidence* (`/api/verify/evidence`
  behind a paywall). **RAIL 2** — an operator fee is *recorded* per payout and paid
  by the sweep (never blocks a payout).
- **Current caveat:** the agent wallet is **out of USDC on GOAT mainnet** (drained
  by test verifications), so RAIL-1 payments currently fail and **fall back to an
  honest unpaid direct fetch** — verification still works, the x402 chip shows
  "pending". Top up the GOAT wallet to re-enable paid verification.

### ERC-8004 — **live on GOAT mainnet**
- Registered agent **#79**, chain **2345**, registry `0x8004A169…a432`, wallet
  `0x0deF…44D6`. Listed on **8004scan.io/agents?chain=2345** (the submission
  dashboard). Reputation (`deriveReputation`) is derived from **real journal rows**,
  deduped by tx, and served at `GET /api/agent/card` (cached 60s).

### GOAT Network (2345) + Metis Sepolia (59902)
- Per-vault `chainId`. **Metis Sepolia = the working testnet demo chain.**
  **GOAT mainnet = real-money chain** (vault deployed + funded; autopilot armed but
  gated — see §7).

### OpenClaw / ClawUp — **agent live**
- **Sage Concierge** created on ClawUp (OpenClaw type, **GOAT & Metis Identity**
  preset with ERC-8004 + x402 Merchant skills bundled, model
  `routerbase/deepseek/deepseek-v4-flash` on managed credits, Telegram channel
  **`@sageconciergebot`**, agent id `f77f98fc-…`).
- Custom **`sage-deputy` skill** installed: it answers *"what has Sage paid?"* /
  campaign-status questions by fetching Sage's real public API
  (`/api/agent/card`, `/api/campaigns/<slug>/public`) — an honest window into the
  real product, not a rebuild of it.
- The **LLM credits** that power Sage's own brain (CommonStack) are the same
  discounted-model usage the bootcamp provides.

### LLM
- CommonStack, `deepseek/deepseek-v4-flash` (or gemini). Provider-agnostic
  (2-min swap to OpenRouter/OpenAI). ~$0.0003/decision. **Known issue:**
  intermittent hangs → the 3× retry + 35s timeout mitigate; a backup provider is
  the planned belt-and-suspenders for Demo Day.

### Telegram
- **`@sagedeputybot`** = Sage's own bot: `POST /api/telegram/webhook`
  (secret-gated), `/status` `/agent` `/start`, plus per-campaign settle/blocked
  announces. **`@sageconciergebot`** = the ClawUp concierge (separate bot).

---

## 7. Real on mainnet vs. testnet (the honest split)

| Thing | Metis Sepolia (59902) | GOAT mainnet (2345) |
|---|---|---|
| ERC-8004 identity | — | ✅ **#79, live, on 8004scan** |
| x402 merchant + payments | — | ✅ merchant `sage`, 2 real txs (wallet now needs USDC) |
| Policy Vault deployed + funded | ✅ fresh vault `0x9910…8915`, 2 USDC, active | ✅ vault `0x987b…0850`, 2 USDC, active |
| **Full autopilot loop** (submit → AI verify → auto-settle) | ✅ **PROVEN** — real 0.5 USDC payout, tx `0x757e45…`, `/proof` renders | 🟡 **armed, not yet exercised** (`DEPUTY_AUTOPILOT_MAINNET=true`, needs a submission + a go) |
| Where the demo runs today | ✅ here | ⏳ next |

**Plain english:** the *hard integrations* (identity + x402) are real on GOAT
mainnet. The *full autonomous loop* — AI verifies work and pays real USDC on its
own — is **proven end-to-end on Metis Sepolia** (real money moved, provable
on-chain). Flipping that same loop to real GOAT-mainnet money is armed and gated;
it runs the moment we point the dogfood at 2345 and submit — deliberately held
until final testing is done (the no-simulation rule is absolute).

---

## 8. Deployment + infra

- **Production VM** — Oracle ARM (Ubuntu 24.04). App under **pm2 `sage`** on
  `:3000`, started via **`start-sage.sh`** (sources `.env` on every boot/restart —
  the fix for a Next-doesn't-load-env gotcha). **nginx** vhost + **Let's Encrypt**
  cert → public at **https://sage.80.225.209.190.sslip.io** (sslip.io wildcard DNS;
  a branded domain is a one-line swap later). SQLite persists on real disk. Shares
  the box with an unrelated app (kyvern) — never disturbed.
- **GitHub** — **public** repo `github.com/shariqazeem/sage`, secret-scanned
  (no `.env`/keys published; ABIs checked in so it builds on clone).
- **Local** — the dev repo (`localhost:3000`) is where iteration + wallet testing
  happen.

---

## 9. Tech stack + quality gates

- **Next.js 15.5** (App Router, server-first RSC) · React 19 · **TypeScript strict**
  (no `any`, no `@ts-ignore`).
- **Solidity + Foundry** (PolicyVault) · **viem ^2** (all chain access).
- **drizzle-orm + better-sqlite3** (journal, submissions, decisions, campaigns).
- **Vitest** (240 passing unit/component tests incl. the red-team + failure
  drills) · **Playwright** e2e.
- Gates that must stay green: `lint · typecheck · test · build`.

---

## 10. Bootcamp deliverables (Stage 1)

| Deliverable | Status |
|---|---|
| x402 configured | ✅ live (GOAT mainnet) |
| Agent Identity registered (ERC-8004) | ✅ #79 on 8004scan chain 2345 |
| Funding requests submitted | ✅ done (gas + stables received) |
| Product Landing Page | ✅ cinematic landing |
| Project Website | 🟡 live at sslip.io (branded domain later) |
| Public GitHub repo | ✅ github.com/shariqazeem/sage |
| Seed User Definition | ✅ `docs/SEED_USERS.md` |
| Growth Metrics Proposal | ✅ `docs/GROWTH_METRICS.md` |
| ClawUp agent | ✅ Sage Concierge + `sage-deputy` skill |

---

## 11. Known gaps + what's next

1. **Demo reliability** — wire a backup LLM provider so a CommonStack hang can't
   kill a live payout on Demo Day (July 15). *(Highest leverage.)*
2. **Go mainnet-real** — point the dogfood at GOAT 2345 and run a real autonomous
   payout end-to-end, after final testing.
3. **Top up the GOAT wallet** with USDC so x402 RAIL-1 paid verification re-enables.
4. **Seed users** — onboard 10–20 cohort teams running real campaigns (traction is
   what Stage 2 grades). See `docs/SEED_USERS.md`.
5. **Branded domain** for the project website.
6. **Product name** — still open (candidates tracked separately).
