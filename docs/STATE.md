# Sage — Current State & Handoff

> A complete snapshot of what Sage is, how it's designed, what's built, what's
> real vs pending, and what's next. Written as a single source of truth for the
> current build. Pairs with `docs/perfect_idea.md` (the locked product spec).
>
> Last updated: mid‑build, after the real wallet + founder‑signed vault creation
> pass. Network is **Metis Sepolia** (testnet); mainnet is a later config flip.

---

## 1. What Sage is (the one‑liner)

**Sage is a control layer for budgeted AI workers.** You hire an AI worker, give
it a **budget and a rule**, and it can pay real people for real completed work —
autonomously — **without ever holding your keys.**

- **Sage** — the platform (a premium, tabbed web app).
- **Deputy** — the worker you create inside Sage.
- **Reward Deputy** — the v1 flagship worker: runs reward campaigns for
  communities / hackathon teams, verifies completed work, and pays the
  tester/contributor in USDC.
- **Policy Vault** — the leash. An on‑chain contract that holds the money and
  enforces the rules. The agent *proposes* a spend; the vault *decides*.

**The promise:** confirm the policy once → the Deputy acts autonomously inside
it → the vault physically blocks everything outside it (wrong amount, wrong
recipient, over budget, after revoke — all impossible).

**Why it wins:** the fragile part (does the AI judge correctly) is kept off the
critical path (v1 = explicit human approval), and the money‑safety part is
enforced by a contract, not a model — so the live demo *cannot go wrong*. Every
payout is real USDC to a real wallet, verifiable on‑chain.

### Competition context
Built for the **OpenClaw Summer Builder Bootcamp** (GOAT / Metis ecosystem).
Judged on **product quality + real users + real economic activity**. Required
integrations: **x402** (payments) + **ERC‑8004** (agent identity). Build native
to GOAT / Metis / LazAI.

---

## 2. Design system

Premium, calm, **light/white** — Apple / Stripe / Linear / Mercury / Arc. Money
+ agents need *control*, so it's an app, not a chatbot.

| Token | Value | Use |
|---|---|---|
| Paper | `#fbfbf9` | background |
| Ink | `#1a1d21` | text / the mark / the ring arc |
| Secondary | `#5b5f66` | body |
| Tertiary/muted | `#8a8d92` / `#9a9da2` | hints |
| Border | `#ecebe6` (also `#e4e2dc`, `#f1f0ec`) | 1px structure |
| Surface tints | `#faf9f6` / `#f6f5f1` / `#f3f2ee` | soft fills |
| **Indigo** | `#4f46e5` | the ONE action color |
| Eyebrow indigo | `#9a8fef` | mono section labels |
| **Green** | `#15803d` (bg `#eef6f0`, line `#cfe6d6`) | settled / verified |
| **Red** | `#dc2626` (bg `#fdeeee`, line `#f3cccc`) | blocked / revoked |
| Amber | `#b45309` (bg `#fdf6ec`) | timelocked |

- **Fonts:** Inter (UI/display), JetBrains Mono (every figure, address, hash).
- **Rules:** no gradients‑as‑decoration, no glassmorphism, soft shadows, 12–20px
  radii, lucide line icons. Strict color discipline (indigo=action, green=settled,
  red=blocked, nothing else).
- **The signature element — the Budget Ring:** a canvas arc showing
  remaining‑of‑budget, driven by live vault data, animating the drain with a
  green settle glow / red block flash.
- **The signature moment — the Traveling Ring:** ONE ring that never unmounts and
  FLIP‑glides + resizes between every onboarding screen's slot (fund → create →
  policy → confirm → boot), then hands off to the app. The object you fund becomes
  the object you seal becomes the heart of your app.

The design was authored separately as a clickable prototype (`Sage Master Design
Prompt/` — `.dc.html` files, gitignored) and ported 1:1 to real React. Files:
`Budget Ring.dc.html`, `Sage Landing.dc.html`, `Sage App.dc.html`, `Sage Proof
Page.dc.html`.

---

## 3. Tech stack

