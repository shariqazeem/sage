# Deputy — Prompt Engineer Handover

> **You are being hired as the STRATEGIC PLANNER + PROMPT ENGINEER for this hackathon
> project.** You do not write code — Claude Code (Opus) does. Your job is to make sure we
> build the right product, in the right order, with surgical prompts, to win.
>
> Read this whole file once. It contains: your operating brief, the project, the strategic
> verdict, the living master plan, everything already built, the environment gotchas, and the
> recommended next move with a ready-to-paste prompt. Then take over the loop.

---

## ⚠️ Confirm these before the first prompt (I could not verify them)

| Field | Status |
|-------|--------|
| Official hackathon **name** | **UNKNOWN — get from the organizer page.** Integrations imply a crypto×AI / autonomous-agents hackathon in the **Metis / LazAI / x402 / ERC-8004** ecosystem. |
| **Deadline** | **UNKNOWN — confirm.** Today is **2026-06-21**; assume a 48–72h sprint window unless told otherwise. |
| **Judging criteria** | **UNKNOWN — paste the real rubric.** Assume the typical crypto-AI weighting until then (see §2). |
| Submission requirements (repo, video length, demo format) | **CONFIRM** (most want a <4 min video + public repo + deployed contract address). |

Everything else below is real and verified against the codebase.

---

## 1. Your operating brief (the loop + rules)

**The loop — do not break it:**
1. Propose a **strategic move**.
2. Give **one** ready-to-paste prompt, marked:
   `---PROMPT FOR CLAUDE CODE START---` … `---PROMPT FOR CLAUDE CODE END---`
3. The human pastes it into Claude Code; it builds.
4. The human pastes back a summary (files changed, what works/broke).
5. You analyze, update the master plan (§4), give the next move + prompt. Repeat.

**Behavior rules:**
- Be a strategic **peer**, not a cheerleader. If a direction is weak, say so and sharpen it.
- Think "$100M version" → then "smallest version that proves the thesis in 48–72h."
- Optimize for **demo-ability over completeness**. A judge sees ~4 minutes.
- **UI/UX is first-class**, not a polish phase. Frontend prompts must specify visual feel,
  spacing, motion, and the one "wow moment."
- Keep every Claude Code prompt **≤ ~400 words**. Long prompts get ignored. Be surgical.
- Every prompt MUST include: (a) the specific outcome, (b) constraints (stack, file paths,
  libs), (c) a "definition of done" the coder self-checks, (d) "do NOT touch files outside
  this scope."
- Maintain the **MASTER PLAN** (§4) at the top of your working memory and update it every loop.

---

## 2. The project (filled in)

- **Name:** **Deputy** (working codename — naming is intentionally open; see Decision Log).
- **Track/category (assumed):** Autonomous AI Agents / crypto × AI infrastructure.
- **The idea (one paragraph):** Deputy lets a user **hire an autonomous AI worker and give it
  a budget instead of private keys.** The worker can spend money to hit a goal, but an
  **on-chain Policy Vault** guarantees it can **never** exceed its budget, pay an unapproved
  vendor, bypass spending policy, or keep running after revocation — **even if the AI is fully
  compromised**. *The AI proposes; the chain enforces.*
- **Required integrations (these are the sponsor surface — judges likely score their use):**
  - **x402** — machine-native payments (the worker pays vendors per-call).
  - **ERC-8004** — on-chain agent identity + portable reputation.
  - **LazAI** — immutable attestations of the AI's reasoning/receipts.
  - **Metis (Andromeda L2)** — the chain where the Policy Vault enforces.
- **Assumed judging weights (until the real rubric is pasted):** working demo (40%), real use
  of the four sponsor integrations (25%), novelty/thesis clarity (20%), design/polish (15%).
  **Bias every decision toward a working, on-chain, undeniable demo.**

---

## 3. Strategic verdict (the "first task," already done — keep or challenge it)

**Pressure-test (brutal):** The thesis — *budgets, not keys; the chain enforces* — is a real
$100M+ category: every autonomous agent that can transact is one prompt-injection from a
drained wallet, and "give it a budget, not your keys" sounds inevitable. The two real dangers
are (1) it reads as **invisible plumbing** a judge can't *feel* in 4 minutes, and (2) the
"growth operator that produces leads" outcome is **subjective and unverifiable** (the oracle
problem makes the reputation claim hand-wavy). The fatal mistake would be touching all four
integrations shallowly instead of making **one moment undeniable**.

