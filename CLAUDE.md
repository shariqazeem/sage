# Sage

> Canonical spec for the **real shipping product**. This file replaces an older spec
> that described a dead "token investigator" (SAFE/RISKY/SCAM verdicts, dark terminal
> UI) that survives only as a disabled placeholder (`src/app/sage/page.tsx`,
> `src/lib/verdicts.ts`) — ignore that product entirely.
>
> Verified against the code on 2026-07-16. **When code and this document disagree, the
> code wins** — real discrepancies are listed under **Known drift** at the bottom. Update
> this file deliberately, never casually.

---

## 1. Product

**Sage — "Hire an AI worker. Give it a budget, not your keys."**

A founder points Sage at a product URL with a budget. Sage inspects the product, designs
paid testing missions, deploys an on-chain `CampaignVault`, and then **autonomously pays
human testers USDC for verified evidence, inside hard on-chain limits it can never
exceed.** Every payout cites the evidence and is published as a verifiable `/proof/<tx>`
receipt anchored to an on-chain transaction.

The value is **bounded autonomy over money**: the agent spends without a human in the
loop, but the *vault* — not a prompt — enforces the limits. The AI proposes; the vault
disposes.

**Chains.** GOAT Network (chainId **2345**, real USDC `0x3022b87ac063DE95b1570F46f5e470F8B53112D8`,
native gas **BTC**) is the production mainnet the product ships on; the walletless path
always uses it and the web deploy flow lists it first. Metis Sepolia (**59902**) is the
testnet. (Note: the code constant `DEFAULT_CHAIN_ID` is 59902 — see Known drift.)

**Two front doors, one engine:**
- **Web** (`sagepays.xyz`): connect a browser wallet, SIWE, guided launch → deploy → live.
- **Walletless Telegram** (`@sagedeputybot`): the founder does everything from chat with
  no wallet app — Sage mints a **Privy server wallet** bound to a **mandate policy** and
  funds/launches campaigns from it. The full fund→launch loop is proven on GOAT mainnet.

**Naming rule: the single user-facing name is "Sage."** Never write "Deputy" in UI copy,
headings, or messages. ("Deputy" survives only as internal code identifiers — the payout
brain, `/api/deputy/*`, `DeputyAssessmentCard`; those are engineering names, not product
copy. Copy still drifts — see Known drift.)

Sage is deliberately narrow: it is not a generic agent platform, a chatbot, or a bug
bounty. It turns one product + one budget into paid, verified testing and is judged on
whether the payouts hold up.

---

## 2. Architecture

Three LLM "brains" + one on-chain settlement core. They are separate on purpose.

| Component | Role | Path |
| --- | --- | --- |
| **Mission Brain** | *Designs* missions from an inspected product: architect → critic → deterministic validate gate (model output is untrusted until it passes the gate). | `src/lib/launch/mission-brain.ts`, `mission-prompt.ts`, gate in `validate-mission.ts` |
| **Payout brain** | *Judges* tester evidence and proposes pay/review/hold. **Never states an amount.** Pure core + network orchestrator. | `src/lib/deputy/brain-core.ts` (pure), `brain.ts` (network) |
| **Telegram Concierge** | Conversational walletless front door — a hand-rolled OpenAI-compatible tool loop. **Deliberately does NOT import `brain-core`** (so it can never perturb the frozen judgment layer); shares only the LLM endpoint + key. | `src/lib/telegram/concierge.ts` |
| **Vaults + settlement** | On-chain `CampaignVault` (V2) / `PolicyVault` (V1). The vault derives the exact reward, enforces caps + replay protection, and emits the settlement event that is the single source of truth. | `contracts/`; V2 `src/lib/deputy/campaign-vault.ts`, V1 `src/lib/deputy/signer.ts`; flow `src/lib/campaigns/settle-flow.ts` |

**Autonomy is a stateless gate, not a running loop.** It fires from two triggers:
1. **Synchronous** — a tester submits → `after()` runs the decision pipeline once.
2. **Cron sweep** — `src/app/api/deputy/sweep/route.ts` (authenticated) re-evaluates
   pending work, settles matured approvals, pays operator fees; a singleton lock makes
   overlapping ticks no-ops. **Nothing in-repo schedules it** — an external **pm2 watcher**
   (`npm run deputy:watch` → `scripts/deputy-watch.mjs`) POSTs the endpoint on a ~5-min
   cadence. On a serverless host these deferred jobs would be killed.

