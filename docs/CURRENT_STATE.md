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
| `provider` | which provider host decided — records a fail-over to the fallback |
| `criteria[]` | each criterion: `met` + **verbatim `quote`** (the single most probative span) from the fetched evidence |
| `fraudSignals[]` | `{signal, severity, reason}` — injection, mismatch, spam |
| `recommendation` | `pay` / `review` / `hold` |
| `reasonCode` | machine-gradable dominant reason (`all_criteria_met` … `prompt_injection`) — seeds T+30 grading |
| `confidence` | 0..1, calibrated (0.85 = the autonomous-payment bar) |
| `summary` | forensic 3-part rationale: verdict + strongest evidence; strongest counter-evidence; what to check first |
| `evidenceOk` | was the evidence actually fetched + hashed |
| `contentSha256` | hash of the evidence read (tamper-evidence) |
| `latencyMs`, `costUsd` | ~$0.0003 per decision |
| `x402PaymentTx` | the real GOAT tx that paid for verification, or null |

This receipt is rendered in the review queue (`DeputyAssessmentCard`) so a poster
sees *exactly why* before anything settles.

### 3.2 The verification call

- Any **OpenAI-compatible** chat-completions endpoint. Configured with
  `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` (legacy `COMMONSTACK_*` fallback).
  Today: **CommonStack**, primary model `google/gemini-3.1-flash-lite-preview`
  (`deepseek/deepseek-v4-flash` is the red-teamed fallback model).
- Temperature 0, `response_format: json_object`, `max_tokens` 1200, one repair
  retry on malformed JSON.
- **Provider chain: primary → fallback → heuristic.** The primary is retried **3
  attempts, 35s each** (CommonStack is intermittently flaky; the retry rides bad
  windows). On exhaustion, a **fallback provider** (`LLM_FALLBACK_*`, a *different*
  provider — demo-day insurance) is tried **once**; a fallback success is still
  `engine: llm` and can auto-pay. Only if **both** fail → the honest **heuristic**
  (keyword screen), labeled `engine: heuristic`, which can never auto-pay.

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

**Anti-Sybil pre-check (`dedup.ts`).** Right after the gate, before any spend, a
pure `findDuplicate` compares the submission against every entry **already paid**
on the campaign — same evidence bytes (`contentSha256`) or the same report text
from a different wallet → **held, not auto-paid.** The vault already caps total
loss (budget + per-payout + velocity); this stops one person farming the seats
across many wallets. Exact-match first cut; the frozen brain is untouched.

The critical safety property: **the heuristic can NEVER auto-pay.** If the LLM
fails, the Deputy holds for a human — an LLM outage can only make it *cautious*,
never wrong with money.

---

## 4. The Policy Vault (on-chain enforcement)

Solidity + Foundry (`contracts/PolicyVault.sol`, `PolicyVaultFactory.sol`), read/
written via viem behind one adapter (`src/lib/deputy/chain.ts`, `signer.ts`).

### 4.1 The seven checks

Every `requestSpend` runs its checks in contract order; a failure emits
`SpendRejected(failedCheckIndex 1..7)` and **moves no funds** (it does *not*
revert — a graceful rejection, logged on-chain forever). **1** vault active (not
paused/expired/revoked), **2** authorized caller, **3** vendor approved, **4**
per-transaction cap, **5** remaining budget, **6** 24h velocity cap, and **7 the
replay guard** — this exact committed intent has not already settled. Checks 1–6
are the configurable *policy mandate* (the six spending limits a legitimate
payment passes); check 7 is an anti-double-pay safety invariant. Pass all seven →
`SpendSettled`, USDC transfers.

> This is why a blocked/overspend tx reads "Success" on the explorer — the tx
> executed; the `SpendRejected` event *is* the refusal. `/proof/<tx>` says so.

### 4.4 Real-money settlement safety (see `docs/PAYOUT_INVARIANTS.md`)

The payout path is defended in depth so every settlement is **at-most-once**,
**bound to the AI decision that authorized it**, and **always recorded** — even
across a crash:

- **Replay guard (on-chain).** Check 7 consumes an intent hash before the ERC-20
  transfer (Checks-Effects-Interactions); a used intent can never move funds
  again, and there is no setter to clear it. `SpendSettled`/`SpendRejected` carry
  an **indexed** `intentHash` so any settlement is locatable on-chain.
- **Decision commitment (off-chain).** `payout-commitment.ts` hashes the exact
  decision (recommendation, confidence, the criteria + verbatim quotes, fraud
  signals, model/provider, recipient, amount) into a `decisionDigest` via
  canonical ABI encoding, and the on-chain intent is derived from it. Change any
  committed field and the intent changes — a payout cannot be re-pointed at a
  different recipient/amount or a weaker judgment.