- **Next.js 15.5** (App Router, server‑first RSC), **React 19**, **TypeScript strict**.
- **Tailwind** + hand‑written scoped CSS per surface.
- **viem ^2.53** for all chain access (reads + writes, server and client).
- **lucide-react** icons. Vitest (unit) + Playwright (e2e).
- Contracts: **Foundry** (`contracts/`), OpenZeppelin v5.

Quality gates (all currently green): `npm run typecheck` · `lint` · `test` · `build`.

---

## 4. On‑chain layer (Metis Sepolia · chainId 59902)

Explorer `https://sepolia-explorer.metisdevops.link` · RPC `https://sepolia.metisdevops.link`.

| Contract | Address | Role |
|---|---|---|
| PolicyVault (demo) | `0x52A7Ae4e7812472C2F6D4A7eAf76EDD4475E6279` | the seeded demo Deputy's vault |
| PolicyVaultFactory | `0x9b885D79c03A43D638195b72818CbCC2d496D9A2` | deploys per‑founder vaults (CREATE2) |
| MockUSDC | `0xF176f521290A937d81cc5878dfc19908f4D681A1` | settlement token — **public `mint`** (free test USDC) |
| Kill vault (disposable) | `0xEF5425AE80a6E3a198d63dA855EE3783D53EA7B8` | for the real "revoke" demo, never the live one |
| Operator (AI key addr) | `0xb77e6f5466cf52524e8465859277f192Be0bCfe4` | the ONLY key that may call `requestSpend` |

### The PolicyVault contract (`contracts/src/PolicyVault.sol`)
- One vault per Deputy. Holds USDC, enforces the mandate.
- `requestSpend(vendor, amount, intentHash)` runs 6 checks **in order** and
  **soft‑rejects** (emits `SpendRejected` with `failedCheckIndex`, never reverts)
  so the UI can show which check failed. On success it `safeTransfer`s USDC to the
  recipient and emits `SpendSettled`. Checks:
  **1** state (Active + not expired) · **2** caller (== operator) · **3** vendor
  (on allowlist) · **4** amount (≤ per‑tx cap) · **5** budget (≤ remaining) ·
  **6** velocity (≤ rolling 24h cap).
- Mutability: `budgetCeiling` / `duration` / `paymentToken` **immutable**;
  per‑tx & velocity caps **lowerable‑only**; vendor adds **timelocked**, removals
  instant; `revoke()` **terminal** (owner or guardian).
- Lifecycle: Created → Funded → Active ⇄ Paused → Revoked. `activate()` requires
  the vault to fully back its ceiling (no fractional reserve).
- Factory `createVault(operator, guardian, token, budget, perTxCap, velocityCap,
  duration, initialVendors[], vendorTimelock)` → `msg.sender` = owner.

### Server reads/writes (`src/lib/deputy/`)
- `chain.ts` (server‑only): `getVaultState`, `getVaultPayoutHistory` (reads
  `SpendSettled`/`SpendRejected` logs = the proof trail), `getPayoutProof(tx)`
  (single‑tx proof for the public page), vendor allowlist getters. Dual network
  config (metis‑sepolia default, metis‑andromeda present‑but‑unused, flip via
  `DEPUTY_NETWORK`).
- `signer.ts` (server‑only): loads the **operator key** (`OPERATOR_PRIVATE_KEY`
  or `contracts/.env`), `submitRequestSpend` (real payout tx), `submitRevoke`.
  Metis uses legacy gas (`gasPrice`).
- `bounties.ts` (server‑only): seeded reward submissions (`PENDING_BOUNTIES`),
  each paying an approved recipient ≤ cap; `bountyIntentHash` (deterministic, used
  to dedupe already‑paid bounties). **Superseded by the campaign layer** (§4.5) but
  still powering the in‑app "Agents" demo payout.
- `reasons.ts` (pure): `failedCheckReason(index)` — the one map from a vault's
  `SpendRejected.failedCheckIndex` (1..6) to a human reason. Shared by payout +
  settle so both speak the same language.
- `signer.ts` also now has **`ensureVendorApproved(vault, vendor)`** — the owner
  half of the settle cascade: if our operator owns the vault it queues + executes
  an allowlist add (idempotent, polls a short timelock; ours are 0s); if the owner
  is an external founder it returns `owner_must_add` so the UI can collect that
  signature. Plus `getVaultOwner/Operator`, `isVendorApproved`,
  `getPendingVendorReadyAt`, `getVendorAddTimelock` reads in `chain.ts`.

