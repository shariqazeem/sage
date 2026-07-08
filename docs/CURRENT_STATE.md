# Sage — Current State (single source of truth for "where are we")

> This is the complete, current snapshot: what Sage is, how every piece works,
> what's real vs. pending, the demo, and the bootcamp gate. The pass-by-pass
> history lives in `docs/STATE.md`; this file is the clean "now."
> Last updated during the post-Pass-11 build (repositioning + reasoning surface +
> ERC-8004 identity panel).

---

## 1. What Sage is (repositioned)

**Sage is the control layer for AI agents that spend real money.** You give an AI
worker an *allowance, not your keys*: a budget and a rule. It pays real people for
real completed work, autonomously, from an on-chain **Policy Vault** it is
physically incapable of exceeding.

- **One-liner (landing):** "Give an AI agent an allowance — not your keys."
- **Positioning:** the allowance / payroll rail for the agent economy (Mercury/
  Ramp for AI workers), not a "bounty tool." Bounty & reward payouts are simply
  where the allowance gets spent first (the wedge), never the headline.
- **The guarantee:** the agent proposes *who* and *how much*; the vault decides
  *whether money can move*. Anything off-policy is blocked on-chain before funds
  move — even if the AI is wrong or compromised.

**Product names:** Sage = the platform. Deputy / Payout Deputy = the AI worker.
Policy Vault = the on-chain leash. (Final product name still open.)

---

## 2. Where we are — the bootcamp gate

Building for the **OpenClaw Summer Builder Bootcamp 2026** (GOAT / Metis / ClawUp
ecosystem) and the partner **Future Caribbean buildathon** (same project, applied
to both). Judged on product quality + real user traction + **real economic
activity**. Two required integrations gate Stage 2: **x402** + **ERC-8004**.

**Real timeline (from the onboarding guide):**
| Date | Milestone |
|---|---|
| **July 13** | Agents launched — x402 configured **and** ERC-8004 identity registered |
| July 15 | Stage-1 Demo Day |
| July 17 | Stage-1 ends — all deliverables due |
| July 20–22 | Qualification review |

**Status right now:** the entire product is built and green on Metis Sepolia. The
**x402 payment gate is LIVE and verified** — merchant `sage` approved, agent wallet
funded (5 USDC + BTC gas on GOAT mainnet), two real end-to-end payments settled +
facilitator-signed (see §13). The remaining gate item is (a) firing the ERC-8004
identity registration once the agent wallet has gas. Neither blocks further
product building.

---

## 3. Tech stack

- **Next.js 15.5** (App Router, server-first RSC), **React 19**, **TypeScript
  strict** (no `any`, no `@ts-ignore`).
- **On-chain:** Solidity + **Foundry** (`contracts/`); **viem ^2** for all chain
  access (no wagmi).
- **Persistence:** **drizzle-orm** over **better-sqlite3** (local `var/sage.db`,
  WAL) — swappable to Neon/Turso for deploy.
- **Auth:** SIWE-lite (wallet-signed, HMAC httpOnly cookie).
- **UI:** Tailwind-adjacent hand-authored CSS design system; **lucide** icons;
  Inter + JetBrains Mono; a canvas **BudgetRing** motif.
- **Tests:** **Vitest** (unit/component) + **Playwright** (E2E). **14 test files,
  71 unit tests, all green.** Gates: `typecheck · lint · test · build`.

---

## 4. How it works — the end-to-end flow

The product is one loop, real on every leg except where noted:

```
Poster (owner)                 Participant (worker)
  │ creates a campaign            │ opens the public link /c/<slug>
  │ (funds a Policy Vault,        │ connects wallet + signs in (SIWE)
  │  sets budget/caps/rule)       │ submits work + evidence URL
  ▼                              ▼
Campaign + on-chain vault  ◄──  Submission (deduped: 1/wallet, no reused evidence)
  │
  │  Poster opens the campaign in-app (Agents tab → campaign detail)
  │  ┌─ Deputy assessment (server-computed): criteria signals, spam risk,
  │  │  computed payout, recommendation (pay/review/hold)   ← the "reasoning"
  │  ▼
  │  Poster clicks "Approve & pay"
  │     ├─ Sage-owned vault: server allowlists recipient (owner==operator) →
  │     │  operator requestSpend → USDC settles
  │     └─ Founder-owned vault: owner signs the allowlist add (timelock
  │        countdown) → operator requestSpend → USDC settles
  ▼
Policy Vault runs 6 on-chain checks → SpendSettled (paid) or SpendRejected (blocked)
  ▼
Public proof page /proof/<tx>  +  ERC-8004 reputation  +  trustless work journal
```