- **Durable attempt ledger (crash recovery).** `settlement_attempts` holds one row
  per intent; the tx hash is persisted the instant it is broadcast, and
  `settleWithRecovery` resumes from the persisted attempt (read the tx / verify
  `isIntentUsed`) instead of ever blind-resending.

Verified by `forge test` (replay invariants) plus `payout-commitment.test.ts`,
`settlement-attempts.test.ts`, and `settle-recovery.test.ts`.

> **Deployment note.** Replay protection + `isIntentUsed` exist only on vaults
> deployed from the *updated* `PolicyVault`. Vaults deployed before that upgrade
> (any pre-existing live GOAT/Metis vaults) lack check 7. The app now **enforces**
> this: on a mainnet chain the autopilot preflight probes
> `supportsIntentReplayProtection` and **HOLDS** for manual approval on a confirmed
> legacy vault (or an unreadable one) — it will not auto-pay real money from a vault
> that can't guarantee an intent settles at most once on-chain. The app-side ledger
> (Layer 3) still prevents re-pay for the common cases; the on-chain backstop
> (Layer 1) arrives when a vault is redeployed from the upgraded contract. New
> vaults get it automatically. This distinction — *application-ledger recovery* vs.
> *contract replay protection* — is kept explicit in the public copy.

### 4.5 The public proof (composer)

