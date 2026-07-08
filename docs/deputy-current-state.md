# Deputy / Stipend — Current State (complete)

> The single source of truth for what's built today: the idea, the design, the
> user flow, every technical detail, and what's real vs. demo vs. not-yet.
> Use this to decide the idea. Everything marked **live** is real and verified —
> no mock. Working name **Deputy** (alt: **Stipend**); name still open.

Repo: `Next.js 15 (App Router, RSC) · React 19 · TypeScript strict · viem · Foundry`.
On-chain: **Metis Sepolia** (chainId 59902).

---

## 1. The idea we've been building on

**Hire an AI worker. Give it a budget, not your keys.**

You hire an AI **operator**, fund it with a **capped budget**, and give it a goal.
It does real economic work — it reasons, **pays its own budget on-chain** for the
data/services it needs, and returns results. An on-chain **Policy Vault** enforces
the budget, the vendor allowlist, the spend caps, and an instant kill switch — so
the AI can spend, but it **physically cannot** overspend, pay an unapproved party,
or keep running after it's revoked, *even if the agent key or backend is fully
compromised*. **The AI proposes; the chain enforces.**

- **Flagship worker (the "job"):** a **Growth Operator** — give it a goal + a
  budget and it finds and qualifies real leads, paying for data as it goes.
- **The wedge:** people don't trust AI agents with money/access. Deputy is the
  agent you *can* hire, because the vault is a hard leash.
- **For:** the OpenClaw Summer Builder Bootcamp (Metis / GOAT / LazAI). Graded on
  product quality, **real users**, and **real economic activity**. Required
  integrations: **x402** (payments) + **ERC-8004** (identity).

> **The open decision (what you're deciding now):** the *infrastructure* (vault +
> agent + x402) is real and is the moat — keep it. The thing to lock is **which
> job the flagship worker does**, plus the **business model** (a membership +
> vault-as-billing idea is noted but not built). See §13.

---

## 2. Current state at a glance

| Layer | Status | Notes |
|---|---|---|
| On-chain enforcement (Policy Vault) | ✅ **live on Metis Sepolia** | budget / vendor / caps / revoke, all enforced on-chain |
| Real spend settlement | ✅ **live** | `requestSpend` settles real USDC; over-cap/unapproved soft-reject on-chain |
| Kill switch (terminal revoke) | ✅ **live** | verified: a revoked vault blocks all spends |
| The agent does real work | ✅ **live** | reasons (LLM) → searches real data → qualifies → real leads |
| Agent pays on-chain per action | ✅ **live** | each data query = a real `requestSpend`; verified vault drain |
| Live streaming of the agent | ✅ **live** | watch it work in real time |
| x402-style vendor payment flow | ✅ **live (payment real, vendor demo)** | 402 → pay via vault → vendor verifies on-chain → unlock |
| Premium light product UI (`/hire`) | ✅ **live (local)** | the judge-facing surface; running locally, not deployed |
| Membership / billing model | ❌ **not built** | a thought (vault auto-deducts fees, free trial) |
| ERC-8004 identity + reputation | ❌ **next** | reference registries deployable to Metis |
| LazAI verifiable trail | ❌ **next** | immutable spend/decision/outcome receipts |
| Production x402 (facilitator) | ❌ **next** | no public facilitator on Metis; self-host or GMPayer |
| Public deployment + real users | ❌ **next** | app runs on localhost today |

**One-line summary:** the hard, defensible half — *real on-chain enforcement +
an agent that does real paid work* — is built and live. What's missing is the
go-to-market half: a deployed product, real users, the integrations, and the
business model.

---

## 3. The product surfaces & user flow

Five surfaces. The **primary, judge-facing** one is `/hire`.

| Route | What it is | Status |
|---|---|---|
| `/hire` | **Primary.** Premium light landing → live agent run → proof → "try to break it" | ✅ the main product |
| `/` | redirects to `/hire` | ✅ |
| `/x402` | x402 agent-commerce demo (vendor payment, policy-enforced) | ✅ |
| `/console` | the older **dark** live-agent console | ✅ kept, secondary |
| `/operators/[id]` | operator detail page (live vault truth + the "Gate" replay of real spend/revoke) | ✅ |
| `/dashboard`, `/create`, `/sage` | operator list, create form, old Sage placeholder | ✅ minor |