**The two-actor model (the whole safety thesis):**
- **Owner** = the human (the poster). Owns the vault; signs governance: fund,
  activate, allowlist a recipient (timelocked), lower a cap, revoke. Never held
  by the AI.
- **Operator** = the Deputy's autonomous key (server-side). The *only* address the
  vault lets call `requestSpend`. It can pay within policy but can't change policy
  or allowlist recipients.
- That split is "give it a budget, not your keys." On the demo/Sage-owned vault
  owner == operator (one key) so the server runs the whole cascade; on a
  founder-created vault the owner is the founder's own wallet.

---

## 5. On-chain layer (Metis Sepolia · chain 59902)

### PolicyVault contract (`contracts/src/PolicyVault.sol`)
Holds USDC and enforces every spend. `requestSpend(vendor, amount, intentHash)`
**soft-rejects** (returns false + emits `SpendRejected` with a `failedCheckIndex`)
rather than reverting, so the UI can always show *why*. Six checks, in order:

| # | Check | Blocks when |
|---|---|---|
| 1 | state | vault paused / expired / revoked |
| 2 | caller | caller ≠ the authorized operator |
| 3 | vendor | recipient not on the approved allowlist |
| 4 | amount | amount > per-transaction cap |
| 5 | budget | would exceed remaining budget |
| 6 | velocity | would exceed the 24h velocity cap |

**Mutability rules (the "you can only tighten" story, enforced by the contract):**
- Budget ceiling, duration, payment token — **immutable**.
- Per-tx cap, velocity cap — **lowerable only** (`lowerPerTransactionCap`,
  `lowerDailyVelocityCap`); raising is impossible.
- Vendor adds — **timelocked** (`queueAddVendor` → wait → `executeAddVendor`);
  removals instant.
- Revoke — **terminal** (owner or guardian).
- Events: `SpendSettled`, `SpendRejected`, `VendorAddQueued`, `VendorAdded`,
  `PerTransactionCapLowered`, `DailyVelocityCapLowered`, `Revoked`, `Funded`, …

**Factory (`PolicyVaultFactory.sol`):** `createVault(operator, guardian, token,
budget, perTxCap, velocityCap, duration, initialVendors[], vendorTimelock)` via
CREATE2; `msg.sender` = owner. 35 Foundry tests pass.

### Deployed addresses (Metis Sepolia · chain 59902)
| What | Address |
|---|---|
| Policy Vault (demo, live) | `0x52A7Ae4e7812472C2F6D4A7eAf76EDD4475E6279` |
| Factory | `0x9b885D79c03A43D638195b72818CbCC2d496D9A2` |
| MockUSDC (public mint = free test USDC) | `0xF176f521290A937d81cc5878dfc19908f4D681A1` |
| Kill-demo vault (disposable, for "try to break it") | `0xEF5425AE80a6E3a198d63dA855EE3783D53EA7B8` |
| Operator (settling key) | `0xb77e6f5466cf52524e8465859277f192Be0bCfe4` |

RPC `https://sepolia.metisdevops.link`, explorer
`https://sepolia-explorer.metisdevops.link`. Metis needs **legacy gas**
(`gasPrice`, no EIP-1559) — every write path forces it. Dual-network config
(`DEPUTY_NETWORK`) has Metis Andromeda present-but-unused for a later flip.

### Server chain access
- `src/lib/deputy/chain.ts` (server-only) — viem public client, `getVaultState`,
  `getVaultPayoutHistory` (reads `SpendSettled`/`SpendRejected` logs = the proof
  trail), `getPayoutProof(tx)`, vendor + owner/operator + cap getters.
- `src/lib/deputy/signer.ts` (server-only) — loads the operator key from
  `contracts/.env`; `submitRequestSpend` (the real payout), `submitRevoke`,
  `ensureVendorApproved` (server-side allowlist add when we own the vault).
- `src/lib/deputy/reasons.ts` — `failedCheckReason(index)` maps 1..6 → human text.

---

## 6. The campaign layer (persistence + lifecycle)