### Campaign layer (`src/lib/db/`, `src/lib/campaigns/`, `src/lib/auth/`) — §4.5
- `db/schema.ts` + `db/index.ts` — drizzle‑orm over **better‑sqlite3** (WAL) at
  `var/sage.db`, migrations in `drizzle/`. Two tables: `campaigns`, `submissions`,
  with **unique indexes** enforcing one submission per (campaign, wallet) and no
  reused evidence URL. `db` is a **lazy proxy** (opens on first query, never at
  import/build). Deploy swap → Neon/Turso is a one‑file change (same SQLite dialect).
- `db/keys.ts` (pure): `dedupeKey`, `submissionIntentHash` (mirrors
  `bountyIntentHash` so a settled event maps back to its submission), `nowSeconds`.
- `db/campaigns.ts` (server‑only): campaign + submission CRUD, dedupe surfaced as
  friendly errors, `ensureDemoCampaign()` (idempotent seed of the `demo` campaign).
- `campaigns/validate.ts` (pure): SSRF‑hardened evidence‑URL check (https‑only,
  private/link‑local/metadata host blocklist, no creds, length caps), reward/
  criteria/title validation.
- `campaigns/status.ts` (pure): the submission state machine
  (`pending → approved → paid | rejected`).
- `campaigns/settle.ts` (server‑only): **the settle cascade** —
  `ensureVendorApproved` → `submitRequestSpend` with `submissionIntentHash`, returns
  a truthful outcome (settled + proof, or the exact policy reason it didn't).
- `auth/message.ts` (pure) + `auth/session.ts` (server‑only): **SIWE‑lite** — a
  wallet signs a nonce‑bound message; verified with viem `verifyMessage`; session
  is a stateless **HMAC‑signed httpOnly cookie** (7‑day TTL, nonce 10‑min).
- `auth/use-siwe.ts` + `use-wallet.ts` (client): connect → nonce → sign → verify.
- `rate-limit.ts` (pure): per‑process fixed‑window limiter (submit/create/auth).

### API routes (`src/app/api/`)
- `POST /api/payout {taskId, vault?}` — resolves the bounty server‑side, fires a
  real `requestSpend` on the given vault (founder's own, or the demo), returns the
  receipt + fresh vault numbers. **This is the reward loop's real settlement.**
- **`POST /api/campaigns`** — create a campaign (auth = poster). Verifies on‑chain
  that our operator can release from the chosen vault before it will accept it.
- **`POST /api/campaigns/[id]/submit`** — a participant submits (auth = their
  wallet, rate‑limited, evidence SSRF‑validated, dedupe enforced).
- **`POST /api/campaigns/[id]/submissions/[sid]/decide`** — the poster approves
  (→ **runs the settle cascade for real**, returns a `/proof/<tx>` link) or rejects.
- **`GET /api/campaigns/[id]/me`** — the caller's own submission + status.
- **`GET/POST/DELETE /api/auth/{nonce,verify,session}`** — the SIWE‑lite handshake.
- `POST /api/spend {scenario}` — the "try to break it" approved/rejected spends.
- `POST /api/kill` — revokes the disposable kill vault (never the live one).
- `/api/x402/*` — the x402‑style demo rail (local paid resource; real on‑chain
  payment + independent verification). Not yet the real GOAT x402 facilitator.
- `/api/operate*` — **legacy** lead‑gen agent (spec §9 excludes it) — left
  untouched, do not extend.

---

## 5. The user flow (what a founder experiences)

```
Landing (/)                         real landing, live vault + real feed
  └─ "Hire your first Deputy" ─────▶ /app
/app  =  SageApp (one stateful surface, the traveling ring lives across it)
  Onboarding
    0 Welcome      breathing mark + halos · CONNECT WALLET (connect‑first)
    1 Your vault   the ring, USDC · Metis Sepolia
    2 Meet Deputy  Reward Deputy card
    3 Set policy   EDITABLE budget / per‑payout / velocity (ring previews live)
    4 Confirm      HOLD TO CREATE ▶ real founder‑signed txns:
                     mint test USDC → createVault → approve → fund → activate
  Boot             "Setting up your control layer" → hands off
  App (four tabs, floating bottom bar)
    Agents   Deputy hero card + budget ring + featured reward → Approve payout
    Wallet   dark balance hero + real on‑chain tx history
    Policies six mutability‑chipped cards (immutable / tighten‑only / timelocked /
             terminal) + the truthful "you can only tighten" moment
    Proof    vault addresses, network, status, "try to break it" (older style)
    (tap the Agents card → Deputy detail: work journal, ERC‑8004 card — older style)
Public proof  /proof/<txHash>   one payout, verifiable by anyone, cinematic
```

Approving a reward → real `requestSpend` → USDC moves → the ring drains → a
settled receipt (with real tx hash) → "View proof" opens `/proof/<tx>`.

---

## 6. Build status (every surface)

| Surface | Status | Notes |
|---|---|---|
| Budget Ring (canvas) | ✅ real | live‑data driven, drain + settle/block cues |
| Landing `/` | ✅ real | live vault hero + real payout feed; `/hire` redirects here |
| Onboarding + traveling ring | ✅ real | welcome→…→boot; connect‑first; **real founder‑signed create** |
| Step‑3 customizable budgets | ✅ real | editable steppers, live ring preview |
| App · Agents | ✅ real | Deputy card + REAL campaign summary (live counts) or a "create your first campaign" empty state — no fixtures |
| App · Wallet | ✅ real | dark hero + real tx history |
| App · Policies | ✅ real | mutability chips; caps are read‑only truthful (real tighten = a follow‑up) |
| App · Proof tab | ✅ real | "try to break it" fires real on‑chain spend/reject/revoke |
| Deputy detail (work journal) | ✅ real | journal derived from REAL events; designed empty state |
| Public proof page `/proof/[tx]` | ✅ real | reads a real tx + the real campaign title (by payout tx) |
| Wallet connect | ✅ real | viem/EIP‑1193, Metis Sepolia (injected wallet) |
| Founder‑signed vault creation | ✅ built | now EMPTY allowlist + 10‑min timelock; needs user test with gas |
| **Campaign layer** (data + settle) | ✅ real | drizzle/SQLite, dedupe indexes enforced at runtime |
| Public campaign page `/c/[slug]` | ✅ real | dogfood campaign renders; connect→sign→submit |
| New Campaign `/campaigns/new` | ✅ real | signed create; on‑chain check that our operator can pay |
| Review queue `/campaigns/[id]/review` | ✅ real | **Sage‑owned: 1‑click settle · founder‑owned: inline owner‑signed allowlist (+timelock countdown) → settle → proof** |
| Founder‑vault settle path | ✅ built | `vendor-add.ts` owner‑signs queue→execute; needs user test with 2 wallets |
| SIWE‑lite auth | ✅ real | nonce/verify/session verified (httpOnly HMAC cookie) |
| x402 | 🔌 seam only | typed no‑op `facilitator.ts` + honest "activates when GOAT creds land" chip — nothing looks live |
| ERC‑8004 identity | ⬜ pending creds | on GOAT mainnet (2345) |
| Mainnet | ⬜ later | env‑config flip once funds/creds land |

**Real vs demo (after the real‑only pass):** every surface now runs on a real
on‑chain event or a real DB row a user created, or shows a designed empty state.
The fixture layer is **gone** — deleted, not hidden (bounties, the lead‑gen agent,
the x402 local demo, the mock operator screens). The one seeded row is Sage's own
**real** dogfood campaign ("Break Sage's onboarding — get paid"), which starts with
zero submissions. x402 is a labelled seam, not a simulation.

**Still needs a real wallet (can't drive one in dev):** connect→sign→submit, and
the poster's Approve‑&‑pay (Sage‑owned = 1 click; founder‑owned = owner‑signed
allowlist then settle). Server routes, DB persistence + migrations, dedupe indexes,
the SIWE handshake, the dogfood rename, and every page render are verified live
(curl + runtime DB read); the on‑chain legs run when a real user acts.

---

## 7. Key files

```
src/app/
  page.tsx                     landing (/) — reads live vault + history + vendors
  sage-landing.css             landing styles (.slp)
  app/page.tsx                 /app — server reads → <SageApp>
  app/app.css                  the app + onboarding + traveling‑ring styles (.sage-app)
  proof/[tx]/page.tsx          public proof — reads getPayoutProof(tx)
  sage-proof.css               proof page styles (.spp)
  hire/page.tsx                redirect → /
  api/payout/route.ts          real reward settlement (accepts founder vault)
  api/spend|kill|x402/*        break‑it + x402 demo rails

src/components/
  app/sage-app.tsx             THE stateful surface: onboarding state machine +
                               traveling ring + real founder‑signed create + hands to AppShell
  app/traveling-ring.tsx       the persistent FLIP canvas ring (RingState)
  app/budget-ring.tsx          the reusable canvas ring (live data)
  app/app-shell.tsx            the 4 tabs (Agents/Wallet/Policies/Proof) + header
  app/deputy-detail.tsx        work journal / payout list (older style)
  app/connect-wallet.tsx       connect control (4 states)
  landing/sage-landing.tsx     the landing sections
  proof/sage-proof-page.tsx    the public proof layout
  hire/break-it.tsx            "try to break it" (real /api/spend + /api/kill)

src/lib/
  deputy/chain.ts              server reads (state, history, proof) + network config
  deputy/signer.ts             operator key + requestSpend/revoke
  deputy/bounties.ts           seeded reward submissions + intent hashes
  format.ts (+ .test.ts)       usd()/short()/cap()/since() — one source of truth
  wallet/config.ts             client Metis Sepolia chain
  wallet/use-wallet.ts         injected‑wallet hook (connect/switch/account)
  wallet/abis.ts               factory + MockUSDC + vault ABIs (from contracts/out)
  wallet/create-vault.ts       createDeputyVault: mint→create→approve→fund→activate
  wallet/read-vault.ts         client‑side vault read → VaultStateView (founder's vault)

contracts/                     Foundry: PolicyVault, PolicyVaultFactory, MockUSDC,
                               scripts + deploy records (broadcast/59902/)
Sage Master Design Prompt/     the design prototype (.dc.html) — gitignored, port‑from
docs/perfect_idea.md           the LOCKED product spec
docs/STATE.md                  this file
```

Env (`.env`, gitignored): `NEXT_PUBLIC_VAULT_ADDRESS`, `_USDC_ADDRESS`,
`_KILL_VAULT_ADDRESS`, `_FACTORY_ADDRESS`, `_OPERATOR_ADDRESS`, `DEPUTY_NETWORK`,
`METIS_SEPOLIA_RPC`, plus agent keys. Operator private key lives in `contracts/.env`.

---

## 8. The real founder‑signed onboarding (just shipped)

The onboarding is now the real thing, not a ritual:

1. **Connect‑first** — the welcome CTA is Connect wallet; you can't proceed until
   connected on Metis Sepolia. (Verified working — `0xdf70…90e3` connected.)
2. **Set your budget** (step 3) — editable caps; the ring previews live.
3. **Hold to create** — fires, signed by the founder's wallet in sequence:
   - `MockUSDC.mint(founder, budget)` — free test USDC (public mint),
   - `factory.createVault(operator=our AI key, your budget/caps, demo recipients)`,
   - `USDC.approve(vault, budget)`, `vault.fund(budget)`, `vault.activate()`.
   Live progress ("Minting test USDC…", "Creating your vault…", …).
4. **You land in the app on YOUR vault** — read client‑side (`read-vault.ts`),
   fresh (your budget, 0 spent). Approving a reward spends from *your* vault
   (`/api/payout` now takes the vault address; our operator key is its operator).

Model: **you (founder) own the vault; our AI key is the operator** that can only
`requestSpend` within the policy you set.

---

## 9. What we need to go fully real

| Need | Why | Who |
|---|---|---|
| **tMETIS gas** in the founder wallet (faucet.metis.io) | ~5 signed txns to create+fund+activate | you |
| Test USDC | ✅ minted free in‑flow (public mint) | handled |
| Factory / operator / USDC addresses | ✅ in `.env` now | handled |
| **GOAT x402 merchant ID** (`GOATX402_API_KEY/SECRET/MERCHANT_ID`, register at `x402-merchant.goat.network`) | to make the Deputy's verification fee a real x402 payment | you |
| **ERC‑8004 registration** on GOAT mainnet (2345) + GOAT gas | agent identity; appear on `8004scan?chain=2345` (the submission gate) | you |

Decisions already locked this pass: **Metis Sepolia first** (real flow, no new
creds), **wallet before x402/identity**.

---

## 10. Roadmap (next, in order)

1. **You test the campaign loop end‑to‑end** with two wallets + tMETIS gas: create
   a campaign at `/campaigns/new` (paid from your onboarding vault) → open `/c/<id>`
   in another wallet → submit → back in `/campaigns/<id>/review` → **Approve & pay**
   → confirm the recipient is allowlisted, USDC settles, and the proof link opens.
   (On a founder‑owned vault the review UI will report `owner_must_add` — see
   deviations; the clean path today is a campaign on the Sage‑owned demo vault.)
2. **Reposition (Pass 8.5)** — landing narrative + `/stats` + copy sweep.
3. **Finish the last two design surfaces:** Proof tab + Deputy detail.
4. **Real x402 rail** — Deputy pays a gated‑verification fee via GOAT (merchant ID).
5. **ERC‑8004 identity** — register the Deputy; reputation = real settled payouts.
6. **Recurring mandates** (spec wk3) — standing campaigns, no re‑confirmation.
7. **Mainnet** — deploy factory + settle USDC path; flip `DEPUTY_NETWORK`.
8. **Onboard cohort teams** to run small reward campaigns (real users + traction).

### Pass 8 decisions & deviations (for the prompt engineer)
- **DB:** better‑sqlite3 locally (Pass 8 default), isolated behind `db/index.ts` as
  a lazy proxy. A real deploy (shareable links need hosting) swaps to Neon/Turso —
  one file, same migrations.
- **Settle cascade is two‑actor by contract.** Vendor‑adds are **owner‑gated**;
  `requestSpend` is **operator‑gated**. On the demo/Sage‑owned vault owner ==
  operator == our key (timelock 0), so the server runs the whole cascade — this is
  the fully server‑testable path. On a **founder‑owned** vault our operator can pay
  but can't allowlist a new recipient, so `settle` returns `owner_must_add` and the
  review UI surfaces it honestly. Collecting the founder's batch `queueAddVendor`
  signature client‑side (the seam is built: `EnsureVendorResult.reason`) is the
  natural next step — flagged, not yet wired.
- **Kept the old in‑app bounty demo** rather than ripping it out of the client
  shell. The campaign layer ships **alongside** it as the real external product
  (linked from the app header → `/campaigns`); replacing the shell's Agents/bounty
  tab is client‑surgery best done as its own pass.
- **No fabricated data.** The demo campaign is seeded (idempotent) but starts with
  **zero submissions** — real entries only. Consistent with the feed rule.

### Pass 9 — the real‑only pass (done)
Two goals: finish the founder‑vault settle path, and purge every fixture.

- **Founder‑vault settle (client‑side owner allowlist):** the two‑actor gap from
  Pass 8 is closed. `src/lib/wallet/vendor-add.ts` (client) has the poster (=vault
  owner) sign `queueAddVendor`→`executeAddVendor`; `allowlist-state.ts` (pure,
  tested) classifies approved/waiting/ready and formats the timelock countdown.
  The review page now runs one guided motion: **Approve & pay → (if `owner_must_add`)
  inline "Allowlist recipient" step with a live amber timelock countdown → settle →
  green + proof.** A **Settle‑all‑approved** batch allowlists every recipient in one
  sequence then settles each; cards flip green one by one, soft‑rejects show their
  `failedCheckIndex` reason in red. New `POST …/settle` route + `settle-flow.ts`
  (shared by decide + settle) is the re‑fire target. Onboarding now creates vaults
  with an **empty allowlist + a 10‑minute `VENDOR_TIMELOCK_SECONDS`** (recipients
  arrive via campaigns); existing timelock‑0 vaults keep working (the timelock is
  read, never assumed).
- **Events + journal:** new `events` table (migration `0001`) + `recordEvent` /
  `listPosterEvents`; every real step (created / received / approved / rejected /
  allowlisted / settled / blocked) is journaled at the moment it happens.
  `journal.ts` (pure, tested) derives display entries; the Deputy detail view is now
  that real journal with a designed empty state.
- **Purged (deleted, not hidden):** `lib/deputy/bounties.ts`, `/api/payout`,
  `/api/operate*` + `lib/agent/*` + `/console` + agent‑console, the x402 demo
  (`/api/x402/*`, `/x402`, `x402-demo`, `lib/x402/{client,vendor,types}`), and the
  mock operator screens (`(deputy)/*`, `components/deputy/*`, `mock-data.ts`,
  `types.ts`). `lib/x402/facilitator.ts` is the honest typed seam that replaces the
  demo. `src/lib/purge.test.ts` is a standing guard that none of it returns.
- **/app rewired:** Agents tab + Deputy detail read the signed‑in founder's REAL
  campaigns/journal via `lib/campaigns/overview.ts` (server); zero campaigns → a
  designed "create your first campaign" empty state. No fixtures anywhere.
- **First real campaign:** the seed is renamed **in place** (same `demo` slug, no
  orphan) to Sage's dogfood campaign "Break Sage's onboarding — get paid".
- **Deviation:** the founder‑vault allowlist add is **not** journaled server‑side
  (only Sage‑owned adds are), to avoid letting a client write journal rows — the
  `settled` event still lands. Honest gap, flagged.

### Pass 10 — one surface (done, partial by design)
The premium app shell now **is** the product: the poster‑side campaign loop lives
inside the four tabs, and the standalone poster pages are gone.

- **Agents tab = campaign command center.** The Deputy hero (live budget ring)
  now sits above the founder's real campaign list (`campaign-list.tsx`: title,
  status chip, reward, paid‑of‑max, an indigo "N to review" badge). Not signed in
  → an in‑shell SIWE sign‑in gate. Tapping a campaign opens **campaign detail**
  in‑shell (`campaign-detail.tsx`, same back‑button pattern as Deputy detail):
  header + public‑link copy chip + live vault numbers + the **ported review queue**
  — the exact Pass 9 logic (pending/approved/paid/rejected/blocked, the owner‑signed
  allowlist → amber timelock countdown → settle motion, settle‑all). "+ New campaign"
  opens **campaign create** in‑shell (`campaign-create.tsx` wrapping the real form),
  which on publish opens the new campaign's detail directly.
- **Client data layer:** `GET /api/campaigns/[id]` (poster‑gated: campaign +
  submissions + live vault) feeds the in‑shell detail; `GET /api/deputy/overview`
  (session‑gated) refreshes the command center after client SIWE sign‑in or a
  campaign action — no full reload.
- **Returning founder lands in the shell:** `sage-app.tsx` restores a stored vault
  on mount and jumps straight to the app phase (no re‑onboarding). The command
  center is reachable, not gated behind setup twice.
- **Old routes deleted → redirect:** `/campaigns`, `/campaigns/new`,
  `/campaigns/[id]/review` now only `redirect("/app")`; `sign-in-gate.tsx` removed.
  The public `/c/[slug]` and `/proof/[tx]` are untouched. `purge.test.ts` asserts
  the old poster pages only redirect (never re‑render the moved components).
- **Policies is founder‑vault‑honest:** the "approved recipients" card no longer
  leaks the demo vault's vendor names onto a founder's own vault — it shows the
  real count of recipients allowlisted through their campaigns (`overview
  .approvedRecipients`, distinct paid wallets), via a new `ownVault` prop.

### Pass 11 — the surface is finished (done)
Every Pass 10 deferral is closed; the class vocabulary is unified; the public
page reaches the app's bar. There is no deferrals list anymore — that's the
definition of done for this pass.

- **Wallet tab is the founder's real money surface.** Under the balance hero, a
  **Campaigns** section shows committed (reward × max) vs settled per campaign
  with a progress bar (from `overview.campaigns`). History for the founder's own
  vault is their **settled payouts** (DB, labelled `<campaign> — payout to 0x…`,
  each linking to `/proof/<tx>`); on the demo vault the on‑chain log is labelled
  by matching `SpendSettled.intentHash` to `submissionIntentHash` (`labels.ts`
  `buildIntentHashMap`). No new data — a join of two real sources. Fixed a latent
  bug: `since()` was called with `×1000` in two places, so timestamps always read
  "just now".
- **Policies wires the one real mutation.** `lowerPerTransactionCap` /
  `lowerDailyVelocityCap` (verified against the ABI) behind an owner‑signed flow
  (`lower-cap.ts` + `CapControl`): tap **Lower** → inline editor that only accepts
  a lower value (`validateLowerCap`, client + contract) → a weighty confirm ("This
  cannot be raised back. The ceiling and duration are immutable.") → owner signs
  (legacy Metis gas) → the card **re‑reads the cap from chain**. Read‑only lock on
  the demo vault (the viewer isn't its owner). Failure shows the chain's reason.
- **Trustless journal reconciliation** (`reconcile.ts`) closes the Pass 9 gap.
  After any settle, and cheaply on campaign‑detail load, the server reads a vault's
  `VendorAddQueued` / `VendorAdded` logs since its cursor and folds new ones into
  the journal — **idempotent by (txHash, logIndex)** via `events_chain_unq`.
  **Cursor design:** a dedicated `vault_cursors(vault_address PK, last_block)`
  table (migration `0002`); the scan is **range‑capped** at 50k blocks per call
  (`reconcileRange`, pure + tested), so a cold vault reconciles incrementally
  across calls instead of stalling a page load. The app no longer records
  `vendor_allowlisted` itself — that (and the new `vendor_queued`) come only from
  the chain. **Journal rule (final): entries derive ONLY from chain reads or
  server‑side actions — never client‑authored.**
- **One class vocabulary.** The in‑shell review queue, campaign create, campaign
  cards, submit panel, and cap editor were migrated off `.hire`/`.csub`/`.hinput`
  onto native `.sage-*` / `.sb-*` primitives (new in `app.css`: `.sage-field/-label
  /-input/-textarea/-btn/-toast/-badge/-gate/-sub(s)/-flow/-metachip/-crit` …).
  **`campaigns.css` is deleted** — nothing imported it after migration.
- **`/c/[slug]` re‑skinned to the app.** It renders in the app's design language
  (`.sb-shell` + `.sage-agent-card`) with a real **BudgetRing** reading the
  campaign's reward pool live (paid‑of‑max), a settled‑payout feed (each →
  `/proof/<tx>`), the same input/button system, and a "Be the first — payouts are
  real and on‑chain" empty state. It stays wallet‑optional and fast.

**Still needs a real wallet (can't drive one in dev):** the connect→sign→submit,
Approve‑&‑pay (allowlist → settle), and **Lower‑cap** signatures. Everything else —
routes, DB + migrations, reconciler cursor/idempotency, the unified render, the /c
re‑skin — is verified live (curl + runtime DB read + preview screenshots).

**Design honesty (fresh):** the campaign surfaces + `/c` now speak one vocabulary
and read as one hand. The only components still on `.hire` classes are the **Proof
tab's `hproof` rows and the `break-it` panel** — a pre‑existing, non‑campaign
surface that hire.css still styles (hire.css also carries the paper tokens). It's
coherent but is the last place a purist would unify next.

---

## 11. How to run

```bash
npm run dev            # http://localhost:3000  (landing → /app onboarding)
npm run typecheck && npm run lint && npm run test && npm run build   # gates
# contracts (needs Foundry on PATH: export PATH="$HOME/.foundry/bin:$PATH")
cd contracts && forge build        # required: out/ is gitignored, app imports ABIs
```

Gotchas: the app imports contract ABIs from `contracts/out/` → run `forge build`
first. Metis needs legacy gas (`--legacy` for forge, `gasPrice` in the signer).
The preview/dev browser has no injected wallet, so wallet flows are tested with
real MetaMask, not in‑harness.
