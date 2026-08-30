# Sage

> Canonical spec for the **real shipping product**. This file replaces an older spec
> that described a dead "token investigator" (SAFE/RISKY/SCAM verdicts, dark terminal
> UI) that survives only as a disabled placeholder (`src/app/sage/page.tsx`,
> `src/lib/verdicts.ts`) — ignore that product entirely.
>
> Verified against the code on 2026-07-16; sections 1-3, 6 and 7 re-verified 2026-08-30 when
> the Starknet rail landed. **When code and this document disagree, the
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

**Two settlement rails.** `campaign.settlementRail` is `"evm"` or `"starknet"`, and it — not
the chain id — decides which settler pays. EVM covers GOAT and Metis through the V2
`CampaignVault`; **Starknet mainnet** (recorded internally as chainId **900001**) settles
through a Cairo `SageVault`, class `0x2770f9fde4668abd9bfffbf8aeca2ce5d104ed812054afa22cdc78356500e84`.
The rails are independent by construction: a founder signs in with **either** an EVM wallet
(SIWE) or a Starknet one, and identity is compared by `sameFounder` alone
(`src/lib/auth/founder.ts`) — never by chain.

Three rules that keep them from leaking into each other:
- **Never `getAddress()` a campaign address.** viem throws on a felt, and every occurrence so
  far sat inside an existing `try/catch`, so the failure was a SILENT lockout. Use
  `normalizeForChain` / `sameChainAddress` (`src/lib/campaigns/chain-address.ts`) or
  `founderStorageKey` for a DB key.
- **`vaultKind === "campaign_v2"` once meant two things** — "carries a mission plan" and "is an
  EVM vault". They are now `hasMissionPlan()` and `isEvmCampaignVault()`
  (`src/lib/campaigns/vault-kind.ts`); a Starknet vault is the first thing that is one and not
  the other.
- **Settlement branches in exactly ONE place:** `settleByRail`
  (`src/lib/campaigns/settle-dispatch.ts`). `settle-flow.ts` is the EVM flow and is frozen, so
  the dispatcher wraps it. A structural test refuses any new caller that imports the EVM flow
  directly; `deputy/pipeline.ts` is the single allowed exception, because its two rails do
  genuinely different work after the settler returns.

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

## Principle — Sage is a worker, not a wizard

> **Sage is a worker, not a wizard.** The founder states intent once — URL, goal, budget —
> and there are exactly two human moments in the entire lifecycle: **approve the plan, and
> fund it.** Everything else Sage does autonomously and narrates after acting, with an
> artifact backing every claim. Three rules:
>
> 1. **One intent, zero forms after it.** Never ask the founder anything Sage can discover
>    itself (the field test discovers pages; wallet tools discover balances). Ask only for
>    genuine decisions.
> 2. **Show work, not spinners.** "Alive" does not come from personality, animations, or
>    more chat — it comes from observable work product: "I browsed 6 pages, here's what I
>    saw," "I designed 5 missions, here's why each exists," "I paid $0.40, here's the
>    receipt." The no-fabricated-feed rule, elevated to the design principle.
> 3. **Money moments are explicit and receipt-backed.** Verify, pay, hold, notify — all
>    autonomous, all announced after the fact with proof links.

---

## Standing operating policies (apply without asking)

- After any green deploy to prod, push `main` to origin in the same pass. The public repo
  tracks prod; a trailing public repo is a defect, not caution.
- Deploys are guarded on 0 pending/settling submissions — verified via the app's own DB
  driver (`better-sqlite3`), never a possibly-missing CLI (`sqlite3` is not installed on the VM).
- After rsync, verify every changed file's presence/content ON PROD before `build`+`restart`.
  Bracket paths (`[id]`) have silently dropped from a file list once; a green build does not
  prove the sync was complete (old-file + new-file can still compile consistently).