### Data model (`src/lib/db/schema.ts`, migrations `0000`–`0002`)
- **campaigns** — id (slug), title, descriptionMd, criteria (json), conditionType,
  rewardAmount (USDC 6dp base units), maxRecipients, vaultAddress, posterWallet,
  ownerIsSage, status, createdAt.
- **submissions** — id, campaignId, wallet, evidenceUrl, note, dedupeKey, status
  (`pending`→`approved`→`paid`|`rejected`|`blocked`), rejectReason, payoutTx,
  decidedAt, createdAt. **Unique indexes:** one submission per (campaign, wallet)
  and no reused evidence URL — dedupe is a DB guarantee.
- **events** — the append-only work journal: kind (campaign_created,
  submission_received, submission_approved/rejected, vendor_queued,
  vendor_allowlisted, settled, blocked, revoked), detail, txHash, **logIndex +
  vaultAddress** (for chain-reconciled rows), amount, failedCheckIndex, createdAt.
  Unique index `(txHash, logIndex)` for idempotency.
- **vault_cursors** — per-vault last-reconciled block (for the trustless journal).

`src/lib/db/index.ts` is a **lazy proxy** (opens the DB on first query, never at
build) + runs migrations at init. `campaigns.ts` is the server-only repo (CRUD,
dedupe-aware `createSubmission`, event recording, cursor helpers, and
`ensureDemoCampaign()` — see §12).

### Data-access & pure logic (`src/lib/campaigns/`)
- `keys.ts` — `dedupeKey`, `submissionIntentHash(campaign, submission)` (the
  deterministic on-chain link), `nowSeconds`.
- `validate.ts` — SSRF-hardened evidence-URL validation (https-only,
  private/link-local/metadata host blocklist), reward/criteria/title checks.
- `status.ts` — the submission state machine.
- `settle.ts` / `settle-flow.ts` — the settle cascade (`ensureVendorApproved` →
  `submitRequestSpend`; persists paid + journals settled/blocked; triggers the
  reconciler).
- `reconcile.ts` + `reconcile-range.ts` — the **trustless journal reconciler**
  (§8).
- `journal.ts` — event → display derivation.
- `labels.ts` — `settlementLabel` + `buildIntentHashMap` (intent-hash → campaign/
  wallet, for the Wallet-tab history labels).
- `overview.ts` — `getDeputyOverview(wallet)`: the founder's real campaigns +
  counts + settled payouts + intent labels + approvedRecipients + journal.
- `assess.ts` — the Deputy's reasoning (§9).

