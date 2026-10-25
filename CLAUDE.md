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

> **SAGE, THE COMPANY (19 Oct 2026, the founder's decision; implemented on branch `company`).** Sage
> builds AI agents you can trust with money. Product #1 is called just **Sage** (never "Sage Work");
> product #2 is **ParallaxPay by Sage** (its own repo; named "Called" 19-24 Oct, then the founder took the
> original name back, and `/called` redirects to `/parallaxpay`). **Primary networks: Metis Andromeda + GOAT**; Arc and
> Starknet are secondary ("More networks"); testnets are gone from every surface. Sage is **paid**: Free,
> Pro, Team, Programs, and workers are always free (§4). The public site and the app were rebuilt
> Apple-minimal (§5). The plan and its reasoning: `docs/strategy/2026-10-19-sage-the-company.md`.
>
> **21 Oct 2026 (the founder's decisions): GOAT is PAUSED for new money.** GOAT's USDC (`0x3022…12D8`) is
> Stargate's bridged "Hydra" USDC.e, and Stargate ends support for GOAT on 23 Oct 2026. `PAUSED_NETWORKS`
> (`src/lib/deputy/networks.ts`) stops every new launch, account and plan payment there; withdrawals, stops,
> receipts and records keep working. Metis is now the ONE primary network and the default ("pause GOAT, no
> Arc default": nothing new launches until Metis's factory is live; Arc stays an explicit choice). Plans are
> billed on Metis only, renew like a card from the Sage balance, and take promo codes (§4).
>
> **24 Oct 2026 (the founder's decisions): people pay their own network fee, and the account does more.**
> - The account pays its own METIS (`operatorCoversGas` in `src/lib/treasury/gas-policy.ts`; `OPERATOR_COVERS_GAS=1`
>   brings the operator's old cover back). Every door short of METIS says how much and how to get it (`needsFeeMessage`).
>   The operator still pays what only it sends (settling a payout).
> - The account swaps USDC ⇄ METIS through Netswap's METIS/m.USDC pool (`src/lib/treasury/swap-venue.ts`, `swap.ts`),
>   sends METIS (`send-native.ts`), and reads METIS deposits from the Metis explorer (`account-activity.ts`). Every
>   scoped permit (withdraw, swap, send, stop, cap change) takes one per-wallet lock (`src/lib/privy/scoped.ts`).
> - Metis rejects EIP-1559: the Privy executor signs a `legacy` chain as type 0 (`priceTransaction`, measured).
> - Telegram chat wallets open on Metis; a GOAT one is set aside under `<chat>@2345` (`src/lib/telegram/chat-wallets.ts`).
> - Owners connect their own AI agent with a workspace key (`sage_sk_…`, `src/lib/agent-keys/`) on `POST /mcp`.
> - Home asks for one next step; the landing shows a real decided payout (`src/lib/site/live-work.ts`).

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

**Networks (19 Oct 2026; GOAT paused 21 Oct).** ONE policy, in `src/lib/deputy/networks.ts`: `PRIMARY_NETWORKS` =
Metis Andromeda (1088); `SECONDARY_NETWORKS` = Arc mainnet (5042), Starknet (900001) and GOAT (2345, PAUSED:
`isPausedNetwork`, `pausedNetworkReason`); `networkTier()` says which. A paused network stays configured (its
accounts can withdraw and its jobs can stop) but `isLaunchChain`, `configuredLaunchChains`, `createWebTreasury`,
`deployCampaignViaPrivy`, the Telegram tools and billing all refuse it, with `launchClosedReason()`'s words. Every surface reads it (onboarding, the account tabs, the deploy flow, Privy's
chain list), and secondary networks appear only under "More networks" or when already held. Launching is
`LAUNCH_ENABLED_CHAINS = [2345, 1088, 5042]`, each launchable only when its factory, operator and token are
configured (fails closed).
- **GOAT Network** (USDC `0x3022b87ac063DE95b1570F46f5e470F8B53112D8`, gas **BTC**) is still
  `DEFAULT_EVM_LAUNCH_CHAIN` and holds Sage's longest real-money history.
- **Metis Andromeda** (m.USDC `0xEA32A96608495e54156Ae48931A7c20f0dcc1a21`, 6 dp; gas **METIS**, legacy
  pricing, no EIP-1559) reads its OWN settings (`railEnvPrefix(1088) = "METIS_MAINNET"`: factory, operator
  address, key falling back to `GOAT_AGENT_PRIVATE_KEY`, RPC), never the retired Sepolia testnet's. Gas is
  sized per chain in `src/lib/treasury/gas-policy.ts`. Its V2 factory is deployed by the founder with
  `contracts/script/deploy-campaign-factory-metis.sh` once the operator holds METIS; until then the rail is
  wired but not launchable. The default moves to Metis only after a real payout there.
- **Arc** (USDC is the native gas and an ERC-20 at `0x3600…0000`) and **Starknet** (the private rail, below)
  keep working end to end; they are hidden, never deleted.
- Telegram walletless accounts open on the default network (Metis) once it is live; a chat whose wallet is on
  GOAT gets a new one and the GOAT one is set aside, still withdrawable. Metis Sepolia (59902) and Arc testnet
  (5042002) are retired. (The code constant `DEFAULT_CHAIN_ID` is still 59902; see Known drift.)

**Two settlement rails.** `campaign.settlementRail` is `"evm"` or `"starknet"`, and it — not
the chain id — decides which settler pays. EVM covers GOAT and Metis through the V2
`CampaignVault`; **Starknet mainnet** (recorded internally as chainId **900001**) settles
through a Cairo `SageVault`. The deploy class is `STARKNET_VAULT_CLASS_HASH` (the privacy class
`0x6d5577…5aa0`, declared 2026-09-02, events keyed by `intent_hash`); vaults on earlier declared classes
(`STARKNET_VAULT_CLASS_HASHES_PREVIOUS`) stay recognised — `starknetKnownVaultClasses()`.
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
- **Web** (`sagepays.xyz`): connect a browser wallet or sign in with an email, SIWE, guided launch →
  deploy → live. **The account** (`/workspace/account`): a Privy-held wallet under the mandate, ONE PER
  NETWORK (`src/lib/treasury/web.ts`: the default chain's account under `web:<founder>`, any other chain's
  under `web:<founder>@<chainId>`; the mandate runs from the default-chain one) — fund it from anywhere
  (address + QR, balance and activity read from the chain), the agent launches from it
  (`launchFromTreasury(founder, jobId, chainId)`), withdraw to any address through a scoped one-time permit
  (`POST /api/treasury/withdraw` → `withdrawViaPrivy`, re-locks after). A NEW WORKSPACE OPENS ITS
  ACCOUNT on the default network for any Ethereum-style sign-in (`POST /api/workspaces`, best effort,
  default cap $50); the cap is changed by moving the wallet onto a NEW mandate policy with the same
  reclaim address (`src/lib/privy/cap.ts`, `PATCH /api/treasury`). The UI name is "your account";
  "treasury" survives only in code identifiers. A Starknet sign-in cannot hold one (no Ethereum reclaim
  address) and every surface says so instead of offering a door that fails (`src/lib/treasury/summary.ts`).
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
- **The agent decides on every door; a window, not a person, guards the open one.** On an open
  campaign the autopilot approves at once and the sweep settles after `AUTOPAY_FINALIZE_MINUTES`
  (default 30), re-running the near-duplicate, copied-artifact and wallet-cluster watch against
  everything that arrived since; a hit revokes with the reason. Members-only work pays at once. A
  founder's explicit release carries no window. `src/lib/deputy/finalization.ts`.
- **Plans gate LAUNCHES and features, never payouts (19 Oct 2026).** One catalog
  (`src/lib/plans/catalog.ts`): the pricing page and the server read the same list. `launchAllowed`
  (`src/lib/plans/founder-plan.ts`) runs at EVERY door that starts a job, before money moves:
  - the account launch (web and the operator);
  - Telegram;
  - the wallet claim's challenge and the claim itself;
  - the Starknet deploy description.
  It is never run after a vault holds money. No settlement path reads a plan (tested): a live job keeps
  paying its workers whatever its founder's plan does. Feature gates (members-only invites, Autopilot,
  admins, exports) read `effectivePlan`. `SAGE_PLAN_LIMITS=off` is the emergency switch.
  Plans are paid in USDC on **Metis only** (`BILLING_NETWORKS`, `src/lib/plans/billing.ts`) and read from the
  chain, from the founder's Sage balance (the withdrawal's scoped permit; Sage covers the network fee,
  `decideTransferGas`) or any wallet that is theirs. Workers never pay. Buying happens at `/checkout`; every
  payment records its plan, period and method and gets a receipt at `/billing/receipt/<tx>`.
  - **Renewal like a card** (`src/lib/plans/renewal.ts`, the sweep's LAST step): on by default, from the Sage
    balance; a reminder 3 days ahead; the charge in the plan's last day; one renewal per workspace per period
    end (`plan_renewals` primary key), the hash written the moment it is sent, a crash finished from the chain;
    retries at most every 6 h for 3 days. No balance, or renewal off: reminded, never charged.
  - **Promo codes** (`src/lib/plans/promo.ts`, created with `scripts/promo.mjs`): DAYS (free days, nothing paid,
    a never-paid workspace starts with renewal off) or PERCENT (off the first payment, priced on the server,
    redeemed in the payment's own transaction). One per workspace; uses, expiry and new-only honoured.
- **The feed never fabricates progress.** Emit a stage event only for real work — no fake
  timers, no simulated steps.
- **The agent may decide WHERE to spend, never HOW MUCH.** Under a founder's standing mandate
  (`src/lib/operator/`) a model picks the position — which surface the founder named, which kind of
  work — and the pure policy sizes it from the ceilings and the observed results. A proposal naming
  an amount is rejected; a surface outside the founder's own set is refused rather than sanitised.
  Every move is recorded with its reason BEFORE money moves and is vetoable for a window.
- **The account pays its own network fee (24 Oct 2026).** No door sends an account gas unless `OPERATOR_COVERS_GAS=1`;
  short of it, the door names the amount and the way to get it, and moves nothing.
- **An agent key is its owner, and never lifts a limit.** A workspace key acts as the owner who minted it, with only
  the scopes they ticked (read, plan, launch); identity is bound server-side (a caller's `founderOverride` or
  `clientRef` is dropped), the plan, the account's per-job limit and the vault still decide, and revoking is immediate.
- **Reaching a person is opt-in, always.** The roster (`src/lib/roster/`) messages only people who
  asked, at most one campaign per person per cooldown, never about work they already did, and never
  about a campaign with no claimable slots. Being paid is not consent.

---

## 5. Design system

**One system: "receipt minimalism."** Calm, premium-light, print-like. This is the
standard all UI converges to; new UI must follow it. (Current reality is fragmented — see
Known drift. Tokens live in `src/styles/tokens.css`, the single source of truth.)

**Two worlds since 19 Oct 2026, and `src/components/shell/routes.ts` decides which a route is:**
- **The company site:**
  - Pages: home, pricing, company, ParallaxPay, ledger, docs.
  - Reading pages (restored 20 Oct 2026 after being folded the day before): outcomes, records (`/record`, above
    every `/record/<wallet>`), the Caribbean, the FAQ, the two comparisons (`/vs/*`) and the case study. They use
    `ReadPage` (`src/components/site/read-page.tsx`) and `src/styles/read.css`; their numbers come from
    `src/lib/site/readings.ts`, which reads the same derivations as the home page and the ledger (tested).
  - Every page is wrapped in `SiteFrame` (`src/components/site/`) and styled by `src/styles/site.css`:
    Apple-like restraint, one idea per section, large type, real product imagery. The footer links every
    public page.
  - The hero's product shot is the latest real receipt, and every number comes from `src/lib/site/live-proof.ts`.
- **The app** is six screens, and the rail lists exactly these (tested):
  - Home `/workspace`, Post `/launch`, Jobs `/workspace/jobs`, Account `/workspace/account`,
    Team `/workspace/people`, Settings `/workspace/settings`.
  - Everything else is reached from the screen it belongs to.
- **Neither world:**
  - `/start` is the focused first run, with no rail.
  - `/proof/<tx>` is a document: a receipt never wears founder chrome.
- **Old addresses stay alive.** The founder's rule (20 Oct 2026): never remove a public route. A page worth
  reading stays a page (in the company frame); only a page whose content truly moved redirects, through
  `src/lib/site/redirects*.ts`. A redirect left on a live page's path shadows it, so
  `src/lib/site/restored-pages.test.ts` holds both sides.
- No inline `style=` in new code; classes only.

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
| `NEXT_PUBLIC_PRIVY_LOGIN_APP_ID` † / `PRIVY_LOGIN_APP_SECRET` † | The Privy app that signs people IN (email / social + an embedded wallet) — a SEPARATE app from the server-wallet one. The id is public and must be present at BUILD time; the server verifies Privy tokens and mints the same session a SIWE sign-in would (`src/lib/auth/privy-login.ts`). | The email door does not appear; wallet sign-in unchanged |
| `DEPUTY_CRON_SECRET` | Shared secret for the pm2 watcher (`x-deputy-cron-secret`) | Local watcher can't run the sweep |
| `CRON_SECRET` | Vercel Cron bearer for the sweep | Scheduled sweep unauthorized (with neither set, the endpoint is closed) |
| `SAGE_SESSION_SECRET` | SIWE cookie session signing | Auth sessions degraded |
| `SAGE_AGENT_API_KEY` | Bearer for the authenticated Agent API | Agent API fails closed (404) |
| `SAGE_ADMIN_SECRET` † | Operator secret for the out-of-band held-work review endpoint (`POST /api/admin/review`, header `x-sage-admin-secret`) that backs `scripts/review.mjs` | Endpoint fails closed (404); the Telegram review tools still work |
| `MISSION_API_KEY` / `_BASE_URL` / `_MODEL` † | The MISSION **lane** — mission design on its own provider (prod: MiniMax-M3). All three required together. | Mission design inherits the shared chain |
| `INSPECTION_REPLAY_MODE` † | `"shadow"` re-performs a safe observed transition to confirm it reproduces. **Required for grounded plan selection, not optional telemetry** — `safeTransitionsEstablished` demands every `action_outcome` criterion cite a REPRODUCED transition, so unset (its default) blocks every grounded plan containing one and ships the weaker legacy plan instead. | Grounded selection blocked for action missions |
| `STARKNET_RPC_URL` † / `STARKNET_ACCOUNT_ADDRESS` † / `STARKNET_PRIVATE_KEY` † | The Starknet operator account — the key the Cairo vault accepts as its operator. All required together, or the rail is absent. | Starknet campaigns cannot settle |
| `STARKNET_VAULT_CLASS_HASH` † | The declared `SageVault` class new vaults deploy from | Starknet deploy refuses rather than guessing |
| `ADVANCE_SELF_SERVE` † / `ADVANCE_MAX_USD` † / `ADVANCE_MULTIPLE` † / `ADVANCE_WATERFALL_BPS` † | Self-serve working capital on `/record`: `"1"` arms the owner's one-click advance; max principal (default 5), the lender multiple on monthly verified inflow (default 1), the repayment share of each next verified payout (default 5000 = 50%). The money is the operator's Starknet pot. | Off — the door 404s; the operator route still works |
| `WORLD_ID_APP_ID` / `NEXT_PUBLIC_WORLD_ID_APP_ID` † | The World developer-portal app (`app_…`). With `WORLD_ID_RP_ID` (`rp_…`) and `WORLD_ID_RP_SIGNING_KEY` it arms proof-of-personhood: the widget appears, and a verified wallet reaches `established` standing without grinding. The provider returns a NULLIFIER, unique per person per action — a second wallet presenting a nullifier already seen is LINKED, so one person cannot become two workers. `WORLD_ID_ACTION` scopes it (default `sage-worker`). | The verify door does not render; standing is earned from the record alone |
| `IDENTITY_DOOR` † | `"1"` arms **one person, one slot** on PUBLIC work (listed, no allowlist): claiming asks for a one-time World ID proof, and the mission slot cap and `per_wallet_cap` count the PERSON — every wallet sharing the nullifier, every chain-linked and declared wallet — not the address. Members-only work is untouched. Supersedes the reward-tier rule below whenever both are set. Armed on prod 2026-09-05. | Public work is claimable by any fresh wallet; the reward-tier rule (if armed) is the only gate |
| `IDENTITY_TIERS` † | `"1"` arms standing on the submit door: work paying above the open ceiling needs a record (2+ payouts across 2+ campaigns, no linked wallets). OFF by default — a tier gate over an empty board is a closed door with nowhere to earn the key, so arm it once there is open low-paid work | Every campaign stays claimable by anyone |
| `IDENTITY_OPEN_CEILING_USD` † | The reward at or below which work is open to anyone | $2.00 |
| `AUTOPAY_HOURLY_CAP` † | Payouts per campaign per hour before the autopilot holds on pace | 4 |
| `OPERATOR_GAS_FLOOR_WEI` † | The BTC (wei) the operator keeps for settlements before it covers a walletless founder's launch gas — the **gas stipend** (`src/lib/treasury/gas-stipend.ts`): sent once per wallet, only against USDC the wallet already holds for the plan, never more than `MIN_GAS_WEI`; both launch doors try it before asking the founder for BTC | 0.000005 BTC |
| `ERC8004_AGENT_ID` | Registered on-chain identity | Identity "pending registration" |
| `SAGE_BILLING_ADDRESS` † | Where plan payments go (the founder's own wallet), on Metis | Falls back to the operator's address |
| `TREASURY_CHAIN_ID` † | The network a new account opens on, when set, configured and NOT paused | The launch default (Metis) |
| `OPERATOR_COVERS_GAS` † | `"1"` brings back the operator's gas cover (the launch stipend, the fee on a plan paid from the balance) | Off: every account pays its own network fee |

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
| **P-OPERATOR** | the standing mandate's one model decision — WHERE to buy the next work: in-set only, never prices it, does not buy the same silence twice, escalates past a filled read | `OPERATOR_EVAL=1 OPERATOR_RUNS=3 npx vitest run decide-eval.live` (VM: the MISSION lane's key) |

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
   - **Proven in production since 2026-08-31:** the recipient half of the loop — submit, judge,
     autopay, escrow, claim link — has settled real USDC on this rail with no human in the loop
     (13 Starknet payouts on the ledger by 2026-09-05; one gig, `gig-1c3e_FjffE`, was farmed by a
     single operator across twelve wallets and is the case the consolidation watch and the
     personhood door were built on). A receipt names the Cairo vault that paid it.
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