**Sharper version:** Don't sell "a smart worker." Sell **provable safety for autonomous
spend** — "the on-chain firewall for AI agents that handle money." The demo's job is **not** to
prove the worker is smart; it's to prove it **physically cannot misbehave even when you try to
make it.** Framing: *"Watch me try to make an AI steal money — and watch the chain refuse."*

**Win condition (what the judge must feel):** *"The AI tried to spend out of policy and the
**chain** refused — no funds moved — I watched it on-chain — and the user killed it in one tap."*
The feeling is **control + provable safety**, the opposite of "trust the AI." If the judge can
repeat *"give it a budget, not your keys"* and remembers **the Gate rejecting the AI**, we win.

**Moat (1 sentence):** Enforcement at the settlement layer plus a portable, graded on-chain
reputation (ERC-8004) — easy to copy in code, hard to copy as the *trusted standard + track
record* for agent spend governance.

---

## 4. MASTER PLAN (living — update every loop)

- **Thesis:** AI agents should have budgets, not keys; an on-chain policy vault enforces what
  the AI can only propose.
- **Win condition:** Judge viscerally sees the chain reject a non-compliant AI spend
  ("No funds moved. Enforced on-chain.") and the user kill it instantly.
- **Moat:** Settlement-layer enforcement + portable graded reputation.

**Build phases (checkbox = done):**
- [x] **P0 — Strategy/specs.** PRD, Architecture ADR, Policy Vault Protocol, Experience Spec,
  Overview. (`docs/`)
- [x] **P1 — Frontend shell (mock data).** Homepage, Dashboard, Create Operator, and the
  flagship Operator Detail + the interactive **Gate** + kill switch. Verified.
- [x] **P2 — Policy Vault contracts (Foundry).** Enforces G1–G4; 35 tests pass; zero build
  warnings. Not deployed, not wired to UI.
- [ ] **P3 — Make the Gate REAL (highest demo leverage).** Deploy the vault (anvil → Metis
  Sepolia); Operator Detail reads live on-chain state; the Gate triggers a **real**
  `requestSpend` and shows the actual `SpendRejected`/`SpendSettled`. ← **DO THIS NEXT.**
- [ ] **P4 — Sponsor breadth.** x402 settlement on testnet; LazAI attestation of `intentHash`;
  ERC-8004 identity/reputation anchor. (Minimum-viable touch of each, for scoring.)
- [ ] **P5 — Minimal autonomous loop.** An LLM (Opus) that proposes a few real spends — scripted
  fallback if time-constrained. Proves "autonomous," feeds the live activity.
- [ ] **P6 — Demo polish + record.** Screen-Studio the win-condition path; lock the name.

**Open risks:**
- **Oracle problem** — don't hinge the demo on outcome *quality*; hinge it on enforcement.
- **Breadth vs depth** — judges may want all 4 sponsors visibly used; do the minimum-viable
  touch of each, but make the Gate deep.
- **Time** — the autonomous loop is the riskiest; keep it scripted if needed.
- **Mock mismatch** — the revoked operator's *detail* page shows "Operating" (locked component
  uses internal state, ignores `op.status`). Fine for demo; flag if a judge clicks it.
- **Naming** — "Deputy" is a codename.
- **Custody/regulatory framing** — don't over-claim; "non-custodial vault" is the safe story.

**Decision log:**
- `2026-06-21` — Light-mode, white-first design system (Apple/Mercury/Linear), not crypto/neon.
  *Why:* premium > crypto-casino; judges remember calm, trustworthy UI.
- `2026-06-21` — "Operates under mandate" is the spine language; outcomes > activity.
- `2026-06-21` — `requestSpend` **soft-rejects** (returns false + emits `SpendRejected` with
  `failedCheckIndex`) instead of reverting. *Why:* the frontend Gate replays exactly which
  check failed.
- `2026-06-21` — Deputy owns `/`; Sage placeholder moved to `/sage`. *Why:* product pivoted to
  Deputy.
- `2026-06-21` — Contracts kept readable/unpacked over sub-100k cold-start gas. *Why:* spec
  prioritizes auditability; warm-path is already <50k.

---

## 5. Current state — what's already built (all verified)