### The `/hire` user flow (top to bottom)
1. **Hero** — "Hire an AI worker. Give it a budget, not your keys." + two CTAs
   (Hire Growth Operator / Watch live proof) + four trust pills (Live on Metis
   Sepolia · Real on-chain spend · Budget-enforced · Instant revoke).
2. **How it works** — 3 steps: Set the mandate → Fund the vault → Watch it execute.
3. **The vault is the boss** — 4 guarantee cards (Budget ceiling · Vendor allowlist
   · Spend caps · Kill switch) — "enforced by the contract, not the AI."
4. **Live work** — type a goal + ideal customer + budget, hit *Start operator run*,
   and watch a calm **work journal** stream: planning → paying on-chain (with
   "Settled on-chain ↗" explorer links) → searching → qualifying → real lead cards.
5. **Agent commerce** — a short section + mini-card linking to `/x402`.
6. **Proof** — reads the **live vault** on each load: addresses (copy buttons +
   explorer), budget ceiling, per-tx cap, remaining budget, status.
7. **Try to break it** — three real on-chain actions: approve a spend, try to
   overspend (rejected), pull the kill switch (disposable vault). *"The rejection
   is not a frontend simulation. It is an on-chain policy decision."*
8. **Final CTA** — "This is not an agent demo. It is an economic worker with a leash."

### The `/x402` flow
Pick a vendor resource → *Run x402 payment* → a live handshake timeline:
request → **402** → pay through the vault → policy result → retry with receipt →
**unlock or block** → a proof card. Two resources settle ($0.05, $0.12); one is
priced over the cap ($26) and is rejected.

---

## 4. Design system

**Direction (locked):** premium, calm, light, white — Apple / Stripe / Linear /
Mercury / Arc. **Not** a dark command center, not neon, not crypto-dashboard, not
a busy metric wall. *"Hiring a trusted worker, not configuring software."*

Three scoped CSS layers (no leakage between them):
- **`globals.css`** — base (fonts, Sage dark defaults). Fonts: **Inter** (UI) +
  **JetBrains Mono** (data/addresses, tabular figures).
- **`hire/hire.css`** — **the primary surface** (`.hire` scope). Warm off-white
  `#fbfbf9`, charcoal ink `#1a1d21`, restrained **indigo `#4f46e5`** for action,
  **green `#15803d`** for settled/verified, **red `#dc2626`** for blocked/revoked.
  Soft shadows, generous whitespace, modern cards, 14–16px radii. `/x402` reuses
  this exact scope + design.
- **`console/console.css`** — the older **dark** console (`.console`): near-black,
  electric-indigo accent. **Secondary** now (kept, not deleted).
- **`(deputy)/deputy.css`** — the earlier light "operator detail" surface (`.deputy`,
  Mercury-style), used by `/operators/[id]` and the Gate.

Color discipline: indigo = action/proof only; green = verified/settled only; red =
blocked/revoked only. No gradients-as-decoration, no glassmorphism, line icons (lucide).

---

## 5. Architecture (four layers)

```
            ┌──────────────────────────────────────────────┐
  USER ────▶│  UI · Next 15 RSC + light design system       │
            │  /hire (primary) · /x402 · /console · /operators│
            └───────────────┬──────────────────────────────┘
                            │ server actions / API routes
            ┌───────────────▼──────────────────────────────┐
  AGENT ───▶│  Agent engine · src/lib/agent/                 │
            │  plan → PAY → search real data → qualify       │
            │  brain: CommonStack    hands: Show HN / Exa    │
            └───────────────┬──────────────────────────────┘
                            │ every paid action = a spend intent
            ┌───────────────▼──────────────────────────────┐
 x402 ─────▶│  x402-style vendor · src/lib/x402/             │
            │  402 → pay → verify on-chain → unlock          │
            └───────────────┬──────────────────────────────┘
                            │ settles through ↓
            ┌───────────────▼──────────────────────────────┐
ENFORCE ───▶│  PolicyVault on Metis Sepolia (Foundry/Solidity)│
            │  G1 budget · G2 vendor · G3 caps · G4 revoke   │
            │  signer (operator key) → requestSpend / revoke │
            └──────────────────────────────────────────────┘
```

