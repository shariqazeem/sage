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
>
> **26 Oct 2026 (the founder's decisions): ONE network, Metis, and one way in.** "Completely close Arc except the
> payouts on Arc… keep GOAT as paused so it shows we were on GOAT… if we connect with email or MetaMask, things
> should be the same on both, from login to launching."
> - `CLOSED_NETWORKS` (`networks.ts`): Arc (5042) and Starknet (900001) are paused AND offered nowhere (sign-in,
>   account tabs, "More networks", launch choices, copy). What already happened there stays true: receipts,
>   records, the ledger, claim links, payouts from funded jobs. `isPausedNetwork` covers closed networks, so every
>   door that refuses GOAT refuses them too. GOAT stays PAUSED (shown, labelled paused, resumable).
> - Two sign-in doors, the same account on Metis: an email (Privy: email or Google only) or MetaMask (SIWE).
>   `FounderSignIn` offers both at every sign-in moment; no Starknet wallets. Linking binds one way only: an old
>   Starknet account may link an Ethereum wallet to carry its workspace onto Metis.
> - One way to launch: from the account, through `TreasuryLaunch` (it opens the account in place if there is
>   none). The browser-wallet route and the public/private rail choice no longer start; a wallet deployment
>   already in flight still resumes. A session is the payee: an email sign-in submits work and sets its record's
>   privacy without a browser wallet. New named recipients are Ethereum-style addresses.
> - The `/record` advance moved to Metis too: its own pot wallet, offered only when the pot can pay, repaid
>   automatically from later verified payouts under an approval the borrower signs once (the pot covers that
>   fee once if they hold no METIS). The Starknet pot was emptied to the founder's wallet.
>
> **6 Nov 2026 (the founder's direction): build the core so the numbers can only happen on Sage.** Users come
> later; first the end-ready product. 10,000 payouts across 700 people is about 14 each, so the core gained
> **people** and **time**:
> - **People.** Every job has one link for N people, on every plan (`src/lib/people/seats.ts`, `/join/seat_…`).
>   Taking a place puts the person's wallet on the job's named list: no World ID (the founder vouches), no
>   workspace membership (the lasting team is still Pro). Never on public work: a name on an empty list would
>   lock everyone else out.
> - **Time.** "Every week for N weeks" on the card (`src/lib/programmes/`). Round 1 launches from the card. The
>   sweep then closes the last round (once nothing in it is moving; its leftover returns to the account) and
>   opens the next from the account. Each round uses the SAME approved spec through `launchFromTreasury`'s
>   checks, is compiled once, retries every 6 h, and is skipped after 3 days. No round carries an amount the
>   founder didn't set.
> - **The brain's spend.** The wire prices every answer (`src/lib/llm/spend.ts`). `LLM_DAILY_BUDGET_USD` (prod
>   0.8 while the last Claude credit lasts) stops background design at 1×, a waiting person at 1.5× and
>   judgment at 2×. `node scripts/vm/llm-spend.mjs` prints each day.
>
> Plan and order: `docs/strategy/2026-11-06-the-core.md` (internal).
>
> **7 Nov 2026 (the founder's decisions): numbers that hold up, and no fee handouts.**
> - **Numbers.** Every settled payout says who decided it (`decidedBy` on `settledLedger`: the agent, or a person
>   releasing it by hand). `sageNumbers()` (`src/lib/numbers/`) counts, one way, payouts to people, the agent's
>   share, people (clusters, the board's count), people paid again, jobs, teams (funders other than Sage), completed
>   grants and weekly rounds; it equals the job board's own counts (tested). Sage's own wallets (`OWN_WALLETS` in
>   `settled-ledger.ts`, each with the evidence it is ours) are left out of every people and team count and
>   published at `GET /api/ledger`. `scripts/recount.mjs` re-checks every payout on its own network with nothing
>   but Node: USDC left the job's vault, in the exact amount, to the listed person (EVM; Starknet's private rail
>   pays a claim, so the vault and amount only). The first time a number reaches a round figure (100 payouts by
>   the agent, the first other team), the operator chat gets one message with a drafted post (`milestones`, the
>   sweep's last step).
> - **No METIS drip.** The founder won't fund people's network fees. Metis m.USDC has neither permit nor EIP-3009
>   (checked on chain), so nothing can take a worker's fee from their USDC either; the worker's wallet names the
>   METIS needed and where to get it (`needsFeeMessage`), as every founder door does.

> **20 Nov 2026 (the founder's decisions): Sage restarts as product testing, and relaunches on Tue 1 Dec.**
> "Consider it as a restart and relaunch."
> - Product testing is the whole product: paste a link (or tag @sagepaysai on X) → Sage tries it in a real
>   browser → real people try it → each is paid in m.USDC only for an honest, checked try → the builder gets
>   the findings (`src/lib/report/`, quotes verbatim). Promise real people and what they found, never "users".
> - The front is three places: Home (`/`: one paste box; signed in, your tests), a test (`/t/<id>`, one page
>   for builder, tester and public; being built) and Earn (`/earn`; `/marketplace` and `/missions` redirect).
>   One top bar on every page, no rail (`src/components/sage/`, `src/styles/sage.css`). Pay-for-work, teams,
>   programmes, weekly rounds and plan tiers are off the front; every route stays.
> - The advance is retired (one was ever drawn, and it was repaid); a record is proof of work, not a credit file.
> - Builders pay only what testers earn: no Sage fee and no tiers on the front until 15 builders come back
>   (`SAGE_PLAN_LIMITS=off` at relaunch; no workspace ever paid for a plan). They pay from a wallet they control,
>   because Metis Rise counts only those from 1 Dec; Telegram hands a launch to the web (`TELEGRAM_LAUNCH_ON_WEB`).
> - Sharing is the builder's opt-in (`campaign_sharing`, `src/lib/sharing/`): Sage's X account (`src/lib/x/`,
>   `X_AGENT=off|dry|live`) and its Telegram channel (`TELEGRAM_MISSIONS_CHAT_ID`) post a test and its result only
>   with that yes. On X, Sage replies only when tagged (`X_REPLIES`, after X approves the bot); never DMs.
> - Testers sign in with X or Google, one place per person per test, World ID only above a ceiling
>   (`IDENTITY_DOOR=social`, being built). Testers' METIS: the wallet explains; Sage sends nobody network fees.
> - Model spend goes to `LLM_DAILY_BUDGET_USD=4` at relaunch.
>
> Plan, workstreams and dates: `docs/relaunch/plan.md` (internal).

> **27 Nov 2026 (the founder's ask): a builder sees everything.** "Users get everything what's being done:
> tracking if someone approached, someone tried or someone failed." The plan behind it, with the case for the
> product and the dated proofs, is `docs/relaunch/complete.md` (internal).
> - **How far people got** (`src/lib/test-page/funnel.ts`, `tracking.ts`): saw the test, signed in, opened the
>   product, answered, paid. Each person is counted once at their furthest stage, so the rows never grow downward,
>   and the page draws it as The Stop, with the seal where most people stopped.
> - **Visits** (`test_visits`, migration 0078) are a beacon from the page (`POST /api/t/<id>/seen`). A visitor is
>   the hash of a random first-party cookie with a first-touch source, never an IP address or a user agent, and
>   never the builder.
> - **Where they came from:** Sage's own links carry `?via=` (X `x`, the channel `tg`, Earn `earn`, alerts
>   `alert`, the builder's seat link `link`; `testUrl(id, via)`).
> - **What Sage did** (`activity.ts`): a timeline read only from recorded rows, each with its proof link. It is
>   the owner's, like each person's journey and answer on their ticket. The public view is unchanged (tested).
> - **A held answer is decided in place:** `POST /api/t/<id>/answers/<sid>`, with `{decision: "pay"}` or
>   `{decision: "decline", reason}`. It is owner-gated and calls only `releaseSubmission` and `rejectSubmission`;
>   no wallet signature is needed.
> - **Web builders hear about their tests on Telegram** (`src/lib/builder-updates/`; `/start bu_<token>`; the
>   sweep's `builders` step): a first answer, an answer waiting, findings, done, and quiet after 24 h. Each is sent
>   once (`builder_notices`), and tests the Telegram-launch path already reports are skipped.
> - **Home leads with a test that waits for its builder.** A finished test offers "Test it again" (`/?test=<url>`
>   fills the paste box). A tester who has answered is offered alerts for the next test: the crowd is the asset.
> - **Local preview:** `node scripts/dev/seed-cockpit.mjs`, then `SAGE_DB_PATH=var/preview.db` and the dev
>   session route. It builds an invented test with seven invented people.

---

## 1. Product

**Sage — an AI agent that pays people onchain for verified work.** (On 5 Nov 2026 the founder retired
"Hire an AI worker. Give it a budget, not your keys" as generic AI copy: never lead with it, or with any
keys or allowance framing, in copy, posts or films. Current public line: "Proof of work, for people.")

A founder points Sage at a product URL with a budget. Sage inspects the product, designs
paid testing missions, deploys an on-chain `CampaignVault`, and then **autonomously pays
human testers USDC for verified evidence, inside hard on-chain limits it can never
exceed.** Every payout cites the evidence and is published as a verifiable `/proof/<tx>`
receipt anchored to an on-chain transaction.

The value is **bounded autonomy over money**: the agent spends without a human in the
loop, but the *vault* — not a prompt — enforces the limits. The AI proposes; the vault
disposes.

**Networks (19 Oct 2026; GOAT paused 21 Oct; one network 26 Oct).** ONE policy, in `src/lib/deputy/networks.ts`:
`PRIMARY_NETWORKS` = Metis Andromeda (1088); `SECONDARY_NETWORKS` = GOAT (2345, PAUSED: `isPausedNetwork`,
`pausedNetworkReason`); `CLOSED_NETWORKS` = Arc mainnet (5042) and Starknet (900001), paused and offered
nowhere (`isClosedNetwork`); `networkTier()` says which (a closed network reads "retired"). A paused network stays configured (its
accounts can withdraw and its jobs can stop) but `isLaunchChain`, `configuredLaunchChains`, `createWebTreasury`,
`deployCampaignViaPrivy`, the Telegram tools and billing all refuse it, with `launchClosedReason()`'s words. Every surface reads it (onboarding, the account tabs, the deploy flow, Privy's
chain list), and GOAT appears only where a founder already holds something there. Launching is
`LAUNCH_ENABLED_CHAINS = [1088, 2345]` (GOAT listed so its accounts stay reachable, refused while paused), each
launchable only when its factory, operator and token are configured (fails closed).
- **GOAT Network** (USDC `0x3022b87ac063DE95b1570F46f5e470F8B53112D8`, gas **BTC**) is still
  `DEFAULT_EVM_LAUNCH_CHAIN` and holds Sage's longest real-money history.
- **Metis Andromeda** (m.USDC `0xEA32A96608495e54156Ae48931A7c20f0dcc1a21`, 6 dp; gas **METIS**, legacy
  pricing, no EIP-1559) reads its OWN settings (`railEnvPrefix(1088) = "METIS_MAINNET"`: factory, operator
  address, key falling back to `GOAT_AGENT_PRIVATE_KEY`, RPC), never the retired Sepolia testnet's. Gas is
  sized per chain in `src/lib/treasury/gas-policy.ts`. **LIVE since 26 Oct 2026** (`scripts/metis-go-live.sh`,
  runbook `docs/next/metis-go-live.md`): V2 factory `0xdD9a45c181dD95e48CDdC0149C8b821D604C45C9`, ERC-8004
  agent **139** (its URI is `https://sagepays.xyz/api/agent/card`), and Sage's x402 facilitator (proxy
  `0xC5Df…Ee6a`, signer `0x86D7…7ABB`, key only on the VM) selling Sage's tools at `/mcp/metis/<tool>`,
  paid to `SAGE_BILLING_ADDRESS`. No real payout on Metis yet. **Both contracts are verified on
  andromeda-explorer.metis.io (12 Nov 2026, asked for by Metis Rise):** the factory as an exact match (its 12
  sources include `CampaignVault.sol`), the proxy as a partial match by design (x402 compiles it without
  metadata; the bytecode matches). Each job vault the factory creates is verified once it exists:
  `contracts/script/verify-vault-metis.sh 0x<vault>` (it refuses anything not built from this repo).
- **Arc** (USDC is the native gas and an ERC-20 at `0x3600…0000`) and **Starknet** (the private rail, below)
  are CLOSED since 26 Oct 2026: nothing new starts there and no surface offers them; what is already there keeps
  working (receipts, records, claim links, payouts from jobs already funded). Hidden, never deleted.
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
- **Web** (`sagepays.xyz`): sign in with an email or MetaMask (the same account either way), guided launch →
  launch from the account → live. **The account** (`/workspace/account`): a Privy-held wallet under the mandate, ONE PER
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
  **Run it on a throwaway copy, not on prod** (22 Nov 2026): `scripts/staging-check.sh up [branch]`
  (port 3100, its own database and spend ceiling `STAGING_BUDGET_USD`, messages nobody), then `probe`,
  `pgen <nonce> [--only <category>] [--kinds]`, `watch <nonce>`, `down`. `up` alone spends no model
  credit and is also the production build check for a branch.
- Naming: "policy vault" is the human concept everywhere; exact contract kind and event
  names live in technical rows only.
- **NO CORPUS ORACLE.** Never expose live, pre-submission feedback derived from corpus
  matching — no strength meters, no as-you-type "you matched N" hints, no preview scoring.
  Match feedback exists ONLY *after* a judged submission and is bounded by the attempt cap
  (`OBS_MAX_ATTEMPTS`). Any earlier signal is a key-mining oracle: an attacker submits nothing
  and reads the answer key off the meter. The 3-attempt post-judgment retry loop is the maximum
  safe disclosure — knowing where NOT to build is part of the guarantee.
  **The test page (21 Nov 2026):** Sage's frames (each frame's description is the very text the
  observation judge checks answers against), its first look and a test's public findings are the
  OWNER'S while any place is open (`src/lib/test-page/live.ts`, `before.ts`, the findings route); the
  public sees them once the test is done. The front door never shows a test still taking answers.
  **A retest (22 Nov 2026):** while the same builder's later test of the same product is taking answers, the
  earlier test's frames, first look and public findings are the owner's alone again (`openRetestOf`, read by
  the test page, the findings route and the front door's real test). Tests of one product by two builders are
  not matched.
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
  founder's explicit release carries no window. `src/lib/deputy/finalization.ts`. Since 20 Nov 2026 the
  builder may also flag an agent-approved answer inside that window as not a real try, with a reason the
  tester reads (`src/lib/campaigns/builder-flag.ts`): the payout is revoked, the place reopens, nothing is
  refunded, and at most one in five places can be flagged.
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
- **Sage's own records are proof, and a proof that can never pass is never launched (5 Nov 2026).** Work done ON
  Sage (launching a funded job, being paid for verified work) is checked in Sage's own database (`sage_record`,
  `src/lib/verify/sage-record.ts`), never by reading a page: a Sage page never shows who made it. A record's
  worker-written parts (a job's title and missions) reach the judge inside the untrusted markers, never in the trusted
  report. A link proof on a Sage page is converted by the drafter and the card and refused by the compiler for every
  door (`src/lib/launch/proof-feasibility.ts`).
- **A job is payable by construction (6 Nov 2026).** What each platform shows Sage is written once
  (`src/lib/verify/what-sage-sees.ts`: a video's metadata never its picture, ONE Sheet tab's cells, a PR's diff, a Figma
  file's name) and the drafter's prompt, the composer's wallet line and criterion, the feasibility check and the bench's
  payability auditor (`tests/bench/audit-payability.mts`) all read it. Proofs bind to the founder's target: a merged PR
  names its repository (from the handed-over link, the steps, or the founder's answer on the card; refused without one),
  folders and app views (`STORAGE_OR_APP_HOSTS`) become a readable listing, work spread across pages is ONE listing
  whose links Sage opens (`linkProof`, each carrying the wallet; their text reaches the judge as untrusted evidence).
  Measured on the same 60 bench jobs: payable 7 → 31 of the audited, unpayable 31 → 4.
- **The feed never fabricates progress.** Emit a stage event only for real work — no fake
  timers, no simulated steps.
- **The agent may decide WHERE to spend, never HOW MUCH.** Under a founder's standing mandate
  (`src/lib/operator/`) a model picks the position — which surface the founder named, which kind of
  work — and the pure policy sizes it from the ceilings and the observed results. A proposal naming
  an amount is rejected; a surface outside the founder's own set is refused rather than sanitised.
  Every move is recorded with its reason BEFORE money moves and is vetoable for a window.
  The same holds for a test's plan (21 Nov 2026, the founder: "the agent should make the decisions that are good
  for the purpose they most likely came for"):
  - The architect reads what the builder came for (their words, the product's stage, the budget told to it in
    answers, never dollars) and RANKS the core first-try mission: "lead", "alongside" or "yield".
  - That rank is only the core's priority; the frozen allocator decides what a budget funds and every amount.
  - It holds on both planners: a grounded plan no longer has a fixed "never displace" rule (`pipeline.ts`).
  - With no rank, the core leads.
  - The builder sees Sage's read beside the missions ("What Sage thinks you want", `JobView.purpose`) before any
    money moves.
- **Every kind of product gets the best honest test (22 Nov 2026).** A builder can paste anything, so the kind is
  decided once, with no model, from the address and what Sage saw (`src/lib/launch/product-kind.ts`), and carried
  on the map beside the category (`productKind`, absent for an ordinary website, whose map is byte-identical):
  - Kinds: single-page app, dapp behind Connect wallet, Telegram bot and mini app, Discord bot, community, code
    repository, package, API, mobile app, browser extension, desktop download, waitlist, AI chat, design
    prototype, recorded demo.
  - On someone else's platform (a store, a repository host, Telegram) Sage reads the product's own page or path
    only (`inspectProduct`'s `pathPrefix`), and its browser is given no goal to chase there. A pasted GitHub
    repository is also read as a repository (README and file list, never run).
  - The first-try mission has fixed words per kind (`KIND_PLAYBOOK`): the tester reads what Sage read, then
    tries the product where it lives. Where people do the try and Sage cannot (`peopleDoTheTry`), that mission
    may be the whole plan: a thin listing, an architect with nothing to design or a provider that is down still
    ends in one gated mission, never in a question about a store page. (With no model at all, a website does
    too: see "Sage works with no model at all".)
  - `kindProofIssue` refuses a proof Sage cannot read for that kind: a chat link, a transaction's hash on a dapp,
    a handed-over key, and on a listing any page-and-quote mission (quoting a listing pays for reading it).
  - One line says what Sage could and could not try (`honesty`): first among the map's limits, in the first
    look, on the builder's page ("Sage read the store listing", never "Sage tried it") and above the findings.
  - The architect and the core-place question are told the kind in one trusted line (`MISSION_PROMPT_VERSION`
    `mb-v4.8-kinds`; the system prompts are unchanged).
  - Still true: the judge's private key comes from what Sage's browser read, so a listing read as one page sits
    under the three-source floor and its answers hold for the builder's release.
  - `tests/model-zoo/product-kinds.test.ts` runs one saved page per kind through `inspectAndPlan` offline.
  - **A listed product is named and anchored as itself, never as its platform (23 Nov 2026).** P-GEN on six
    real listings wrote "Try T", "Try GitHub" and "Try App Store", anchored on "Search", "Sign in" and a bot
    check's "Client Challenge", and one row's anchors were not in the stored map (integrity 0%).
    - The name is decided once (`kindProductName`): what the address names, else the listing's own heading or
      the title's product part, else a plain noun. The picture reader no longer renames a listed product
      (`product-map.ts`): the platform's name is what is on the screen.
    - `productKind.seen` is the product's OWN words on the listing (`listingWords`): a line that carries its
      name, a sentence of its description, a heading of its README. The platform's furniture
      (`isPlatformChrome`) and a bot check (`isBotCheck`) are passed over. The first try anchors on those
      words, then on the name the address gives (`coreAnchors`' `listedAt`); they are kept on the map, so
      every anchor is in the stored map as well as in the gate's corpus. A bot check is said among the limits.
    - A product on its own site is untouched: on the 1,120 stored maps (none of them a listing) every name
      and first-try mission is byte-identical.
    - `tests/model-zoo/listings.test.ts` holds the six rows, at zero credit and with a healthy model, with the
      battery's own ruler for the stored map.
- **The findings hold up with or without a model (22 Nov 2026).** Most reports are built with no model, so the
  grouping itself is code (`src/lib/report/plain.ts`), and a model's grouping passes the same checks:
  - Plain grouping reads each paid answer sentence by sentence. Two people are one problem when their problem
    sentences name the same two things and fail the same way, or both match the same problem in Sage's own first
    look. One shared thing is enough only with a specific failure and the same rung. People who stopped on
    different rungs are never one problem. When in doubt they stay two findings: never merge two problems.
  - A group's title is a member's own sentence, its quotes are exact substrings (`verbatim`), its count is
    "A of B" people, and with two or more people it carries a fixed fix chosen by how their words say it failed
    (`MODE_FIX`). A plain report is grouped again on every read.
  - A model's group is dropped when it cites no exact words of its own people or puts two stopped rungs in one
    problem (`enforceGroups`); those people are then grouped in code (`coverPlainly`). A number the model put in
    a title is never shown.
  - **What changed since your last test** (`changed.ts`, `previousTest`): the same founder's last FINISHED test
    of the same product (host and path). Understood, finished and would come back read "3 of 10 → 7 of 10"; the
    earlier test's top problems are marked fewer, still hit or gone by the plain rule (`hitBy`). It never says
    fixed, and a small test says it is small. The owner's while any place is open; the public reads it only when
    BOTH tests' findings are public.
  - Sage's plain first look leads with what a newcomer would hit (`weight` in `first-look/core.ts`): the server
    failing, a dead button, a missing piece, a wall. A request refused for being signed out and a missing
    picture come last, and a request that fails on several pages is one line.
  - `src/lib/report/plain.fixtures.ts` holds the answer sets it is measured on (`FINDINGS_TABLE=1 npx vitest run
    src/lib/report/plain.test.ts` prints before and after).
- **Sage pays alone only for an answer that shows a try (22 Nov 2026).** The matcher and the bar are unchanged
  (counting only non-public words in the matcher was measured on 12 Aug: honest 8 of 8 fell to 2 of 8). Beside
  them, `src/lib/deputy/real-try.ts` asks three things with no model. Each can only turn a payout into a hold
  for the builder: it never rejects an answer and never refuses a mission.
  - **The mission** (`missionTryReadiness`): the mission card is sent in as an answer through the real bar. If
    it clears, or fewer than three places behind the first screen hold something only a try reveals, the
    mission is not autonomous. Both numbers are the bar's own. The plan records it per mission
    (`corpusReadiness.missions`, `job.ts`) and the builder reads one calm line before paying (`RELEASE_LINE`,
    `release-line.tsx`). The payout pipeline runs the same function on the pinned key.
  - **The answer's proof** (`tryEvidence`): places behind the first screen named in words that are on neither
    the card nor the first screen (`page:0`, `state:0`). Two places prove a try (`TRY_PROVEN_SOURCES`), and such
    an answer is paid even on a mission that is not autonomous: an honest first-try answer that names the
    screens it reached is never held for being "public".
  - **The parrot** (`realTrySignals`, `escalateNoTry`): three MEDIUM signals, each honest alone, combined like
    `sybil-escalation.ts`. An answer that names nothing behind the first screen AND is mostly the card's and the
    first screen's words (`PARROT_PUBLIC_SHARE`) or passed on fewer than three direct matches becomes one HIGH
    signal: a hold with the reason written out (`no_sign_of_a_try`; `public_overlap` for the mission's own).
  - An honest tester who never got past the first screen is held too: Sage cannot tell that answer from reading
    the page, so the builder reads it and releases it.
  - A passing answer held this way is the builder's call in triage (`held-triage.ts`), never "only because
    auto-pay is off". The calibration record keeps counts, a share and signal names (`shadow.realTry`).
  - `src/lib/deputy/real-try.measure.test.ts` is the offline measure (`REAL_TRY_TABLE=1` prints it): every voice
    on four fixture missions, with a silent model and with one willing to bridge anything. Junk is never paid;
    an honest answer is paid or held. What only `LIVE_JUDGE_EVAL=1` can say (the real key, the real model) is
    printed by `tests/live/judge-acceptance.live.test.ts`, which now asserts on what is PAID, not on the bar.
- **Sage works with no model at all (22 Nov 2026).** "Never fails on any model" includes none: an empty account,
  a spent key, every provider broken, a model that only thinks, the day's budget reached, or no model configured.
  The words every surface uses are in `src/lib/launch/no-model.ts` (no imports, so a client component may read it).
  - **The plan.** When design ends with no plan because NO MODEL ANSWERED (`NO_MODEL_REASONS`), a website gets the
    first-try mission alone, as the kinds people try already did (`firstTryAlone`, `mission-brain.ts`). Never when a
    model answered with an empty plan, or the gate refused its missions: those are answers, and the builder is
    asked as before.
  - **A design nobody could read** (a wrong shape, broken JSON, an answer cut off: `UNREADABLE_REASONS`) is run
    again once, as before (`RETRYABLE_FAILURES`, `job.ts`). When the retry ends the same way there is nothing left
    to try, so on that last run only (`lastTry`) it counts as no answer and the first try alone is the test. It
    was 20 of the 62 jobs production ever failed.
  - **The main action** is then read from the product's own words, with two rungs on the ladder that need no model
    (`core-mission.ts`): the first call to action whose label is something a person does (`primaryCallToAction`;
    "Get started" and "Pricing" name no action), then the heading's verb (`headingAction`; a slogan is passed
    over), then the kind's default. The rungs are on only where no model answered (`firstScreen`). The mission
    faces the same gate, and every anchor is text Sage read.
  - **The mark.** The plan is recorded under `NO_MODEL_PLAN` (its `modelVersion`), carried through approval
    (`DeploymentReadyPlan.withoutModel`), and read wherever the plan travels (`planWithoutModel`).
  - **The builder releases each payment, and is told so.** A plan written with no model starts as `autonomy:
    "manual"` at every door that records a test (`defaultAutonomyFor(visibility, plan)`; the attach route no
    longer lets the deploy step's default override it). That is what makes the line true: with no model the
    judge is the heuristic that never pays, but the deterministic matcher on an observation mission still can
    (measured in the zoo: on an autopilot test it pays an answer in the product's exact words with no model).
    One line says it on the plan's page (`JobView.withoutModel`) and on the test's page (`LiveView.withoutModel`:
    the builder's sentence for the owner, the tester's for everyone else, shown while the test is still manual).
    The tester's steps are unchanged; their ticket reads "Waiting for the builder to read the answer".
  - **A test Sage pays alone, when the model goes away** (`judgeAway`, `deputy/pipeline.ts`). A substantive answer
    the matcher did not clear needs the model judge. When it cannot be asked (`ObservationJudgeResult.unavailable`)
    the answer is a final hold for the builder, never "refine your answer, attempt 1 of 3". The zeros are not kept
    as the attempt's verdict, so the sweep asks again and the answer is judged when the model is back, but ONLY
    when asking again is free (`askingAgainIsFree`: no model, 402, 429, 5xx, a model the breaker passes over). A
    timeout or an unreadable or think-only answer may have been billed: it is asked once and kept with the flag,
    because re-asking a billing model every sweep is the cost leak this repo has had twice. Three
    readers mirror the one flag on the shadow: the pipeline, the tester's status route (no retry offered) and the
    builder's triage (it never leans "no" on an exact-wording count). Subtractive: it can only hold.
  - **The chat.** With no model the concierge replies with the plain reason and the way to the web
    (`src/lib/telegram/no-model-reply.ts`): on any failed turn, and to a plain Telegram message when no key is
    configured (it used to get silence).
  - Already model-free and unchanged: Sage's first look, the findings, the first-users drafts.
  - `tests/model-zoo/zero-credit.test.ts` walks the whole path offline in each mode (paste, plan, approve, pay,
    the test's page, answers, the hold, the release, findings, first users), for a website and a Telegram bot.
- **The account pays its own network fee (24 Oct 2026).** No door sends an account gas unless `OPERATOR_COVERS_GAS=1`;
  short of it, the door names the amount and the way to get it, and moves nothing.
- **An agent key is its owner, and never lifts a limit.** A workspace key acts as the owner who minted it, with only
  the scopes they ticked (read, plan, launch); identity is bound server-side (a caller's `founderOverride` or
  `clientRef` is dropped), the plan, the account's per-job limit and the vault still decide, and revoking is immediate.
- **Sage never sends a tester into harm, and the product is screened before money moves (22 Nov 2026).** The work
  policy refuses harmful WORK; the product safety screen (`src/lib/safety/`) screens the PRODUCT. It is
  deterministic, has no model, and runs in the pipeline once Sage has looked and before a mission is designed; its
  record rides on the map (`map.safety`, after the hash; never sent to a model). It checks:
  - MetaMask's open phishing list (`phishing-list.ts`: fetched at most daily to `var/`, never in a test) and, with a
    key, Google Safe Browsing;
  - lookalikes of well-known brands (`brands.ts`: another alphabet, digits for letters, the brand beside "claim",
    "support" or "wallet", the brand's real domain spelled inside another);
  - a recovery-phrase or private-key field, and words that ask for one (a warning about one is not one);
  - drainer wording on a screen that asks for a wallet, and an address named for a claim or an airdrop;
  - a download kept on a file-sharing service or an unrelated host, a password for an archive, "turn off your
    antivirus";
  - optionally a domain registered in the last 30 days that asks for a wallet or an install.

  Three outcomes:
  - **clear:** as it always was.
  - **hold:** suspicious, not certain. It launches, and the test is recorded held (`campaigns.safety_hold`): never
    public (`isPublicWork`: not on Earn, the board or the sitemap), never shared (`sharingFor` is quiet: no X, no
    Telegram channel, findings private), never announced to the roster, never answered on X, and only the builder's
    invited people may answer (a place from its link, its workspace, its named list). The operator hears once, and
    clears or refuses it: `node scripts/review.mjs products | clear-product | refuse-product`.
  - **refused:** certain harm (on the phishing list and not whitelisted, a recovery-phrase field, a strong
    lookalike that asks for a wallet). The run ends with the plain reason, so no plan exists to launch.

  `launchSafety` runs beside `launchAllowed` at EVERY door that starts a job, and at the web approval and the
  Telegram hand-over, before money moves and never after (a structural test holds the list). It also asks the
  phishing list again as the server has it now. No settlement path reads any of it (tested): a live test keeps
  paying its testers. What Sage noticed is the builder's to read, never an accusation, and never shown to anyone
  else with the link. A false refusal is a failure too: every saved page, every P-GEN address and a list of
  awkward honest addresses must screen clear (`false-alarms.test.ts`). Every tester reads, before a place: never
  type a recovery phrase or a private key anywhere; on a dapp, use a wallet with nothing you would mind losing
  (`testerCautions`, and the first-try words say it too, because a mission's `conditions` are never shown).
- **The core, read against every plan Sage ever made (22 Nov 2026).** Production kept 1,156 inspection jobs (946
  ready, 148 asked a question, 62 failed; 2,397 missions). Today's deterministic code was run over all of them,
  with no model and no network, and what it still passed was read. The measure is kept:
  `PLANS_CORPUS=/path/to/sage-plans.jsonl.gz npx vitest run tests/plans-corpus/measure.live` (the export is
  private production data: never in the repo, a fixture or this file; `tests/plans-corpus/reconstruct.ts` says
  what a stored job cannot tell, chiefly that the static read is not stored, so anchors and scope are
  approximate there). What it changed:
  - **Four gate rules** (`src/lib/launch/mission-quality.ts`, in `validateMission`), each added only after
    counting on the whole corpus what it catches and what it would wrongly refuse. They read the mission's own
    words, never the corpus:
    - `unnamed_target`: a criterion or evidence question that sends the tester to "the target" or "core
      experience", Sage's own placeholder quoted as if it were on the screen (70 caught on 17 products, 0 wrongly
      refused). The goal compiler no longer writes it either (`isPlaceholderTarget`).
    - `asks_personal_detail`: an evidence question whose answer is the tester's own email, password or phone
      number; answers are read by the builder and quoted in findings (5 caught, 0 wrongly refused).
    - `needs_developer_tools`: what the mission is paid for can only be read from the browser's developer tools
      (31 caught; 4 of them developer-docs missions where one question of several needs the tools). A passing
      "no console errors" beside a real task, and the tools offered as one way among others, are NOT refused: 34
      good missions on 13 products read that way.
    - `answer_on_the_card`: every evidence question hands over its own answer ("Quote the text 'Well done!'")
      (9 caught, 0 wrongly refused).
    Measured and not added (false refusals not near zero): "the first headline" on a news site, yes-or-no-only
    evidence, another browser or a phone-width window.
  - **The main-action ladder** (`core-mission.ts`): a label that carries a keyboard shortcut, the page's own
    furniture ("Toggle theme", "Skip to Content") and more doors ("Start free trial") name no action; a heading
    with a separator is read part by part; a starting point is a door, something a person does, or a control
    that shares a word with the action, and otherwise the mission names none (it used to name the first control
    whatever it was, on 496 of 911 stored plans); an accepted mission's title gives the action without its
    checking tail, its "First-time visitor" subject or the goal's filler (`actionFromTitle`).
  - **The kind**: "Connect to Wallet" is a dapp; "Get the app" alone makes a phone app only where Sage's browser
    found next to nothing to use. **The safety screen**: the title of a help article ("How to import a recovery
    phrase into the X Wallet") is not an ask; it had held one well-known dapp, the only product of 57 stopped.
  - Still true, and counted beside it for the founder: when a model answered and every mission was refused, the
    builder is asked (65 of the 148 questions; a first try alone would have been an honest test on 7 of them).
- **Reaching a person is opt-in, always.** The roster (`src/lib/roster/`) messages only people who
  asked, at most one campaign per person per cooldown, never about work they already did, and never
  about a campaign with no claimable slots. Being paid is not consent.

---

## 5. Design system

**One system: "The Stop" (the flagship identity, 24 Nov 2026; "receipt minimalism" and its terracotta are
retired).** **Every try stops somewhere:** an ink line runs as far as a person got, and Sage's hand, in seal
red, marks where it stopped. Chosen by the /flagship method (six directions, a blind panel on three models).
The design files, the kit that draws every board, post and film, and the decision (`FLAGSHIP.md`) live
outside this public repo, in `~/projects/sage-launch/design/`. In the app: tokens in `src/styles/tokens.css`
(the single source of truth), the geometry and the stamp's angle in `src/lib/brand/stop.ts`, the character
in `src/lib/brand/worker.ts`, the mark in `src/components/brand/sage-mark.tsx`, the PAID stamp in
`src/components/sage/paid-stamp.tsx`, and Fira for share images in `src/lib/brand/og-fonts.ts`.

**One bar, no rail (the relaunch, 20 Nov 2026).** The hover rail and the company header are gone. Every page
wears ONE top bar (`src/components/sage/top-bar.tsx`: the mark, Tests `/`, Earn `/earn`, New test, and the
avatar or "Sign in"), mounted once in the root layout; `hasTopBar` in `src/components/shell/routes.ts` names
the three pages that stay bare (`/proof/<tx>`, `/start`, `/join/<code>`), and `bar-routes.test.ts` holds the
bar's list. The six screens below are all still pages, reached from the account sheet that opens from the
avatar. New UI is built from the kit in `src/components/sage` and `src/styles/sage.css` (classes prefixed
`sg-`): the paste box, the test card, the tester ticket with its round seal PAID stamp (it lands once per
real payout, at its transaction's own angle, and is never replayed), the frame, the sheet. `/` is the paste box (signed out) or your tests (signed
in); `/pricing` is one screen with no tiers; `/marketplace` and `/missions` redirect to `/earn`; a test's
address is `/t/<id>` (`testPath`).

**Two worlds since 19 Oct 2026 (they now share that one bar):**
- **The company site:**
  - Pages: home, pricing, company, ParallaxPay, ledger, docs.
  - Reading pages (restored 20 Oct 2026 after being folded the day before): outcomes, records (`/record`, above
    every `/record/<wallet>`), the Caribbean, the FAQ, the two comparisons (`/vs/*`) and the case study. They use
    `ReadPage` (`src/components/site/read-page.tsx`) and `src/styles/read.css`; their numbers come from
    `src/lib/site/readings.ts`, which reads the same derivations as the home page and the ledger (tested).
  - Every page is wrapped in `SiteFrame` (`src/components/site/`: the page and the footer; the header is the
    one bar) and styled by `src/styles/site.css`: Apple-like restraint, one idea per section, large type,
    real product imagery. The footer links every public page except the advance and the lenders' page.
  - The hero's product shot is the latest real receipt, and every number comes from `src/lib/site/live-proof.ts`.
- **The app** is six screens (no rail lists them any more; the account sheet links four, tested):
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

- **The mark ⊣.** On a 200 grid: an ink path 34 tall from its container's left edge to x 118, stopping at a
  seal wall 38 × 150. Never on an ink ground (a no-entry sign), never a full-height wall (a half-disc), never
  an arrowhead (the Tab key), never a red disc, never the letter S, never a rounded square. The avatar is the
  mark on white. The wordmark is SAGE in Fira Sans Extra Condensed 800, letter-spaced.
- **Color.** Paper `#ffffff`; ink `#161b29` for what people did, all type, **every button and link**;
  **seal `#ba0c2f` is Sage's hand only**: the stop, the PAID stamp, the strike (`--seal`). Red is never a
  button, a link, a field or a disc, and never brighter (Optimism owns `#ff0420`). Pencil `#75787b` is held;
  copy `#efefed` is the quiet second surface (neutral: never blue, never cream). Green is retired (Sage Group
  owns it). Paid, held and refused never rely on colour: a stamp, pencil brackets, a strike, each with its
  word. `--ok` (paid/verified) is ink, `--err` (refused/failed) is the seal, `--warn` (held) is pencil.
- **Type.** Fira Sans (`--font-sans`) for UI and reading; Fira Sans Extra Condensed 800 (`--font-display`)
  for display lines, stamps and big numbers (`h1`, `h2` get it globally); Fira Mono (`--font-mono`) for
  hashes, times, serials and amounts. All OFL, wired via `next/font` in `layout.tsx`. **Tabular numerals.**
- **Radii.** Square: `2` (inputs, cards, buttons), `4` (large surfaces). `999px` pills **only** for status
  chips.
- **Elevation.** None at rest: a 1.5 px ink or a hairline edge is the elevation. One soft float shadow only
  for sheets and popovers.
- **The character.** Sage drawn as a working rubber stamp, no face and no hands, doing one of twelve verbs.
  Films, posts and the X header only: never the avatar, and on a receipt, the ledger or the findings only its
  print appears.
- **No emoji** in UI — use lucide line icons.

The dark `:root` system in `src/app/globals.css` is **legacy** (it belongs to the dead
product). Never extend it; migrate off it.

---

## 6. Environment

### Lanes — routing a job to a provider

A **lane** is one job Sage gives a model: `PAYOUT` (judgment), `CONCIERGE`, `MISSION`
(design), `OBS_JUDGE`, `VISION`, `DRAFT` (Post's hand-over: a job written from what a founder
pasted, while they wait, so it inherits the fast shared chain unless configured; 28 Oct 2026), `REPORT`
(groups a test's paid answers into the builder's findings, `src/lib/report/`; background work, so the first
to stop under the daily budget, and the report is then grouped in code, `plain.ts`; 20 Nov 2026). Each lane may run on its own provider by setting
`<LANE>_API_KEY`, `<LANE>_BASE_URL` and `<LANE>_MODEL` — **all three together**. Set
partially, a lane is treated as ABSENT and inherits the shared chain; it is never merged,
because merging splices one provider's key onto another's endpoint (authenticates as
nobody, fails on a founder's launch instead of at boot). `laneProvider()` in
`src/lib/llm/complete.ts` is the single implementation; `src/lib/llm/lane.test.ts` holds it.

This is what makes a model/provider switch a config change rather than a code audit.

**Moving every lane at once is one command on the VM:** `node scripts/vm/llm-route.mjs status|anthropic|commonstack`
(then `pm2 restart sage --update-env`). It saves the lines it changes the first time
(`~/.config/sage/llm-route-commonstack.env`), keeps a timestamped `.env` copy, leaves `LLM_FALLBACK_*` on the
other account, and never prints a key.

**Probe before you trust a route (22 Nov 2026):** `node scripts/vm/llm-route.mjs probe` asks each distinct
provider and model one 16-token question, which passes even a nearly spent key quota. It names what is broken,
out of credit, at its key spending limit, or an unknown model. `--answer` gives room for a real JSON answer and
shows the vision models a red square, so a model that thinks past its budget, or is blind, says so. Run it before
any battery and after any route change: on 20-21 Nov `status` looked right while every `anthropic/*` model on
CommonStack, and DeepSeek V4 Flash, answered 500.

**Prod (27 Nov) runs on Claude, on the founder's monthly $100 of Claude credit:** every lane is Claude Sonnet 5.5
on Anthropic's own endpoint (`llm-route.mjs anthropic`), with Claude Haiku 5.5 as the backup eye. The fallback stays
on CommonStack's GPT-5.4 mini, a different account. `LLM_DAILY_BUDGET_USD=3` keeps a month inside the credit.
Its payout judge is an approved identity (`docs/deputy-promotions/2026-11-05-anthropic-claude-sonnet-5-5.md`).
`llm-route.mjs commonstack` restores the 21 Nov CommonStack routing:

| Lane (21 Nov, CommonStack) | Model |
|---|---|
| Mission design, the payout judge, the concierge, the observation judge | MiniMax M3 |
| The shared chain (drafts, findings, the first look) and the fallback | GPT-5.4 mini |
| Vision | Qwen3-VL, with Gemini 3.5 Flash as the backup eye |

**Every model call goes through ONE wire** (`src/lib/llm/wire.ts`, 5 Nov 2026; a structural test refuses a
direct `chat/completions` fetch anywhere else). It:
- shapes each request for its provider: what the profile says, then what the provider itself refused at
  runtime (Anthropic's endpoint refuses `temperature` and `json_object`);
- runs a bounded number of requests per key (`LLM_MAX_CONCURRENCY`, default 4), with a waiting person
  first: draft and concierge, then judgment, then background design;
- treats an account OUT OF CREDIT as closed, not busy. The provider's own words decide (CommonStack
  answers `429 Insufficient available balance`). The wire then:
  - answers it as 402, which no caller retries, and remembers it for 30 s;
  - sends the judge and the mission designer straight to their fallback;
  - tells the operator chat once (`src/lib/llm/credit-alert.ts`);
  - lets the sweep ask the empty account each tick, so a top-up is noticed and the work held during it is
    re-judged.

  A fallback on the SAME account is no fallback: point `LLM_FALLBACK_*` at a different one.
- treats a BUSY key as busy, and a SPENT key as spent (21 Nov 2026). CommonStack's `429 "Access key quota
  exceeded (cap 3)"` is the KEY's spending quota, checked against each request's most it could cost (measured:
  one call at a time, max_tokens 8 answered on every model while 1,024 to 8,000 were refused). Its limit was $3 a
  week, and two staging P-GEN runs spent it. A capped 429 waits 5 s, 15 s, 30 s, 60 s (calls in
  flight give back what they hold); a plain 429 waits 4 s, 10 s, 20 s. Both stay inside the call's budget, with up
  to 1 s of jitter, and honour a short Retry-After. Still capped after every wait, the key is closed exactly like
  an empty account: one operator alert ("raise this key's spending limit"), 402 at once, and the sweep's probe,
  sized like real work (4,096 tokens), reopens it. An empty account and a long Retry-After still go straight back.

- treats a BROKEN MODEL as broken (22 Nov 2026; DeepSeek V4 Flash answered 500 to 8 of 8 calls the day
  before and every job paid its retries). Five 5xx in a row on one key AND model open a breaker: 503 at once
  with no network call, one operator alert (`credit-alert.ts`), and after 60 s one real call is the probe (an
  answer closes it; another 5xx doubles the wait, up to 15 min). The sweep probes it each tick too. Another
  model on the same key is untouched; timeouts and 429s are not counted.

Work that can wait a minute (the first look, the findings) asks through `completeSteadily`
(`src/lib/llm/steady.ts`): a transient failure is retried with backoff, then the fallback is asked once. A
shape miss or a 402 is thrown at once, so the caller's plain version still stands.

**The core never stalls on a model (22 Nov 2026).** Measured 21 Nov: MiniMax M3 thought all 14,000 tokens away
on the architect prompt, the ladder called that a truncation and asked it five times with more room, and two
products sat at "generating_missions" for 1,500 s. Now:
- **Think-only is its own failure** (`thoughtOnly` in `complete.ts`: finish "length" with no answer started).
  It is never given more room. It is remembered per provider, model, lane and job tag (`model-health.ts`,
  an hour, doubling to six; `LLM_OVERTHINK_COOLING_MS`); a new prompt version is a new tag. While it cools,
  `completeSteadily`, the architect, the critic and the draft ask the fallback FIRST, but only when the
  fallback is a different model (`distinctFallback`; on prod the shared chain and the fallback are the same).
- **Mission design has one clock** (`withDeadline`, `deadline.ts`; `MISSION_DESIGN_BUDGET_MS`, default 7 min,
  sized on MiniMax's 63 to 151 s architect). Every call inside gets at most what is left; at the deadline the
  brain returns the best plan that is ready, gated as always, never a made-up one. An improvement round
  starts only with 150 s left. Each architect round asks the fallback at most once.
- **Hedging where a person waits**: the architect (`MISSION_HEDGE_AFTER_MS`, 150 s), the core-place question
  (8 s) and the draft (`DRAFT_HEDGE_AFTER_MS`, 10 s) start the fallback beside a silent primary and take the
  first answer (`hedged`). Never the judges: the payout judge keeps its own same-model hedge and its pinned
  identity, and the observation judge only retries the SAME model once.
- **In parallel**: critic batches, and the grounded planner beside the legacy one.
- `tests/model-zoo/` is the offline battery: a fake provider with each measured behaviour, every lane run
  against each on the fake clock (valid result or the plain version, a wall-clock budget, bounded calls, the
  money rules). Run it after any change to the wire, a ladder or a profile: `npx vitest run tests/model-zoo`
  (`ZOO_TABLE=1` prints the grid). `zero-credit.test.ts` beside it is the whole product with no model (section 4).
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
| `CONCIERGE_MODEL` † | Telegram concierge model (prod: `llm-route.mjs status` says which) | Falls back to `LLM_MODEL`→`DEPUTY_MODEL`→default (behavior silently changes) |
| `CONCIERGE_API_KEY` / `_BASE_URL` † | Reserved LLM budget for the public concierge — preferred over `LLM_API_KEY`/`_BASE_URL`, so public chat traffic can never exhaust the money-critical judgment path's quota | Falls back to the shared chain, unchanged |
| `CONCIERGE_DAILY_CAP` / `INSPECTION_DAILY_CAP` † | Per-chat daily caps (over the per-minute limit) on concierge turns (default 60) and inspections started (default 3); slash commands are uncapped | Defaults apply |
| `LLM_FALLBACK_API_KEY`/`_BASE_URL`/`_MODEL` | Secondary provider (all 3 arm failover) | No fallback — a primary outage drops to heuristic |
| `DEPUTY_AUTOPILOT_MAINNET` | Arms real-money auto-pay on GOAT | Mainnet campaigns hold for manual approval |
| `FIELD_TEST_ENABLED` | `"1"` arms the Playwright "Field Test" — Sage actually browses the inspected product in a real headless browser (screenshots, JS-rendered content, console errors) and feeds it to the Mission Brain | HTML-only inspection (default; behaves exactly as before). Needs chromium: `npx playwright install --with-deps chromium` |
| `GOAT_AGENT_PRIVATE_KEY` | GOAT operator key (also holds ERC-8004 id + pays x402) | Cannot sign GOAT settlements |
| `METIS_MAINNET_OPERATOR_PRIVATE_KEY` † | Metis mainnet operator key (falls back to `GOAT_AGENT_PRIVATE_KEY`); must be the key of the operator address baked into the Metis vaults (`METIS_MAINNET_OPERATOR_ADDRESS`), or every payout holds with `operator_mismatch` | Falls back to the GOAT agent key |
| `OPERATOR_PRIVATE_KEY` | The RETIRED Metis Sepolia operator key. Metis mainnet never reads it (`signer.ts`) | Cannot sign legacy Sepolia writes |
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
| `ADVANCE_SELF_SERVE` † / `ADVANCE_MAX_USD` † / `ADVANCE_MULTIPLE` † / `ADVANCE_WATERFALL_BPS` † | Self-serve working capital on `/record`: `"1"` arms the owner's advance; max principal (default 5), the lender multiple on monthly verified inflow (default 1), the repayment share of each next verified payout (default 5000 = 50%). On Metis since 26 Oct 2026 (`src/lib/advance/`): offered only when the pot can pay (else a calm "paused, check back soon"); the borrower approves the pot once, the advance goes straight to their wallet, and the sweep collects the share of each later verified Metis payout under that approval (`collect.ts`). | Off — the door 404s; the operator route still works |
| `ADVANCE_POT_PRIVATE_KEY` † | The advance pot: a Metis wallet of its own (made on the server with `scripts/vm/pot-key.mjs`, never printed), holding m.USDC to lend and a little METIS for its fees. Refused if it equals any key that signs payouts or x402 settlements. | Advances read as paused; nothing is offered |
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
| `LLM_MAX_CONCURRENCY` † | Requests one provider key may have in flight (the wire). `1` restores the old single lane. CommonStack's "(cap N)" refusals are a spending quota on the key, not a concurrency limit (see the wire) | 4 |
| `LLM_DAILY_BUDGET_USD` † | A day's model spend per provider account (`spend.ts`): background design stops at 1×, drafting and the concierge at 1.5×, judgment at 2×; a refused call reads as an empty account (402) | No ceiling; the meter still books every answer to `var/llm-spend.json` (`LLM_SPEND_PATH`) |
| `MISSION_DESIGN_BUDGET_MS` † / `MISSION_HEDGE_AFTER_MS` † / `DRAFT_HEDGE_AFTER_MS` † / `LLM_OVERTHINK_COOLING_MS` † | The whole mission design's wall clock; when the architect's and the draft's fallback start beside a silent primary (0 turns the architect's hedge off); how long a think-only model is passed over for that job | 420000 / 150000 / 10000 / 3600000 |
| `<LANE>_REASONING_EFFORT` † | `low` / `medium` / `high`, sent as `reasoning_effort` on that lane's calls (a provider that refuses it is learned once) | Not sent |
| `GITHUB_TOKEN` † | Read-only token for GitHub's API: the page reader (issues, PRs and their files, repos, gists), PR provenance, account age. Never logged | 60 calls an hour per server; past it, a merge check HOLDS rather than fails |
| `VERIFY_RPC_<chainId>` † | RPC override for a verify-only chain (`src/lib/verify/chains.ts`: Ethereum, Base, Arbitrum, OP, Polygon, BNB, Avalanche, Linea, Scroll, testnets). Read-only; nothing is paid there | The public RPC in `chains.ts` |
| `SAFE_BROWSING_API_KEY` † / `PRODUCT_SCREEN_RDAP` † / `PHISHING_LIST` † / `PHISHING_LIST_PATH` † | The product safety screen's outside lists (`src/lib/safety/`). A Google Safe Browsing key adds its verdict (the key travels in a header; only the product's address is sent). `PRODUCT_SCREEN_RDAP=1` asks rdap.org for a domain's age. `PHISHING_LIST=off` stops the daily fetch of MetaMask's list; the path is where its copy is kept | No Google check; no domain age; the list is fetched daily to `var/phishing-list.json`. With no list the screen records "unavailable" and every other check still runs |
| `IDENTITY_DOOR=social` † / `IDENTITY_SOCIAL_CEILING_USD` † | The tester door (20 Nov 2026, `src/lib/identity/social-door.ts`): public work opens to a wallet whose owner signed in with Google or X (read from Privy's verified record into `person_identities`) or from their own Telegram chat, one place per person (the same account on a second wallet is LINKED, never a second person). Above the ceiling (default $5) World ID is still required. `IDENTITY_DOOR=1` keeps meaning World ID for everyone | `1`: World ID for everyone (prod until the relaunch) |
| `X_AGENT` † (`off`/`dry`/`live`), `X_API_KEY`/`_SECRET` †, `X_ACCESS_TOKEN`/`_SECRET` †, `X_DAILY_BUDGET_USD` †, `X_REPLIES` †, `X_INSPECTIONS_DAILY_CAP` † | Sage on X (`src/lib/x/`): posts a test's mission and result only with the builder's yes (`campaign_sharing`), and with `X_REPLIES=on` (after X approves the bot) answers a post that tags it with a link by drafting a test owned by that X account (`claim-x`). Every post is written down before it is sent, inside a daily ceiling at X's pay-per-use prices ($0.20 a post with a link). `live` without all four keys runs as `dry`. `node scripts/vm/x-agent.mjs` prints the day | Off |
| `TELEGRAM_MISSIONS_CHAT_ID` † | Sage's public Telegram channel of open tests (`src/lib/telegram/missions-channel.ts`): a shared test is posted once, with a Take a place button. The bot must be an admin | No channel posts |
| `TELEGRAM_LAUNCH_ON_WEB` † | `"1"`: a launch asked for in chat hands over the test's page (`/t/<id>`) to pay from the founder's own wallet, instead of spending from the chat's server wallet (Metis Rise counts only user-controlled wallets from 1 Dec 2026) | The chat wallet launches as before |
| `NEXT_PUBLIC_LOGIN_X` † / `NEXT_PUBLIC_PAY_FROM_EMBEDDED` † | Build time. `1` shows Sign in with X (once it is on in Privy) / lets an email or Google sign-in pay for a test from its Privy embedded wallet (`src/lib/own-wallet/`; switch on after one live payment) | No X button / an email session pays with MetaMask or its Sage account |

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
| **Every stored plan** | today's deterministic core against every inspection job production kept: who was asked and would now get a test, why jobs failed and what happens now, every mission through today's gate (with the kind's proof rule, the real-try readiness and the safety screen), and the first-try mission for every ready plan. No model, no network; counts on the console, the per-job report beside the export | `PLANS_CORPUS=/path/to/sage-plans.jsonl.gz npx vitest run tests/plans-corpus/measure.live` (the export is private: never commit it) |
| **Metis launch fork** | whether an account launch on Metis would go through and pay, before real money tries: production's own bundle (create → approve → fund → activate) from the account's REAL balances on a local anvil fork, then the real operator pays the mission and a second person is refused (code 7). No model, nothing broadcast; prints each step's gas and METIS at today's price | `METIS_FORK=1 npx vitest run metis-launch-fork.live` (anywhere with Foundry's `anvil`; `METIS_FORK_ACCOUNT` for another account) |

**A battery must import production's own prompt/tools, never a copy** (`systemPrompt`, `TG_TOOLS`,
`asOpenAI`, `DIRECT_BLOCK`). P-DIRECT once hand-rolled its tool encoding, the schema landed under a
key the API ignores, and several rounds of "defects" turned out to be the harness.

**Model production's loops or you will over-report.** The concierge resolves a name to an id with a
read tool before acting, and self-corrects once when a turn claims an action it did not take.
A one-shot battery scores both as failures a founder never experiences.

Scripts in `scripts/`: `review.mjs` (held work, and a product the safety screen held or refused), `recount.mjs` (PUBLIC: recounts Sage's numbers from the chain; dependency-free), `lane-audit.mjs` (prints the provider each LLM lane resolves to — partial
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
   - **The recorded amount is the campaign's, not the vault's** (found by the public recount, 7 Nov
     2026). `settle-starknet.ts` (frozen) journals `campaign.rewardAmount`, while the Cairo vault
     pays the MISSION's reward; on a grant whose milestones differ they can disagree. One payout
     (`grant-DPJrhHEmdB`, tx `0x2337…b54`) was journalled 5054779 for a vault release of 5054778;
     its row was corrected from the chain the same day. The rail is closed, so no new row can drift;
     the EVM flow journals the amount from the vault's own event.

8. **`missedMoneyAction` judges the FOUNDER'S words, not the model's draft** — an amount plus
   either a payment verb or an offer of work to a person ("I need someone to…"). It is the
   trigger for the corrective round, and its counterpart `checkStatedTerms`
   (`src/lib/launch/stated-terms.ts`) compares the compiled plan against the founder's own
   arithmetic. Both exist because every OTHER money gate checks a plan against ITSELF, and a
   plan that drops two of three tranches is perfectly self-consistent — just not what was asked
   for.