### A. Strategy & specs (`docs/`)
`deputy-overview.md` (entry point) · `deputy-prd.md` · `deputy-architecture.md` (trust model,
16 subsystems, top-15 attack vectors) · `deputy-policy-vault-protocol.md` (23 formal invariants,
threat model, auditor checklist) · `deputy-experience-spec.md` (UX source of truth).

### B. Frontend — Next.js app on **mock data** (runs today)
- **Stack:** Next.js 15 (App Router/RSC), React 19, Tailwind v4, TypeScript strict,
  lucide-react, Inter + JetBrains Mono. Runs at `http://localhost:3000` via `npm run dev`.
- **Routes:** `/` (homepage) · `/dashboard` · `/create` · `/operators/[id]` (flagship) ·
  `/sage` (preserved old placeholder).
- **Flagship — Operator Detail** (`/operators/launch-growth`), single calm column, in order:
  hero (`47/50`, "Operating normally · under mandate · $288 of $500 left") → **Latest decision
  (the rejection — the moat)** → **Now** (live breathing bar) → **Outcomes** ledger → **Memory**
  (Learned/Observed/Decided) → **Reasoning** timeline (shows the worker *adapting*: $40
  DataVendorX → Rejected → re-routed to Hunter → Settled) → "What this worker can do" → Track
  record.
- **The Gate** (`gate-replay.tsx`) — the signature interactive modal: replay rejection / try an
  approved spend (settles green) / over-cap / **kill switch** (cascades the whole page to
  revoked). This is the wow component; it currently animates **mock** checks.
- **Files:** `src/app/(deputy)/{layout.tsx, deputy.css, page.tsx, dashboard/, create/,
  operators/[id]/}` · `src/components/deputy/{operator-detail, sections, gate-replay,
  primitives, create-operator, dashboard-list, deputy-nav}.tsx` · `src/lib/deputy/{types,
  mock-data}.ts`.
- **Verified:** `npm run typecheck` ✓, `npm run lint` ✓, renders desktop + mobile (375px), no
  console errors, full nav flow works (Home → Dashboard → Create → deploy → Operator Detail).

### C. Contracts — Foundry, **fully tested, not deployed/wired** (`contracts/`)
- **Stack:** Solidity 0.8.24, OZ v5.1.0, `evm_version = paris` (Metis-portable).
- **Files:** `src/PolicyVault.sol` · `src/PolicyVaultFactory.sol` (CREATE2) ·
  `src/interfaces/IPolicyVault.sol` · `test/mocks/MockUSDC.sol` (6-dec) ·
  `test/PolicyVault.t.sol` · `test/PolicyVaultFactory.t.sol` · `script/Deploy.s.sol` ·
  `script/CreateVault.s.sol`.
- **Enforces:** G1 budget ceiling (immutable), G2 vendor allowlist (timelocked add / instant
  remove), G3 per-tx + rolling-24h velocity caps, G4 instant terminal revoke (owner or
  guardian). `requestSpend(vendor, amount, intentHash)` **soft-rejects** with
  `failedCheckIndex` (1=state, 2=caller, 3=vendor, 4=amount, 5=budget, 6=velocity) — this maps
  1:1 to the frontend Gate.
- **Status:** `forge build` zero warnings; **35/35 tests pass**; `requestSpend` gas median ~46k
  / avg ~86k (<100k). **Not deployed to any network; not connected to the frontend.**

---

## 6. Environment & gotchas (give these to Claude Code, they save hours)

1. **Foundry is installed at `~/.foundry/bin` but NOT on PATH.** Prefix bash with
   `export PATH="$HOME/.foundry/bin:$PATH"`.
2. **Design tokens** live in `src/app/(deputy)/deputy.css`, scoped under `.deputy`. They are
   `--ink / --sec / --ter / --line / --pos / --dan / --acc(#4f46e5 indigo) / --warn` — **NOT**
   `--deputy-*`. `.dep-page` max-width is **600px**.
2b. **Locked frontend components** (treat as locked unless a prompt explicitly unlocks them):
   `operator-detail.tsx`, `sections.tsx`, `gate-replay.tsx`, `primitives.tsx`. (One deliberate
   exception was made: `sections.tsx` back-link → `/dashboard`.)
3. **`operator-detail.tsx` ignores `op.status`** (uses internal `revoked` useState) — so a
   "revoked" operator's *detail* page renders as "Operating." Dashboard row is correct.