### API routes (`src/app/api/`)
- **Auth:** `/api/auth/{nonce,verify,session}` — SIWE-lite handshake.
- **Campaigns:** `POST /api/campaigns` (create, on-chain check our operator can
  pay the chosen vault); `GET /api/campaigns/[id]` (poster-gated: campaign +
  submissions **+ Deputy assessment per pending row** + live vault; also runs the
  reconciler cheaply); `GET /api/campaigns/[id]/me` (caller's own submission);
  `POST …/submit` (participant, rate-limited, SSRF-validated, dedupe-enforced);
  `POST …/submissions/[sid]/decide` (approve → settle cascade | reject);
  `POST …/submissions/[sid]/settle` (re-fire settle after a founder allowlists).
- **Deputy:** `GET /api/deputy/overview` (session-gated overview refresh).
- **Vault demos:** `POST /api/spend` ("try to break it" real approved/blocked
  spends), `POST /api/kill` (revokes the disposable kill vault, never the live
  one). Rate limiting in `src/lib/rate-limit.ts`.

---

## 7. Auth — SIWE-lite (`src/lib/auth/`)
A wallet signs a nonce-bound message (`message.ts`, shared client+server so the
bytes match); verified with viem `verifyMessage`; the session is a **stateless
HMAC-signed httpOnly cookie** (7-day TTL, 10-min nonce). Client hook
`use-siwe.ts` wraps `use-wallet.ts` (connect → nonce → sign → verify). Every
security decision is server-side.

---

## 8. Trustless journal + reconciler (§ the honesty spine)
**Rule (final): journal entries derive ONLY from chain reads or server-side
actions — never client-authored.**

- App-side events (campaign_created, submission_received/approved/rejected,
  settled, blocked) are recorded server-side at the moment they happen.
- **Owner-signed vendor adds are on-chain events**, so they're journaled from the
  chain, not the client: `reconcileVendorEvents(vault)` reads `VendorAddQueued` /
  `VendorAdded` logs since the vault's cursor and folds new ones in, **idempotent
  by (txHash, logIndex)**. Range-capped at 50k blocks/call (`reconcileRange`,
  pure + tested) so a cold vault reconciles incrementally. Cursor lives in
  `vault_cursors`. Runs after any settle + cheaply on campaign-detail load.

---

## 9. The Deputy's reasoning + autonomy (the demo's 2nd hero) — full runbook: `docs/AGENT.md`
Each submission is verified by a real **CommonStack LLM brain**
(`deputy/brain.ts`, default `deepseek/deepseek-v4-flash`) producing a verifiable
`decisions` receipt (engine / model / criteria / fraud signals / recommendation /
confidence, verbatim-quote enforced). No key → a transparent **heuristic**
(`campaigns/assess.ts`) runs instead, labeled "LLM pending". **THE LLM PROPOSES,
THE VAULT DISPOSES.**

**Autonomy pipeline** (`deputy/pipeline.ts`): decision → gate (`autopilotGate`) →
preflight (courtesy vault read) → CAS `pending→settling` → settle via the vault.
Autopilot pays ONLY when autonomy=autopilot, status=pending, engine=llm,
recommendation=pay, no high-severity fraud, and confidence ≥ threshold — so the
keyless heuristic can **never** auto-pay (it holds). The Deputy never signs
governance (holds for the owner's allowlist signature) and never retry-loops a
failed spend (resets to pending). An **unreadable vault holds** → the sweep
retries once the RPC recovers.

**Hardening (this pass):** boot **env validation** (`lib/env.ts`, zod — malformed
values hard-fail with one startup line of live/pending); a **correlated agent
log** (`deputy/agent-log.ts`) — one JSON line per pipeline step under a run
`correlationId`, also embedded in the journal event `detail` as JSON (no schema
change); **failure drills** as tests (LLM timeout → heuristic + hold; RPC-fail
preflight → held; double-trigger → exactly one settle via CAS; expired sweep lock
→ recovers). Triggers: submit-time `after()` + the singleton-locked sweep
(`/api/deputy/sweep`; Vercel cron */5 + `deputy:watch`).

---

## 10. The app — one surface, four tabs (`/app`)
The premium app shell **is** the product. `sage-app.tsx` runs onboarding
(welcome → connect → fund → create → HOLD-TO-CREATE real founder-signed vault →
boot → app) and, for a returning founder, restores their vault from localStorage
and lands straight in the shell. `app-shell.tsx` renders four tabs:

- **Agents = campaign command center.** Payout Deputy hero (live BudgetRing) +
  the founder's real campaign list (title, status, reward, paid-of-max, "N to
  review" badge). Tapping a campaign opens **campaign detail in-shell**
  (`campaign-detail.tsx`): public-link copy chip + live vault numbers + the
  **ported review queue** (`review-panel.tsx`) — pending/approved/paid/rejected/
  blocked, the **Deputy assessment**, the **owner-signed allowlist → amber
  timelock countdown → settle** motion, and **settle-all**. "+ New campaign"
  opens **campaign create in-shell** (`campaign-create.tsx` → `new-campaign-form
  .tsx`). Not signed in → an in-shell SIWE gate.
- **Wallet.** Dark balance hero + a **Campaigns** section (committed vs settled
  per campaign, progress bar) + **settled-payout history** labeled `<campaign> —
  payout to 0x…` → each `/proof/<tx>` (real DB join; on the demo vault the
  on-chain log is labeled via `submissionIntentHash`).
- **Policies.** Six mutability-chipped cards from the founder's live vault; the
  one real mutation wired: **lower a cap** (`cap-control.tsx` + `lower-cap.ts`) —
  inline lower-only editor → weighty confirm ("cannot be raised back") → owner
  signs → re-reads from chain. Read-only lock on the demo vault. "Approved
  recipients" shows the founder's real count (no demo-vendor leak).
- **Proof.** The **ERC-8004 agent-identity card** (§11) + the on-chain vault/token/
  network/status rows + the **"Try to break it"** panel (real on-chain approved/
  blocked spends + real revoke on the disposable vault).

**Design vocabulary is unified** to `.sage-*` / `.sb-*` (in `src/app/app/app.css`);
`campaigns.css` was deleted. The only remaining `.hire`-classed bits are the Proof
tab's `hproof` rows + the `break-it` panel (pre-existing, non-campaign).

Old standalone poster routes (`/campaigns`, `/campaigns/new`,
`/campaigns/[id]/review`) now **redirect to `/app`** (guarded by `purge.test.ts`).

---

## 11. Public pages (what strangers & judges hit)
- **`/c/[slug]`** — the shareable campaign page, re-skinned to the app's design
  (`.sb-shell` + `.sage-agent-card`): title + task + criteria, a real **BudgetRing
  reading the campaign's reward pool live**, a **settled-payout feed** (each →
  `/proof/<tx>`), the same input/button system, and a "Be the first — payouts are
  real and on-chain" empty state. Wallet-optional; connect + sign + submit.
- **`/proof/[tx]`** — a single payout's public, verifiable receipt; reads one real
  tx + the real campaign title (matched by payout tx). Stands alone when shared
  cold.
- **`/`** — the repositioned landing (allowance / control-layer framing, live
  vault hero + real payout feed). `/hire` → `/`; `/sage` is the old placeholder.

---

## 12. The one seeded row — Sage's real dogfood campaign
`ensureDemoCampaign()` seeds (idempotent, id `demo`, renames in place) **"Break
Sage's onboarding — get paid"**: create your own Deputy vault via `/app`
onboarding, submit your vault/campaign link + a friction note; $10 USDC per
accepted tester from the Sage-owned vault. It starts with **zero submissions**
(no fabricated data). `/c/demo` is the cohort-Telegram link. No other fixtures
exist — everything else is a real on-chain event or a real user-created row.

---

## 13. Integrations — x402 + ERC-8004 + GOAT (status + config)

> Every integration's live/pending status is validated + printed at boot by
> `src/lib/env.ts` (zod — missing is fine, malformed hard-fails). Example line:
> `[sage] boot · env OK · network=metis-sepolia(59902) · LLM=live(deepseek/deepseek-v4-flash) · x402=live(merchant:sage) · ERC-8004=pending · Telegram=off · db=var/sage.db`

### ERC-8004 (identity gate) — **prepared, waiting on gas**
- Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on **GOAT Mainnet chain
  2345** (RPC `https://rpc.goat.network`). Method `register(string name)`; recover
  agentId from the ERC-721 Transfer event; verify `getAgentWallet(agentId)`. Gate
  = appear on `https://8004scan.io/agents?chain=2345`.
- **`scripts/register-erc8004.mjs`** — viem, GOAT chain, reads
  `GOAT_AGENT_PRIVATE_KEY`, refuses to send at 0 balance, registers, recovers +
  verifies the agentId, and **writes `ERC8004_AGENT_ID/_ADDRESS/_NAME` to `.env`**
  on success (legacy-gas retry built in). Run: `node scripts/register-erc8004.mjs
  Sage`.
- **`src/lib/erc8004/identity.ts`** + the **Proof-tab identity card** — render the
  "Pending" state now; flip to "Registered" (name, id, address, 8004scan link)
  automatically once the script writes `.env` + the app restarts.
- **Grounded reputation (live in BOTH pending + registered states):**
  `reputation-core.ts` (pure `deriveReputation` + `toReceipts`, unit-tested incl.
  the empty state) + server `reputation.ts` derive the Deputy's work record from
  real rows ONLY — settled USDC + payout/blocked counts from the journal
  (chain-reconciled amounts), distinct recipients from paid submissions, decision
  stats (count / avg confidence / engine mix) from `decisions`. Zeros render
  honestly; nothing is self-asserted.
  - **Public page `/agents/sage`** (RSC, shareable cold, own premium-calm scoped
    CSS `.sag` matching `/proof`): identity card (pending + registered), stats in
    mono/number language, recent receipts (each → `/proof/<tx>`), recent decision
    summaries. Dynamic OG/canonical metadata for GEO; `/proof/[tx]` now carries
    rich per-tx metadata too (one shared chain read via React `cache`).
  - **Canonical agent URI = `GET /api/agent/card`** → `{ name, description, url,
    wallet, agentId?, chainId: 2345, registry, registered, stats }`, cached 60s
    (noted atop `register-erc8004.mjs` + `src/lib/site.ts`). `wallet` = the
    ERC-8004 address once registered, else the derived GOAT agent wallet.
  - **Proof tab** shows live headline stats (settled total / payouts / blocks) +
    a "View public track record →" link to `/agents/sage`.
  - New DB reads in `db/campaigns.ts`: `listEventsByKinds`,
    `listPaidRecipientWallets`, `listAllDecisions`, `listRecentDecisions`.
- **Dedicated agent wallet:** `0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6` (key in
  `contracts/.env` as `GOAT_AGENT_PRIVATE_KEY`, gitignored). This is the agent
  identity + x402 DIRECT-receive wallet. Fund it with a few $ of BTC gas on GOAT.

### x402 (payments/monetization gate) — **LIVE + VERIFIED on GOAT mainnet**
- `goatx402-sdk-server` installed; facilitator **`https://x402-api.goat.network`**
  (the documented `api.x402.goat.network` does NOT resolve — this is the real
  base); min 0.1 USDC; GOAT mainnet chain 2345; USDC
  `0x3022b87ac063DE95b1570F46f5e470F8B53112D8`; agent (payer) key
  `GOAT_AGENT_PRIVATE_KEY`.
- **Live-verified 2026-07-05.** Merchant `sage` (`receiveType DIRECT`); agent/payer
  `0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6` funded with 5 USDC + ~0.00001 BTC
  gas. Three real end-to-end payments settled + facilitator-signed (all `INVOICED`
  + signed proof): `0x46087c70…fc1225`, `0x0887cd49…5bafe1` (self-custody tests),
  and — after switching the receiving address to a **separate** MetaMask
  `0xDF70…890e3` — `0xcd2a46c2…14e4`, a **real outflow**: 0.1 USDC left the agent
  (5→4.9) and landed in the merchant wallet (0→0.1). Switching the receiver is
  pure portal config; my code reads `payTo` from the order, never hardcodes it.
- **State-machine finding (caught by the live test):** a **DIRECT** merchant
  settles a confirmed transfer to **`INVOICED`** (tx recorded, `confirmed_at`
  stamped, signed proof issued) — that is terminal SUCCESS, *not* an intermediate
  step. `PAYMENT_CONFIRMED` is the DELEGATE-custody terminal. The SDK's own
  `waitForConfirmation` (and our first cut) only treated `PAYMENT_CONFIRMED` as
  terminal and **hung until timeout** against DIRECT. Fixed via
  `settleStatus(status)` in `payer-core.ts` (INVOICED|PAYMENT_CONFIRMED → paid;
  FAILED|EXPIRED|CANCELLED → failed; else pending), used by the payer's terminal
  check + the middleware's `confirmed` gate; `payer.ts` replaces the SDK wait with
  an INVOICED-aware `getOrderStatus` poll. Observed live: `CHECKOUT_VERIFIED`
  (pre-pay) → `INVOICED` (settled).
- **Both rails implemented against the real protocol** (SDK = merchant HMAC
  client: `POST /api/v1/orders` → 402 → poll status → `/proof`; payer transfers
  USDC to the order's `payTo` on GOAT). `isX402Live()` (the 3 merchant creds
  present) gates EVERYTHING; when false the paywall bypasses and the honest
  "pending merchant approval" chips remain — nothing is ever simulated.
  - **RAIL 1** (Deputy pays for verification): `POST /api/verify/evidence` behind
    `withX402Paywall`; `src/lib/x402/payer.ts` does call→402→pay→poll→retry; the
    decision stores `x402PaymentTx`; the brief chip shows "Verification paid · 0.1
    USDC · <tx>" (live) vs "x402 pending merchant approval".
  - **RAIL 2** (operator fee): `chargeOperatorFee(settleTx)` records a pending fee
    per settled payout (never blocks/fails a payout); the sweep's `payPendingFees`
    pays 0.1 USDC agent→merchant over the rail; Wallet shows an "Operator fees"
    line, Proof shows the rail status + total fees paid.
- Files: `src/lib/x402/{facilitator,goat-pay,goat-client,payer-core,payer,middleware,verify-evidence,fees}.ts`.
- **Receiver = separate MetaMask `0xDF70…890e3` (real outflow, chosen for the demo).**
  Each 0.1 USDC actually leaves the agent → merchant (5 USDC = 50 payments; top up
  the agent for more). Self-custody (payer==payTo) is the alternative — real +
  proven but net-zero; both honest, no code change to switch (portal only).
- **Fee balance / Topup** (`x402-merchant.goat.network` → PAYMENTS → Topup) = GOAT's
  PREPAID facilitator-fee pool, deducted **per order at `createOrder`**. A DIRECT
  merchant pays it from this pool, not the payment. Docs say $0 blocks createOrder
  (`insufficient fee balance`), but our 0.1-USDC orders create fine at $0.00 (fee
  ≈$0 at this size / small grace) — top up a few $ for demo safety. If ever blocked,
  the app degrades honestly (RAIL 1→unpaid fetch, RAIL 2→pending fee; never fakes).
- **Activation (done):** `GOATX402_API_KEY / _API_SECRET / _MERCHANT_ID /
  _API_URL` set in `.env`; agent wallet funded with USDC + BTC gas on GOAT.

### GOAT Network deposit facts
Native gas = **BTC**. Bridge = `bridge.goat.network` (Bitcoin L1 → BTC, **min
0.0002 BTC**, Receive tab + custom EVM address). **No CEX (Binance) direct-to-
GOAT** — withdraw BTC on the Bitcoin network then bridge. **BTCB from BNB does not
pay gas.** USDC isn't on the direct bridge (comes from the bootcamp stables form
or a GOAT DEX).