---

## 6. On-chain layer (the moat) — LIVE

**Network:** Metis Sepolia, chainId **59902**, gas `tMETIS`.
Explorer: `https://sepolia-explorer.metisdevops.link` · RPC: `https://sepolia.metisdevops.link`.
Dual-config: Metis Andromeda (mainnet) present but unused — flipping is **env-only**
(`DEPUTY_NETWORK=metis-andromeda`), zero code change. Metis needs **legacy** txs.

**Deployed contracts:**

| Contract | Address |
|---|---|
| PolicyVault (primary operator vault) | `0x52A7Ae4e7812472C2F6D4A7eAf76EDD4475E6279` |
| PolicyVaultFactory | `0x9b885D79c03A43D638195b72818CbCC2d496D9A2` |
| MockUSDC (6-dec settlement token) | `0xF176f521290A937d81cc5878dfc19908f4D681A1` |
| Kill-demo vault (disposable, revoked) | `0xEF5425AE80a6E3a198d63dA855EE3783D53EA7B8` |

**PolicyVault** (`contracts/src/PolicyVault.sol`) — one per operator. Holds the
user's USDC; the operator (AI key) can only *propose* spends via `requestSpend`.
Guarantees enforced by construction:
- **G1 budget ceiling** — total settled spend can never exceed it (immutable).
- **G2 vendor allowlist** — funds only move to approved vendors (timelocked add,
  instant remove).
- **G3 caps** — per-transaction cap + rolling 24h velocity cap (both lowerable-only).
- **G4 revoke** — owner/guardian revoke is **terminal**.

`requestSpend(vendor, amount, intentHash)` runs checks in order and **soft-rejects**
(returns false + emits `SpendRejected`, moves no funds) — never reverts on policy
failure, so the UI knows exactly which check failed:

| Index | Check | Guarantee |
|--:|---|---|
| 1 | Active & not expired | G3/G4 |
| 2 | Caller is the operator | — |
| 3 | Vendor approved | **G2** |
| 4 | Amount ≤ per-tx cap | G3 |
| 5 | totalSpent + amount ≤ ceiling | **G1** |
| 6 | Within 24h velocity cap | G3 |

On success: USDC transfers, `SpendSettled` is emitted. The primary vault's policy:
**500 USDC ceiling, $25/tx cap, $100/day velocity, 14-day duration** (remaining
drains live as the agent works). **35 Foundry tests, `forge build` clean. `.sol` is
frozen** — all later work is scripts/app/env.

Deploy tooling (no `.sol` changes): `contracts/script/Deploy.s.sol`,
`CreateVault.s.sol`, `deploy-sepolia.sh`, `deploy-kill-vault.sh`.

---

## 7. The agent (does real economic work) — `src/lib/agent/`

A real agent loop — **not an LLM wrapped around a script.**

- **Brain — `llm.ts`:** **CommonStack** (OpenAI-compatible, `api.commonstack.ai`),
  default model `deepseek/deepseek-v4-flash` (cheapest, swappable via `AGENT_MODEL`).
  Server-only; `chat()` + `chatJson()` (JSON extraction + one repair retry).
- **Hands — `tools.ts`:** real data. **Show HN** (keyless Hacker News Algolia,
  `tags=show_hn` — the authors *are* the founders) by default; **Exa** as a
  drop-in upgrade when `EXA_API_KEY` is set.
- **Loop — `growth-operator.ts`:**
  1. **Plan** — model proposes up to 3 search queries from the goal + ideal customer.
  2. **Pay + search** — for each query, a **real `requestSpend` ($0.05) settles
     on-chain through the vault** (budget enforced *before* the data is fetched);
     if the vault blocks it, the agent stops. Then it runs the real search.
  3. **Qualify** — model scores every candidate 0–100, keeps 50+, ranks them.
  4. **Outcome** — returns ranked leads + metered spend + a feed.
  Every step emits a `FeedEvent` with real timing (and explorer links for spends).