- Any change touching inspection, field test, vision, mission brain, or the gates runs the
  P-GEN matrix battery (`scripts/mission-eval-matrix.mjs`) before deploy. **Anchor integrity
  below 100% is a hard stop.**
  P-GEN **signs in over SIWE** (needs `GOAT_AGENT_PRIVATE_KEY`, so run it on the VM) — run
  anonymously it only exercises the LEGACY planner, and since the auth wall it fails every
  row identically. Use a nonce **below 100**: budget is `10 + index + nonce*100` against a
  $10,000 cap. Both failure modes render in the grid exactly like a quality regression, so
  check `signed in as …` and a non-zero token cost before believing any P-GEN result.
- Naming: "policy vault" is the human concept everywhere; exact contract kind and event
  names live in technical rows only.
- **NO CORPUS ORACLE.** Never expose live, pre-submission feedback derived from corpus
  matching — no strength meters, no as-you-type "you matched N" hints, no preview scoring.
  Match feedback exists ONLY *after* a judged submission and is bounded by the attempt cap
  (`OBS_MAX_ATTEMPTS`). Any earlier signal is a key-mining oracle: an attacker submits nothing
  and reads the answer key off the meter. The 3-attempt post-judgment retry loop is the maximum
  safe disclosure — knowing where NOT to build is part of the guarantee.
- **P16 gate status: Stage 1 was submitted 2026-07-18. P16 is UNLOCKED.**

---

## 2. Architecture

Three LLM "brains" + one on-chain settlement core. They are separate on purpose.

| Component | Role | Path |
| --- | --- | --- |
| **Mission Brain** | *Designs* missions from an inspected product: architect → critic → deterministic validate gate (model output is untrusted until it passes the gate). | `src/lib/launch/mission-brain.ts`, `mission-prompt.ts`, gate in `validate-mission.ts` |
| **Payout brain** | *Judges* tester evidence and proposes pay/review/hold. **Never states an amount.** Pure core + network orchestrator. | `src/lib/deputy/brain-core.ts` (pure), `brain.ts` (network) |
| **Telegram Concierge** | Conversational walletless front door — a hand-rolled OpenAI-compatible tool loop. **Deliberately does NOT import `brain-core`** (so it can never perturb the frozen judgment layer); shares only the LLM endpoint + key. | `src/lib/telegram/concierge.ts` |
| **Vaults + settlement** | On-chain `CampaignVault` (V2) / `PolicyVault` (V1). The vault derives the exact reward, enforces caps + replay protection, and emits the settlement event that is the single source of truth. | `contracts/`; V2 `src/lib/deputy/campaign-vault.ts`, V1 `src/lib/deputy/signer.ts`; flow `src/lib/campaigns/settle-flow.ts` |
| **Starknet vault** | The same bargain in Cairo: the vault looks the reward up from the mission (the amount is not an argument), enforces caps + per-wallet replay, and answers a refused payout with a CODE rather than reverting, so the reason lands on chain where the recipient can read it. | `contracts-starknet/src/vault.cairo`; `src/lib/starknet/vault.ts`, `vault-calls.ts`; flow `src/lib/campaigns/settle-starknet.ts`; dispatch `settle-dispatch.ts` |

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
- **The Starknet settler + its ABI** — `src/lib/campaigns/settle-starknet.ts`,
  `src/lib/starknet/vault.ts`, `vault-abi.json`. Same standing as the EVM flow: it moves real
  USDC, its idempotency check (a submission carrying a `payoutTx` is already paid) is the
  single most important line on that path, and a refusal is a SUCCESSFUL transaction that
  moved nothing — the outcome is read from the events, never from the transaction status.
  `vault-abi.json` has drifted from the deployed contract once already; `abi-drift.test.ts`
  and `refusal-codes.test.ts` read the Cairo source so a drift fails here rather than in a
  founder's wallet.
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
Known drift. Tokens live in `src/styles/tokens.css`, the single source of truth.)

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

### Lanes — routing a job to a provider