---

## 14. What's real vs. pending (honest)
**Real, on-chain, verified:** vault deploy + all reads/writes; founder-signed vault
creation; the campaign loop (create → submit → review → approve → allowlist →
settle → proof); real USDC settlements on Metis; the trustless journal reconciler;
SIWE auth; DB persistence + dedupe indexes; the landing's live vault hero/feed; the
**real LLM brain** (CommonStack, verifiable receipts) with an honest heuristic
fallback; the **autonomy pipeline** (gate → preflight → CAS → settle) + the
singleton-locked sweep; **x402 payment rails LIVE + verified on GOAT mainnet**
(both rails, facilitator-signed proofs); the **grounded ERC-8004 reputation**
surfaces (`/agents/sage`, `/api/agent/card`, Proof tab); **boot env validation +
correlated agent log + failure drills**; the **GOAT mainnet payout rail** — a real
policy vault (`0x987b…0850`, 2 USDC budget=fund, active) deployed + funded + running
ALONGSIDE the Metis Sepolia testnet flows, resolved per-vault by `chainId`
(`src/lib/deputy/networks.ts`, EIP-1559 gas); cap lowering; the whole app + public
surfaces.

**Registered + both gates closed:** ERC-8004 identity **#79** on GOAT mainnet
(agent `0x0deF…44D6`), and the GOAT mainnet payout rail (factory `0x09c9…20FC`,
vault `0x987b…0850`). Both July-13 hard gates are closed. Mainnet autopilot is now
**ARMED** (`DEPUTY_AUTOPILOT_MAINNET=true`) after the red-team pass (docs/AGENT.md
§8): the dogfood runs `autonomy=autopilot` on `deepseek/deepseek-v4-flash`
(threshold 0.85), auto-paying confident, clean, matching submissions. No attack
could force a pay — 15/15 held live (deepseek, 4 runs) plus a deterministic
hardening guarantee (injection detector → high fraud, 0.5 confidence ceiling on
unfetchable evidence, verbatim quotes, untrusted-data delimiters). The testnet
playground + testnet campaigns are unaffected; the vault caps enforce regardless.