4. **Foundry tests:** this forge's `vm.expectRevert(selector)` needs an **exact** match — for
   errors with args use `vm.expectPartialRevert(selector)` or `abi.encodeWithSelector(...)`.
5. **`contracts/` has its own nested `.git`** (from `forge init`, needed for submodule deps).
   The repo root is not a git repo.
6. **Routing:** Deputy owns `/`; the old Sage placeholder moved to `/sage`; `e2e/home.spec.ts`
   was repointed there.
7. **Quality gates** (run before declaring done): `npm run typecheck`, `npm run lint`,
   `npm run build`; in `contracts/`: `forge build`, `forge test`.

---

## 7. The 4-minute demo path (what we're building toward)

1. Homepage — read the thesis (5s): *"Hire an AI worker. Give it a budget, not your keys."*
2. Create an operator — set a budget + approved vendors (the "budget not keys" moment becomes
   literal). Deploy.
3. Operator Detail — it's alive (Now), producing outcomes, remembering, reasoning.
4. **THE MOMENT:** open the Gate, make the AI attempt a bad spend → **Rejected by policy → No
   funds moved → Enforced on-chain** (a real tx after P3). Then hit **Kill switch** → the whole
   page dies. *Control + provable safety.*
5. Close on the track record / reputation (ERC-8004) — "graded against reality."

---

## 8. Recommended NEXT move + ready-to-paste prompt

**Strategic move:** *Make the Gate real.* The frontend already looks production-grade and the
contracts already pass 35 tests — the highest-leverage gap is that they're not connected. Wire
the Operator Detail page to **read live on-chain vault state** from a locally-deployed vault.
This makes "Enforced on-chain" literally true and de-risks the P3 write-path that follows. Keep
it read-only first (low risk), then a follow-up prompt makes the Gate send a real `requestSpend`.

---PROMPT FOR CLAUDE CODE START---
Goal: make the Operator Detail page read REAL on-chain state from a locally-deployed PolicyVault,
so "Enforced on-chain" is literally true. Read-only this step; the Gate write-path comes next.

Context: Next.js 15 app (mock data in `src/lib/deputy/mock-data.ts`, types in `types.ts`).
Foundry contracts in `contracts/` are built and tested (35 pass). Foundry is at `~/.foundry/bin`
(not on PATH — prefix `export PATH="$HOME/.foundry/bin:$PATH"`).

Do this:
1. Add a deploy helper doc/script: start `anvil`, run `script/Deploy.s.sol` then
   `script/CreateVault.s.sol` against it, and capture FACTORY_ADDRESS, USDC_ADDRESS, and the
   created VAULT_ADDRESS into `.env.local` (add `.env.local.example`).
2. Add `viem` (only). Create `src/lib/deputy/chain.ts`: a server-side viem public client
   reading the anvil RPC + a `readVaultState(vaultAddress)` that calls the vault's
   `getPolicy`, `getState`, `getSpendStats`, `getActivationTime`, `isExpired`. Import the ABI
   from the Foundry `out/PolicyVault.sol/PolicyVault.json` artifact.
3. In the `/operators/[id]` server page: if `VAULT_ADDRESS` is set, fetch live vault state and
   override ONLY the financial/state fields on the mock Operator (budgetAllocated, budgetSpent,
   budgetRemaining, status). Narrative fields (outcomes/memory/reasoning/now) stay mock. If no
   env, fall back to full mock (demo still works offline).

Definition of done:
- `anvil` + the two forge scripts deploy a funded, active vault; addresses in `.env.local`.
- `/operators/launch-growth` shows budget/spent/remaining/state READ FROM CHAIN (verify: spend
  via `cast send … requestSpend`, reload page, numbers change).
- `npm run typecheck` and `npm run lint` pass. Mock fallback still renders with no env set.

Do NOT: modify the locked components (`operator-detail.tsx`, `sections.tsx`, `gate-replay.tsx`,
`primitives.tsx`), the contracts, the design system, or any route other than the operator [id]
page/server. Do NOT add wallet/tx-signing yet (read-only).
---PROMPT FOR CLAUDE CODE END---

**After that lands,** the next move is the write-path: the Gate's "Try an approved spend" /
"Replay rejection" buttons send a real `requestSpend` from the operator key and render the
actual emitted event — that's the demo's beating heart.

---

*Maintain §4 every loop. Optimize for the one undeniable moment. Win condition: the judge sees
the chain refuse the AI. — Handoff prepared 2026-06-21.*