Every proof surface (the `/proof/[tx]` page, `GET /api/proof/[tx]`, the OG image,
the agent profile) reads ONE canonical composer, `composeProof(tx)`
(`src/lib/deputy/proof.ts`). It joins the chain receipt + decoded event, the
durable settlement attempt, the campaign, the submission, the stored decision, the
DecisionCommitmentV1 recomputation, and the vault capability, and returns an
explicit proof **state** (committed / legacy / mismatch / incomplete / not-found).
A committed proof recomputes the decision digest and compares three intent sources
(recomputed, stored, on-chain); *"Decision committed on-chain"* shows only when all
three agree, and a mismatch renders an integrity warning that can never read as
verified. Legacy payouts are honestly labelled as payment proofs, not
decision-commitment proofs. The x402 verification status is an explicit typed model
(`paid | live_fallback | not_configured | not_required | legacy_unknown`), so a null
payment tx is never mislabelled as "pending". See `docs/PAYOUT_INVARIANTS.md`.

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
| **`/`** | Cinematic 5-act landing; **Act 3 = the Deputy's real decision receipt** (agent-forward), bound to real vault + payout data |
| **`/app`** | The product: 4 tabs — **Agents / Wallet / Policies / Proof** |
| **`/c/<slug>`** | Public campaign page — anyone connects a wallet + submits work |
| **`/agents/sage`** | Public agent identity + grounded track record (ERC-8004 #79) |
| **`/proof/<tx>`** | Per-payout proof: human fact → machine proof → safety context |
| **`@sagedeputybot`** | Telegram bot: `/status <slug>`, `/agent`, `/start`; payout announces |

### 5.1 Onboarding — tap by tap

1. **Land on `/app`** → boot animation → **Connect wallet** (MetaMask/injected; a
   re-entrancy guard prevents the double-prompt).
2. **Sign in — SIWE-lite**: client GETs a nonce → message with the **checksummed**
   address → wallet signs → server rebuilds byte-identical + `verifyMessage` →
   HMAC session cookie (`SAGE_SESSION_SECRET`, required in prod).
3. **Meet the Deputy** → **set the limits** (budget · per-payout · daily) with
   +/− levers → **press-and-hold to create & fund** the wallet: the client mints
   test USDC (testnet only), deploys the PolicyVault, funds + activates it — every
   step signed by you, each tx hash shown. *(Today this path is Metis Sepolia; the
   GOAT-mainnet self-serve path is T6, next.)*

### 5.2 Create → submit → decide → pay (the tap flow)

- **Create a campaign** (in `/app`): title, description, acceptance criteria (one
  per line), reward (USDC), max recipients, **Manual vs Autopilot** (press-and-hold
  to arm; threshold ≥ 85%). Share the `/c/<slug>` link.
- **A worker submits** on `/c/<slug>`: an evidence link (SSRF-validated) + a note;
  one entry per wallet, one per evidence URL (DB-enforced). Their panel plays a
  live 3-beat: **verifying… → Verified NN% → Paid · proof**.
- **The Deputy verifies** (§3): fetches the evidence, quotes it, scores each
  criterion, emits a **decision receipt**. Autopilot auto-settles a confident,
  clean, **non-duplicate** match; otherwise it **holds** for the poster.
- **The poster reviews** in `/app`: the receipt materializes in; **Manual** →
  "Approve & pay"; on a founder-owned vault, approving co-signs the recipient
  allowlist (the Deputy never signs governance on a vault it doesn't own).
- Every outcome → journal event → a public **`/proof/<tx>`** page + a live ticker.

### 5.3 Design system — premium monochrome (light)

The interface is **editorial monochrome on warm white**, not a dark terminal:
paper `#fbfbf9`, ink `#1a1d21`, and **one rule — colour is reserved for money
state**: green `#15803d` = settled, red `#dc2626` = blocked. Every button, link,
and accent is **ink**, so the two hero moments (a payout, a block) are the only
colour on the page. **Inter** for UI, **JetBrains Mono** for data/addresses/hashes
(tabular). No gradients, no purple; soft cards + hairline borders; a presentational
`motion.css` layer (spring/elevation, count-ups, a breathing budget ring, receipt
"materialize", hold-to-create conic ring) — all `prefers-reduced-motion` aware.
The landing's **Act 3 is the star**: a real stored `DecisionBrief` from a settled
payout, printed in on scroll (criteria + verbatim quotes + the 85% notch) — the
agent reasoning, above the fold.

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
  (`/api/agent/card`, `/api/campaigns/<slug>/public`, and per-payout
  **`/api/proof/<tx>.json`** — the machine-readable receipt: chain proof + the
  decision brief) — an honest window into the real product, not a rebuild of it.
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
| **Full autopilot loop** (submit → AI verify → auto-settle) | ✅ **PROVEN** — real 0.5 USDC payout, tx `0x757e45…`, `/proof` renders | ✅ **PROVEN** — real 0.5 USDC settle → `0xDF70…90e3`, tx `0x56abc3f9…49cbe0`, block 13,713,095, gemini verified @95%, `/proof` renders |
| Where the demo runs today | ✅ here | ✅ **live — the flagship `founding-testers`** |

**Plain english:** everything real, on GOAT mainnet. The *hard integrations*
(identity + x402) were already live; the *full autonomous loop* — AI verifies
work and pays real USDC on its own — is now **PROVEN end-to-end on GOAT mainnet**:
on 2026-07-10 a real submission to `founding-testers` was gemini-verified at 95%,
cleared all six on-chain checks, and auto-settled 0.5 USDC to `0xDF70…90e3`
(tx `0x56abc3f9…49cbe0`, block 13,713,095). The same loop is also proven on Metis
Sepolia. Nothing is simulated — every payout is a real on-chain transaction.

---

## 8. Deployment + infra

- **Production VM** — Oracle ARM (Ubuntu 24.04). App under **pm2 `sage`** on
  `:3000`, started via **`start-sage.sh`** (sources `.env` on every boot/restart —
  the fix for a Next-doesn't-load-env gotcha). **nginx** vhost + **Let's Encrypt**
  cert → public at **https://sagepays.xyz** (branded domain, A record → the VM;
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
| Project Website | ✅ live at **sagepays.xyz** (branded domain) |
| Public GitHub repo | ✅ github.com/shariqazeem/sage |
| Seed User Definition | ✅ `docs/SEED_USERS.md` |
| Growth Metrics Proposal | ✅ `docs/GROWTH_METRICS.md` |
| ClawUp agent | ✅ Sage Concierge + `sage-deputy` skill |

---

## 11. Known gaps + what's next

**Done since the last update:** ✅ real GOAT-mainnet autonomous settle (§7, tx
`0x56abc3f9…`) · ✅ premium monochrome redesign + agent-forward Act 3 · ✅
anti-Sybil dedup · ✅ branded domain `sagepays.xyz`.

1. **T6 — self-serve mainnet vaults** *(next big build)*: let any user connect,
   fund their own PolicyVault on GOAT, and post a bounty. The server is already
   chain-parametrized; the work is the **client create-flow** (network toggle,
   `createDeputyVault(chainId)`, skip the test-USDC mint on mainnet, thread chainId
   through campaign-create). On a user's own vault the model is **"AI verifies, you
   approve each payout with one signature"** (self-custody).
2. **Demo reliability** — wire a backup LLM provider so a CommonStack hang can't
   kill a live payout on Demo Day (July 15).
3. **Top up the GOAT wallet** with USDC so x402 RAIL-1 *paid* verification
   re-enables (the in-loop charge currently falls back to an honest unpaid fetch).
4. **Seed users** — onboard cohort teams running real campaigns (Stage-2 traction).
   See `docs/SEED_USERS.md`; the flagship task is now **"Break the Deputy."**
5. **Semantic dedup + creator gates** — near-duplicate detection + optional
   per-campaign personhood/stake knobs (the dedup's next layer).
6. **Product name** — still open (candidates tracked separately).