**Honest limitations:** the connect→sign→submit, Approve-&-pay, and cap-lowering
signatures need a real injected wallet (+ testnet gas) — render/route/DB verified
here, the on-chain leg runs when a real user acts.

---

## 15. The demo (how to run it, and the two heroes)
Run `npm run dev`, open `/` (repositioned landing, live vault) → **Hire your first
Deputy** → `/app`. Onboarding: connect a wallet on Metis Sepolia (tMETIS gas), set
budget/caps, **HOLD TO CREATE** (real founder-signed: mint test USDC → createVault
→ approve → fund → activate). You land in the four-tab app on your own vault.

**Hero 1 — the gauntlet (Proof tab → Try to break it):** approved spend settles
real USDC; over-cap spend is **blocked on-chain** (`SpendRejected`, exact check);
revoke kills a disposable vault for good. "No funds moved. Enforced on-chain."

**Hero 2 — the Deputy reasons (Agents → campaign detail):** open a campaign with a
pending submission; the **Deputy assessment** shows it matched the criteria, scored
spam, computed the exact payout, and recommends paying — *then* you approve and the
settle cascade runs to a public `/proof/<tx>`. Worker, not escrow-with-a-watcher.

Public artifacts to share cold: **`/c/demo`** (the dogfood campaign) and any
**`/proof/<tx>`**.