Single decision path: `runDeputyOnSubmission` (`src/lib/deputy/pipeline.ts`) — decide →
gate → dedup → preflight caps → CAS `pending→settling` → settle. It never throws for
control flow; any failure resets to `pending` for the next sweep.

Inspection/mission trigger: `POST /api/launch` → `after(() => runInspectionJob(...))`.

---

## 3. Frozen layers — do not modify without an explicit instruction

These are load-bearing safety code. Changing them can silently unbound money movement or
break the red-team guarantees. Treat as read-only unless the task explicitly says to touch
them.

- **`SYSTEM_PROMPT`, `detectInjection`, `hardenBrief`** in `src/lib/deputy/brain-core.ts`
  (the judgment rubric, the 8-family injection detector, and the confidence-ceiling +
  fraud-signal hardener that makes even a jailbroken model unable to auto-pay).
- **`autopilotGate`** in `src/lib/deputy/autopilot.ts` (the AND-gate that decides `pay`).
- **The mandate policy builder** — `buildMandatePolicy` / `createMandatePolicy` in
  `src/lib/privy/mandate.ts` (the Privy allow-rules that bound every agent-wallet spend).
- **Vault ABIs + the settlement flow** — `src/lib/deputy/campaign-vault.ts`,
  `signer.ts`, `src/lib/campaigns/settle-flow.ts`, `src/lib/wallet/abis.ts`.
- **Budget math** — `allocateBudget` in `src/lib/launch/budget.ts`: `Σ(rewardBase ×
  maxCompletions) === totalBudgetBase` **exactly**, in 6-decimal base units. Never
  introduce rounding that breaks the invariant.

The red-team suite (`tests/redteam/brain-redteam.test.ts`) guards the brain-core pieces —
if you must touch them, that suite must stay green.

---

## 4. Invariants — never violate these

- **The LLM proposes, the vault disposes.** A model output is a recommendation; the vault
  computes the amount, checks caps + replay protection, and can reject.