**Verified run:** goal "find founders who launched AI dev tools" → 3 real on-chain
payments → ~18 real Show HN candidates → ~6–9 qualified leads (real people/URLs),
$0.15 in ~30s; the vault balance moved on-chain. Returns **0 when nothing fits** —
it discriminates, doesn't hallucinate.

Streaming: `src/components/agent/use-operator-run.ts` (shared client hook) reads
the NDJSON stream; both `/hire` (light) and `/console` (dark) use it.

---

## 8. The x402-style vendor flow — `src/lib/x402/`

**The honest framing:** the vendor + resource are a **local x402-style demo**
("x402-style demo vendor (local paid-resource endpoint)"); the **payment + policy
decision are real on-chain** through the same PolicyVault, and the vendor
**independently verifies the on-chain `SpendSettled` event** before unlocking. It
is **not** production x402 (scheme named `policy-vault-demo`, not EIP-3009; no
external facilitator; no mainnet).

The handshake (`runX402` in `client.ts`):
1. GET `/api/x402/vendor/leads` with no payment → **402** + a `PaymentRequirement`.
2. POST `/api/x402/pay {resource}` → server re-resolves the vendor (never trusts
   client amounts) and does a **real `requestSpend`** → `{allowed, txHash, receipt, reason}`.
3. Retry GET the vendor with `X-PAYMENT: <txHash>` → it **verifies the settlement
   on-chain** → returns the resource. If rejected, nothing unlocks.

Three demo vendors (each maps to a real approved vendor address): leads **$0.05**,
enrichment **$0.12** (both settle), overspend **$26** (rejected at check 4, over cap).
**Verified:** approval unlocks 3 items after a real tx; overspend → `failedCheckIndex 4`,
resource blocked, no funds moved.

---

## 9. Full API surface (`src/app/api/`)

All server-only (Node runtime), `force-dynamic`, never cached.

| Route | Method | Does (all real on-chain / real LLM) |
|---|---|---|
| `/api/operate` | POST | Run the Growth Operator once, return the full result |
| `/api/operate/stream` | POST | Same run, streamed as NDJSON (the consoles consume this) |
| `/api/spend` | POST | Real `requestSpend`: `approved`=$5 settles, `rejected`=cap+1 soft-rejects |
| `/api/kill` | POST | Real terminal `revoke()` on the **kill vault** (hard guard: never the primary) |
| `/api/x402/vendor/[resource]` | GET | 402 + requirement, or verify receipt + return resource |
| `/api/x402/pay` | POST | Pay a vendor requirement via the real vault spend path |

Server libs: `src/lib/deputy/chain.ts` (viem reads, dual-network, vault + vendor
reads), `signer.ts` (operator wallet: `submitRequestSpend`, `submitRevoke`).

---

## 10. What's real vs demo vs next (honest)

- **Real & verifiable on-chain (anyone can check the explorer):** the PolicyVault
  enforcement (budget/vendor/caps/revoke), every `requestSpend` settlement and
  rejection, the kill switch, the agent's per-query on-chain payments, and the
  x402 payment + verification.
- **Real but local:** the agent does real work over real data; the app runs but is
  **not deployed** to a public URL.
- **Demo (clearly labeled):** the x402 *vendor* and its returned resource data are
  a local demo; the *payment* is real.