---

## 16. Stage-1 deliverables (mention + status)
| Deliverable | Status |
|---|---|
| Agents launched (x402 + ERC-8004 identity) | prepared; ERC-8004 fires on gas, x402 on creds |
| Public GitHub repo | to push |
| Project website / product landing page | ✅ live (`/`, repositioned) |
| Seed User Definition | to draft (next) |
| Growth Metrics Proposal | to draft (next) |

---

## 17. Project layout (key files)
```
contracts/            PolicyVault.sol, PolicyVaultFactory.sol, interfaces/ (Foundry, 35 tests)
scripts/register-erc8004.mjs        one-shot ERC-8004 registration on GOAT
drizzle/0000–0002.sql               migrations (campaigns, submissions, events, vault_cursors)
src/app/
  page.tsx / components/landing/     repositioned landing (live vault)
  app/{layout,page}.tsx + app.css    the four-tab app shell (unified .sage-*/.sb-* design system)
  (campaigns)/c/[slug]/page.tsx      public campaign page (re-skinned)
  (campaigns)/campaigns*/            → redirect to /app (folded in-shell)
  proof/[tx]/page.tsx                public per-payout proof
  api/…                              auth · campaigns · deputy/overview · spend · kill
src/lib/
  deputy/{chain,signer,reasons}.ts   on-chain reads + operator writes (Metis)
  db/{schema,index,campaigns,keys}   drizzle persistence + repo
  campaigns/{overview,settle,settle-flow,reconcile,reconcile-range,journal,labels,assess,validate,status}.ts
  wallet/{create-vault,vendor-add,lower-cap,cap,allowlist-state,read-vault,use-wallet,abis,config}.ts
  auth/{message,session,use-siwe}.ts SIWE-lite
  erc8004/identity.ts                agent identity model (GOAT / 8004scan)
  x402/facilitator.ts                honest x402 seam (activates on creds)
  rate-limit.ts, format.ts, purge.test.ts
src/components/
  app/{app-shell,sage-app,budget-ring,traveling-ring,connect-wallet,deputy-detail,
       campaign-list,campaign-detail,campaign-create,cap-control}.tsx
  campaigns/{review-panel,submit-panel,new-campaign-form,deputy-assessment}.tsx
```