- **No model ever computes a money amount.** Rewards come from the deterministic budget
  compiler; the payout brain is forbidden from stating an amount; the concierge is told to
  never do its own money math (it relays the tool's `overCap`/`needsFunding`/`needsGas`).
- **Quotes must be verbatim.** Any quote in a decision brief must be an exact substring of
  the fetched evidence; `enforceQuotes` drops the rest. Fabricating a quote is the worst
  failure.
- **Untrusted content stays inside `<<<UNTRUSTED_…>>>` markers.** Inspected pages, fetched
  evidence, and submitter notes are wrapped; forged delimiters are stripped.
- **Mainnet auto-pay is gated by `DEPUTY_AUTOPILOT_MAINNET`.** Off by default → GOAT
  campaigns hold for manual approval. Testnet autopilot is unaffected.
- **`engine === "llm"` is required for autopay** at confidence ≥ 0.85 (`AUTOPAY_THRESHOLD`).
  With no LLM key the brain degrades to a transparent keyword heuristic that **can never
  auto-pay.**
- **The feed never fabricates progress.** Emit a stage event only for real work — no fake
  timers, no simulated steps.

---

## 5. Design system

**One system: "receipt minimalism."** Calm, premium-light, print-like. This is the
standard all UI converges to; new UI must follow it. (Current reality is fragmented — see
Known drift. Tokens live in `src/styles/tokens.css`, **which must be created**.)

- **Color.** Paper background `#fbfbf9`; ink text `#1a1d21`; **brand accent terracotta
  `#c2410c` on ALL interactive/brand elements** (links, primary buttons, focus, the mark).
  Green `#15803d` and red `#dc2626` are **reserved strictly for money-outcome semantics**
  (paid/settled vs blocked/failed) — never as generic accents.
- **Type.** Inter (`--font-sans`) for UI/body; JetBrains Mono (`--font-mono`) for data,
  addresses, amounts, hashes. Both already wired via `next/font` in `layout.tsx`. Numeric
  data uses **tabular numerals**.
- **Radii.** `6` (inputs/small), `10` (cards/buttons), `16` (large surfaces). `999px`
  pills **only** for status chips. No other radii.
- **Elevation.** Two shadow tokens only (a subtle resting shadow + a raised one). Prefer
  1px borders + spacing over shadow stacks.
- **No emoji** in UI — use lucide line icons.

The dark `:root` system in `src/app/globals.css` is **legacy** (it belongs to the dead
product). Never extend it; migrate off it.

---

## 6. Environment

`src/lib/env.ts` validates a subset at boot (**presence optional, shape not** — a missing
secret means that integration is *pending* and the app degrades honestly; a *malformed*
value hard-fails). Vars marked † are read directly via `process.env` and are **not** in
`env.ts` (a bad value fails at use, not boot).

| Var | Meaning | Missing → |
| --- | --- | --- |
| `LLM_API_KEY` / `COMMONSTACK_API_KEY` | Auth for the OpenAI-compatible LLM gateway | Brain degrades to keyword heuristic (never auto-pays) |
| `LLM_BASE_URL` / `COMMONSTACK_BASE_URL` | Gateway URL | Defaults to `https://api.commonstack.ai/v1` |
| `LLM_MODEL` / `DEPUTY_MODEL` | Mission + payout model | Defaults to `deepseek/deepseek-v4-flash` |
| `CONCIERGE_MODEL` † | Telegram concierge model (prod: `anthropic/claude-haiku-4-5`) | Falls back to `LLM_MODEL`→`DEPUTY_MODEL`→default (behavior silently changes) |
| `LLM_FALLBACK_API_KEY`/`_BASE_URL`/`_MODEL` | Secondary provider (all 3 arm failover) | No fallback — a primary outage drops to heuristic |
| `DEPUTY_AUTOPILOT_MAINNET` | Arms real-money auto-pay on GOAT | Mainnet campaigns hold for manual approval |
| `FIELD_TEST_ENABLED` | `"1"` arms the Playwright "Field Test" — Sage actually browses the inspected product in a real headless browser (screenshots, JS-rendered content, console errors) and feeds it to the Mission Brain | HTML-only inspection (default; behaves exactly as before). Needs chromium: `npx playwright install --with-deps chromium` |
| `GOAT_AGENT_PRIVATE_KEY` | GOAT operator key (also holds ERC-8004 id + pays x402) | Cannot sign GOAT settlements |
| `OPERATOR_PRIVATE_KEY` | Metis operator key | Cannot sign Metis settlements |
| `GOAT_RPC_URL` | GOAT RPC | Defaults to `https://rpc.goat.network` |
| `GOAT_CAMPAIGN_FACTORY_ADDRESS` † / `METIS_CAMPAIGN_FACTORY_ADDRESS` † | V2 vault factory per chain | Deploy cannot create vaults |
| `GOAT_OPERATOR_ADDRESS` † / `NEXT_PUBLIC_OPERATOR_ADDRESS` | Operator baked into vault settings | Deploy validation fails |
| `NEXT_PUBLIC_USDC_ADDRESS` | Metis USDC (GOAT USDC is hardcoded) | Metis campaigns have no settlement token |
| `GOATX402_API_KEY`/`_API_SECRET`/`_MERCHANT_ID` (`_API_URL`) | x402 merchant creds (all 3 arm the rail) | Evidence verification + fees fall back to unpaid (honest bypass) |
| `TELEGRAM_BOT_TOKEN` | Bot send auth | No outbound Telegram messages |
| `TELEGRAM_WEBHOOK_SECRET` | Gates `POST /api/telegram/webhook` | Webhook returns 404 (bot off) |
| `TELEGRAM_CHAT_ID` | Default notify chat | No dogfood notifications |
| `PRIVY_APP_ID` † / `PRIVY_APP_SECRET` † | Server-wallet + policy API (Basic auth) | `privyConfigured` false → concierge uses the web-link handoff, no walletless. **The secret is the master credential for every agent wallet.** |
| `DEPUTY_CRON_SECRET` | Shared secret for the pm2 watcher (`x-deputy-cron-secret`) | Local watcher can't run the sweep |
| `CRON_SECRET` | Vercel Cron bearer for the sweep | Scheduled sweep unauthorized (with neither set, the endpoint is closed) |
| `SAGE_SESSION_SECRET` | SIWE cookie session signing | Auth sessions degraded |
| `SAGE_AGENT_API_KEY` | Bearer for the authenticated Agent API | Agent API fails closed (404) |
| `ERC8004_AGENT_ID` | Registered on-chain identity | Identity "pending registration" |

---

## 7. Commands

```bash
npm run dev          # next dev --turbopack
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit (strict)
npm run test         # vitest run — unit/component + the red-team suite (tests/redteam/)
npm run test:watch   # vitest watch
npm run test:e2e     # playwright
npm run format       # prettier --write .
npm run deputy:watch # the local sweep watcher (drives autopilot; posts /api/deputy/sweep)
```

Scripts in `scripts/`: `redteam-brain.mjs` (LIVE, non-CI red-team — the semantic attacks
the regex layer can't catch), `deputy-watch.mjs` (sweep watcher), `mcp-conformance.mjs`,
`register-erc8004.mjs` (mints the ERC-8004 identity), `promote-demo.mjs`,
`telegram-setup.sh`, `metis-safety/`. The optional Field Test (`FIELD_TEST_ENABLED=1`,
`src/lib/launch/field-test.ts`) needs a browser engine installed once:
`npx playwright install --with-deps chromium`.

Quality gate before shipping core logic: `lint` + `typecheck` + `test` must pass. Strict
TypeScript stays on; no `any` escape hatches, no `@ts-ignore`. Server-first (RSC by
default; `"use client"` only at interactive leaves). Core logic (eligibility, budget math,
mandate, gate, settlement, brain-core) requires Vitest coverage.

---

## Known drift (this doc's brief vs. the code, 2026-07-16)

Where the writing brief for this file disagreed with the code, the code is recorded here:

1. **`DEFAULT_CHAIN_ID` is `59902` (Metis Sepolia), not GOAT 2345.** The code's fallback
   for a chainless read/write, and `envSummary`'s default network, are Metis Sepolia. GOAT
   2345 is "default" only as product positioning: the walletless path hardcodes 2345 and
   the web deploy flow lists it first. `src/lib/deputy/networks.ts:43`.
2. **`src/styles/tokens.css` does not exist, and there is no `src/styles/` dir.** §5 is a
   *target*. Current reality: ~9 CSS files across ≥5 unshared systems — `globals.css`
   (dark, legacy/dead), `cinematic.css` (landing), `launch/launch.css` (the only place
   terracotta `#c2410c` currently lives), `hire/hire.css` + `app/app.css`, `sage-proof.css`,
   `agents/sage/agents.css`, plus `app/motion.css` + `app/demo-moments.css`. Radii/shadows
   are far more varied than §5 prescribes. Building tokens.css and consolidating is unbuilt
   work.
3. **`AUTOPAY_THRESHOLD` is a hardcoded constant** (`0.85`) in `brain-core.ts:529`, **not
   an env var.** The brief listed it as env; it isn't configurable that way.
4. **The "Sage, never Deputy" naming rule is aspirational for copy.** UI copy, headings,
   and component names still use "Deputy"/"the Deputy" in many places; aligning them is
   pending work.
5. **`CONCIERGE_MODEL`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `GOAT_CAMPAIGN_FACTORY_ADDRESS`,
   `GOAT_OPERATOR_ADDRESS`, `METIS_CAMPAIGN_FACTORY_ADDRESS` are read directly via
   `process.env`,** not validated in `env.ts` (marked † above) — a malformed value fails at
   use, not at boot.
6. **Older "required integrations" are not all real.** LazAI is absent (no client, label
   only). There is no generic "GOAT-compatible adapter" abstraction — on-chain access is
   direct viem; "GOAT" means the GOAT chain + the goatx402 x402 SDK. Multi-chain is the
   hand-rolled `CHAINS` registry in `networks.ts`.