- **Not built (don't claim):** ERC-8004, LazAI, production x402 facilitator, the
  membership/billing model, real external users.

---

## 11. Tech stack & config

- **Next.js 15** (App Router, RSC-first, Turbopack), **React 19**, **TypeScript strict**.
- **viem** — all chain reads + the operator wallet (server-only). The *only* chain dep.
- **Foundry** — the Solidity contracts (0.8.24, `evm_version = paris`).
- **CommonStack** — agent LLM (OpenAI-compatible). **Real data:** HN Algolia / Exa.
- **Tailwind v4** + scoped CSS; **lucide** icons; shadcn/radix primitives.
- **Vitest** + **Playwright** configured.

**Env** (root `.env`, gitignored; addresses are `NEXT_PUBLIC_`, keys server-only):
`DEPUTY_NETWORK`, RPC overrides, `NEXT_PUBLIC_VAULT_ADDRESS`, `NEXT_PUBLIC_USDC_ADDRESS`,
`NEXT_PUBLIC_KILL_VAULT_ADDRESS`, `COMMONSTACK_API_KEY`, `AGENT_MODEL`, optional `EXA_API_KEY`.
`contracts/.env`: `PRIVATE_KEY` + `OPERATOR_PRIVATE_KEY` (operator/owner key, same value
today). The operator key signs every `requestSpend`/`revoke`, read server-side only.

**Run / quality gates:**
```bash
npm run dev         # http://localhost:3000 → /hire
npm run typecheck   # PASS    npm run lint   # PASS    npm run build   # PASS (exit 0)
( cd contracts && forge build && forge test )   # clean, 35 tests
```

---

## 12. Verified on-chain (proof, not claims)
- Approved spend → `SpendSettled`, budget decrements (hero $500 → $475 → …).
- Overspend ($26 = cap+1) → `SpendRejected, failedCheckIndex 4`, "No funds moved".
- Kill switch → real `revoke()`; a later `requestSpend` to an *approved* vendor
  failed at `failedCheckIndex 1` (state) — airtight that revoke bites. Primary
  stayed Active throughout.
- A streamed agent run moved the vault ~`460.00 → 459.85 USDC` across 3 real txs.
- x402 approval unlocked a resource after a real tx; overspend blocked at check 4.

---

## 13. The open decision (what you're deciding)

**Don't touch the infrastructure** (vault + agent + x402 = the moat, already real,
your ecosystem fit). **Lock two things:**

1. **The flagship job** — what work the worker does. Current pick: Growth Operator
   (lead-gen). Score any candidate on: (a) painful + people pay, (b) doing it
   *requires* the agent to spend money (so x402/vault is the hero), (c) you're
   user #1 + easy 2nd users, (d) shippable solo in 8 weeks. *(Avoid trading —
   risk; research-advisor — saturated; "many agents marketplace" — that's the
   vision slide, not the build.)*
2. **The business model** — the noted idea: free trial → monthly membership; the
   vault is the billing rail (auto-deducts the agent's fees per run). Monetizable,
   and reuses what's built.

Once locked, the 8 weeks = deploy a public product → membership/billing → **real
users** (you + the cohort) → finish ERC-8004 / LazAI / production x402 → Demo Day.

---

## 14. Repo map (key files)

```
contracts/
  src/PolicyVault.sol            # enforcement contract (G1–G4) — FROZEN
  src/PolicyVaultFactory.sol     # CREATE2 factory
  script/{Deploy,CreateVault}.s.sol · deploy-sepolia.sh · deploy-kill-vault.sh

src/lib/
  agent/llm.ts                   # CommonStack client (chat / chatJson)
  agent/tools.ts                 # real search: Show HN (keyless) / Exa
  agent/growth-operator.ts       # the loop: plan → pay on-chain → search → qualify
  deputy/chain.ts                # viem reads, dual-network, vault + vendor reads
  deputy/signer.ts               # operator wallet: submitRequestSpend / submitRevoke
  deputy/{types,mock-data}.ts
  x402/types.ts · vendor.ts (server, verifyPayment) · client.ts (runX402)

src/app/
  hire/{page,layout}.tsx + hire.css     # PRIMARY premium-light product
  x402/{page,layout}.tsx                # x402 agent-commerce demo
  console/{page,layout}.tsx + console.css  # dark console (secondary)
  (deputy)/...                          # operators/[id] (Gate), dashboard, create, / → /hire
  api/operate · operate/stream · spend · kill · x402/pay · x402/vendor/[resource]

src/components/
  agent/use-operator-run.ts      # shared NDJSON streaming hook
  hire/{live-work,break-it,copy-button}.tsx
  x402/x402-demo.tsx
  deputy/{operator-detail,gate-replay,sections,...}.tsx
  console/agent-console.tsx
```

---

**Bottom line:** the on-chain enforcement and a real, paying agent are *live and
verifiable*. The product wrapper is premium and local. What's undecided is the
**job** and the **money model** — that's your call to lock (§13). Everything else
is built to support whatever job you choose.