---

## 18. Wallets, config & how to run
**Env** (`.env` gitignored) — `NEXT_PUBLIC_VAULT/FACTORY/USDC/KILL_VAULT/OPERATOR_
ADDRESS`, `METIS_SEPOLIA_RPC`, `DEPUTY_NETWORK`; on register: `ERC8004_AGENT_ID/
_ADDRESS/_NAME`; for x402: `GOATX402_API_KEY/_SECRET/_MERCHANT_ID`. Operator +
agent keys live in `contracts/.env` (`OPERATOR_PRIVATE_KEY`, `GOAT_AGENT_PRIVATE_
KEY`), gitignored. (Stale unused `COMMONSTACK_*`/`EXA_API_KEY`/`AGENT_MODEL` from
the deleted lead-gen agent can be removed.)

```bash
cd contracts && forge build      # required: app imports ABIs from contracts/out (gitignored)
npm run dev                      # http://localhost:3000
npm run typecheck && npm run lint && npm run test && npm run build   # gates (all green)
node scripts/register-erc8004.mjs Sage    # ERC-8004 identity (once the agent wallet has GOAT gas)
```

---

## 19. What's next (unblocked, no gas/creds needed)
1. **Stage-1 deliverable docs** — Seed User Definition + Growth Metrics Proposal.
2. **LLM upgrade to `assess.ts`** — semantic criteria-matching (needs an LLM key);
   makes "it reasons" fully true for Demo Day.
3. **Align `CLAUDE.md`** — it still carries the pre-pivot "token investigator"
   spec; `docs/perfect_idea.md` + this file are the real product.
4. **On gas/creds:** run the ERC-8004 registration; wire the live x402 rail.
5. **Public deploy** (Vercel + hosted DB) so `/c/demo` is shareable externally.