A **lane** is one job Sage gives a model: `PAYOUT` (judgment), `CONCIERGE`, `MISSION`
(design), `OBS_JUDGE`, `VISION`. Each lane may run on its own provider by setting
`<LANE>_API_KEY`, `<LANE>_BASE_URL` and `<LANE>_MODEL` — **all three together**. Set
partially, a lane is treated as ABSENT and inherits the shared chain; it is never merged,
because merging splices one provider's key onto another's endpoint (authenticates as
nobody, fails on a founder's launch instead of at boot). `laneProvider()` in
`src/lib/llm/complete.ts` is the single implementation; `src/lib/llm/lane.test.ts` holds it.

This is what makes a model/provider switch a config change rather than a code audit.
Before it existed, only PAYOUT and CONCIERGE could pick a provider — every other lane
could override the model NAME but not the key, so it was pinned to whatever the shared
chain pointed at.

**Token budgets are declared as ANSWER size, never as a provider-tuned number.**
`src/lib/llm/provider-profile.ts` adds each provider's own overhead (a reasoning model
spends up to ~2766 tokens thinking before the answer starts, measured, and stochastic).
`llmCompleteJson` applies this centrally; the few direct-`fetch` callers apply it inline.
An UNKNOWN provider is assumed to reason, so a new model can only ever be over-budgeted —
over-budgeting costs nothing (billing is per token produced), while under-budgeting cuts a
tool call mid-JSON and silently loses a founder's campaign.

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
| `CONCIERGE_API_KEY` / `_BASE_URL` † | Reserved LLM budget for the public concierge — preferred over `LLM_API_KEY`/`_BASE_URL`, so public chat traffic can never exhaust the money-critical judgment path's quota | Falls back to the shared chain, unchanged |
| `CONCIERGE_DAILY_CAP` / `INSPECTION_DAILY_CAP` † | Per-chat daily caps (over the per-minute limit) on concierge turns (default 60) and inspections started (default 3); slash commands are uncapped | Defaults apply |
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
| `SAGE_ADMIN_SECRET` † | Operator secret for the out-of-band held-work review endpoint (`POST /api/admin/review`, header `x-sage-admin-secret`) that backs `scripts/review.mjs` | Endpoint fails closed (404); the Telegram review tools still work |
| `MISSION_API_KEY` / `_BASE_URL` / `_MODEL` † | The MISSION **lane** — mission design on its own provider (prod: MiniMax-M3). All three required together. | Mission design inherits the shared chain |
| `INSPECTION_REPLAY_MODE` † | `"shadow"` re-performs a safe observed transition to confirm it reproduces. **Required for grounded plan selection, not optional telemetry** — `safeTransitionsEstablished` demands every `action_outcome` criterion cite a REPRODUCED transition, so unset (its default) blocks every grounded plan containing one and ships the weaker legacy plan instead. | Grounded selection blocked for action missions |
| `STARKNET_RPC_URL` † / `STARKNET_ACCOUNT_ADDRESS` † / `STARKNET_PRIVATE_KEY` † | The Starknet operator account — the key the Cairo vault accepts as its operator. All required together, or the rail is absent. | Starknet campaigns cannot settle |
| `STARKNET_VAULT_CLASS_HASH` † | The declared `SageVault` class new vaults deploy from | Starknet deploy refuses rather than guessing |
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

### Live evaluation batteries — one at a time

Each makes real LLM calls and is skipped unless its env flag is set. **Run them on the VM** (the
concierge/mission keys live there) and **never two at once**: they contend for one LLM key on a
2-core box, and the loser reports timeouts that read exactly like quality failures. A row that
died of contention is indistinguishable in the grid from a row that died of a defect.

| battery | what it measures | how |
| --- | --- | --- |
| **P-GEN** | inspect → field test → vision → mission brain → gate, one live URL per product category | `node scripts/mission-eval-matrix.mjs --nonce N` (see the anchor-integrity policy above) |
| **P-DIRECT** | the money lanes: gig vs grant vs testing routing, exact budget, faithful amounts, verifiable contracts | `DIRECT_EVAL=1 DIRECT_RUNS=3 npx vitest run direct-eval.live` |
| **P-ROUTE** | tool routing across the WHOLE agent surface, both surfaces, incl. the recipient journey (invite → submit → cash out) | `ROUTE_EVAL=1 ROUTE_RUNS=2 npx vitest run route-eval.live` |
| **P-JUDGE** | promotion gate for a payout-judge model: zero wrong-autopay, all in-set, provenance intact | `JUDGE_EVAL=1 JUDGE_MODEL=… JUDGE_RUNS=3 npx vitest run judge-eval.live` |
| **obs ledger** | the observation judge against its fixtures — the money assertion is confidence vs `AUTOPAY_THRESHOLD` | `OBS_LIVE_EVAL=1 npx vitest run observation-judge.live` |
| **P-VERIFY** | the deterministic verification contracts | `VERIFY_LIVE=1 npx vitest run verify-contracts.live` |
| **Starknet dry-run** | whether the Cairo rail would actually PAY — runs the real `request_payout` against the live vault and commits nothing | `STARKNET_DRYRUN=1 npx vitest run payout-dryrun.live` (VM: needs the operator key) |

**A battery must import production's own prompt/tools, never a copy** (`systemPrompt`, `TG_TOOLS`,
`asOpenAI`, `DIRECT_BLOCK`). P-DIRECT once hand-rolled its tool encoding, the schema landed under a
key the API ignores, and several rounds of "defects" turned out to be the harness.

**Model production's loops or you will over-report.** The concierge resolves a name to an id with a
read tool before acting, and self-corrects once when a turn claims an action it did not take.
A one-shot battery scores both as failures a founder never experiences.

Scripts in `scripts/`: `lane-audit.mjs` (prints the provider each LLM lane resolves to — partial
lane config is silently ignored, which is how two lanes sat on a metered key for weeks),
`redteam-brain.mjs` (LIVE, non-CI red-team — the semantic attacks
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
2. **The design system is consolidated onto `src/styles/tokens.css`** (2026-08-28). It is the
   single source for colour, radius, shadow, spacing, type and motion, and it also owns the
   product's only global element rules (base font, antialiasing, default `border-color`,
   `::selection`). `globals.css` is now nothing but `@import "tailwindcss"` — kept ONLY for
   preflight, which is the reset every page is laid out on; **no Tailwind utility class is used
   anywhere in the product**, so never add one. The retired dark "Bloomberg terminal" palette
   (which shadowed `--accent`/`--border` with dark values) is deleted, along with the unused
   `tw-animate-css` and `shadcn` imports. Remaining, deliberate: **two ink ramps** — `--ink`
   (#1a1d21, cool) for app chrome and `--ink-warm` (#171715) for the public reading surfaces
   (landing, docs, content), which alias it rather than redeclaring it. Per-surface stylesheets
   ALIAS their local names to global tokens (`--terra: var(--accent)`); they must never
   re-declare a palette value. ~116 raw colour literals were replaced with tokens; the ~71 that
   remain are genuine one-off shades (mostly landing washes and a Tailwind-era grey ramp in
   `marketplace.css`), tracked as polish, not blockers.

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

7. **The Starknet rail landed after this doc's verification date (2026-08-29/30).** Sections 1
   and 2 above describe it as built. What is PROVEN and what is not, stated separately because
   the difference matters:
   - **Proven:** a founder signs in with a Starknet wallet, a plan deploys to a Cairo vault, the
     vault is funded and Active, and the operator's `request_payout` against the live vault
     **would release the reward** — `code 0`, USDC transfer, `PayoutReleased` — established by
     simulation (`payout-dryrun.live`), which commits nothing. The control row in that battery
     answers `code 3` for a mission the vault does not have; without it a simulation that said
     "would pay" to anything would prove nothing.
   - **Not proven:** no Starknet submission has ever reached settlement in production. The
     recipient half of the loop — submit, judge, autopay — has never run end to end with real
     money on this rail.
   - **Not wired:** `chargeOperatorFee` is EVM-only, so a Starknet payout accrues no operator
     fee. That is Sage's own revenue, not founder money, and the x402 fee rail is GOAT-based —
     a decision to make, not a bug to fix silently.

8. **`missedMoneyAction` judges the FOUNDER'S words, not the model's draft** — an amount plus
   either a payment verb or an offer of work to a person ("I need someone to…"). It is the
   trigger for the corrective round, and its counterpart `checkStatedTerms`
   (`src/lib/launch/stated-terms.ts`) compares the compiled plan against the founder's own
   arithmetic. Both exist because every OTHER money gate checks a plan against ITSELF, and a
   plan that drops two of three tranches is perfectly self-consistent — just not what was asked
   for.
