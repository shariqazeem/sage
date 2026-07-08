# Deputy — What We're Building & What's Built

> **Codename:** Deputy · **Category:** Autonomous Economic Workers
> **Status:** Design-complete (4 specs) + a real, running frontend prototype on mock data.
> **One line:** *Hire an AI worker. Give it a budget, not your keys.*
>
> This is the entry-point document. **Part I** is the idea in full. **Part II** is exactly what
> we've built so far. **Part III** is what's deliberately not built yet. The four deep specs and
> the running app are all linked below.

---

# Part I — The Idea (in full)

## 1. The thesis

**AI agents should not have private keys. They should have budgets.**

Autonomous AI agents are now capable enough to *do real work* — research, lead-gen, outreach,
distribution. But to act in the real economy they need to spend money, and today that forces a
bad choice:

- **Give the agent a funded wallet** → a probabilistic, jailbreakable system now has custody of
  capital. One hallucination, prompt-injection, or runaway loop is a financial incident. No hard
  ceiling, no vendor control, no off-switch the agent can't route around.
- **Put a human in the loop on every payment** → the agent isn't autonomous anymore; it's an
  expensive form-filler, and the leverage evaporates.

Deputy collapses that false choice. The agent gets **full autonomy inside a box whose walls it
physically cannot push through.** The user gets leverage *and* control.

## 2. The one-liner and the category

> **Hire an AI worker. Give it a budget, not your keys.**

The category is **Autonomous Economic Workers** — not chatbots, not assistants, not analysts.
**Workers.** A worker is hired, funded, and held responsible for **outcomes**. You don't chat
with it; you give it a goal and a budget, and it produces results you can verify.

## 3. The mechanism — "the AI proposes, the chain enforces"

The core architectural move is the **separation of capability from custody**:

- The **AI** has unlimited capability to *propose* and **zero authority** to move money.
- A **policy layer** holds all spending authority.
- The **chain** enforces the policy where it can't be argued with.

The loop:

```
AI proposes a spend  →  Policy evaluates it  →  Chain enforces  →  Settles (or rejects)  →  Proves
```

The AI can be wrong, jailbroken, or buggy — the walls hold anyway.

## 4. The critical constraint (this is the whole point)

Everything is designed around one adversarial assumption:

> **The model is compromised. The LLM is jailbroken. The operator is malicious. The user prompt
> is adversarial. The guarantees must still hold.**

The security boundary is **never** the AI. It's the on-chain policy enforcement. If a safety
property is only enforced in the model, it's not a guarantee — it's a hope.

## 5. The guarantees

| ID | Guarantee | Enforced by |
|----|-----------|-------------|
| G1 | The worker can never exceed its budget | On-chain ceiling |
| G2 | The worker can never pay an unapproved vendor | On-chain allowlist |
| G3 | The worker can never bypass spending policy | On-chain caps / velocity / state |
| G4 | The user can revoke authority instantly | On-chain kill flag (+ off-chain freeze) |
| G5 | Reputation survives operator upgrades | Stable on-chain identity, decoupled from the model |
| G6 | Every meaningful action is auditable forever | Immutable attestations + on-chain events |

These hold **even if the model is fully compromised.** That property is the entire product.

## 6. V1 scope — exactly one worker: the **Growth Operator**

V1 is intentionally narrow. **One** worker, done to production quality. No marketplace, no second
worker, no future-feature scaffolding.

- **The worker:** Growth Operator.
- **Its goal:** acquire qualified leads and growth opportunities for a project.
- **What it spends on:** data/enrichment/research vendors (per-call, machine-native payments).
- **What it produces:** **outcomes** — qualified leads, verified contacts, opportunities — each
  with a cost, a proof, and a verification state.
- **Initial user:** crypto founders launching a protocol / token / app who need distribution and
  measurable pipeline without hiring a growth team or handing an AI their wallet.

## 7. The user journey

1. User lands, creates an operator.
2. Enters project, objective, budget, and spending policy (approved vendors, caps).
3. Funds the operator — the budget becomes a hard, enforced ceiling; the operator gets an
   identity.
4. The operator begins work autonomously.
5. It proposes spends → policy approves/rejects → it produces outcomes.
6. The user watches it work, audits every dollar and decision, and can **revoke instantly.**

## 8. Required integrations

| Integration | Role |
|-------------|------|
| **x402** | Machine-native payments — the worker pays vendors per-call over the x402 HTTP payment protocol. |
| **ERC-8004** | On-chain identity & portable reputation — the track record survives model/runtime upgrades. |
| **LazAI** | Immutable attestations — the reasoning and receipts behind each action are verifiable, not opaque. |
| **Metis (EVM)** | The default chain where the Policy Vault enforces the four guarantees. |

## 9. Why it's differentiated

Most AI products feel like **`chat + sidebar`.** Most SaaS feels like **`dashboard + metrics`.**
Deputy is a third thing:

> **`mission + worker + law`** — a category that doesn't really exist yet.

The category-defining moment is **the Gate**: watching the AI *try* to spend and get **rejected
by a law it cannot override** — `No funds moved. Enforced on-chain.` Nobody else can show this,
because nobody else enforces at that layer. That's the screenshot people share.

And the product revolves around **outcomes**, not actions/spend/AI-activity. Users buy outcomes.

## 10. Design philosophy & product language

- **Premium, minimal, light-mode, white-first.** References: Apple, Mercury, Linear, Stripe,
  Ramp, Arc. Never crypto-casino, neon, gradients, or admin-dashboard energy.
- **"Operates under mandate"** is the spine phrase — it implies authority, limits, accountability,
  and law all at once. Not "AI agent."
- **Observing a worker, not configuring software.** The page should make you feel the worker is
  alive, remembering, reasoning, and producing — not executing a script.
- **Outcomes over activity. Proof over persuasion. Honest silence over fake progress.** We never
  ask the user to "trust the AI"; we show the walls, prove the work, and grade the outcomes.

---

# Part II — What We've Built

Two things exist today: **four deep specifications** (the thinking) and **a real, running
Operator Detail page** (the product), built on mock data.

## A. The four specifications (`docs/`)

| Document | What it locks down |
|----------|--------------------|
| [PRD](deputy-prd.md) | Product vision, principles, personas, information architecture, core entities, user flows, dashboard + operator-detail specs, reputation, proof, design system, roadmap. |
| [Architecture ADR](deputy-architecture.md) | The full system: 4 trust planes, 16 subsystems (responsibility/inputs/outputs/trust/failure), 14 numbered architecture decisions, the operator lifecycle, the **trust model** (what survives if OpenAI/the backend/the DB/the frontend is compromised), the event graph, data ownership, scalability (10→10k), and the top-15 attack vectors. |
| [Policy Vault Protocol](deputy-policy-vault-protocol.md) | The crown-jewel on-chain component: roles (owner / guardian / operator key), the state machine, the policy structure, the spend flow, the **vendor allowlist** (the #1 attack surface) with timelocked owner-gated changes, revocation + worst-case-loss bound, **23 formal invariants**, a 16-item threat model, and an auditor's checklist. |
| [Experience Spec](deputy-experience-spec.md) | The UX source of truth: the three conceptual devices (the Mandate / the Gate / the Record), the product narrative (5s/30s/5min), the homepage, navigation, the dashboard, the flagship operator-detail layout, the signature "Gate" moment, the activity/narrative system, proof-as-trust, reputation-as-trust, empty states, and the full design system (color, type, spacing, components, motion). |

Together these are "more product thinking than most finalists will have" — but the next risk was
over-specification, so we shifted to building.

## B. The flagship — a **real, running Operator Detail page**

Not a mockup — an actual Next.js route you can open, click, and demo.

- **URL:** `/operators/launch-growth`
- **Stack:** Next.js 15 (App Router, RSC) · React 19 · Tailwind v4 · TypeScript (strict) ·
  lucide-react icons · Inter + JetBrains Mono.
- **Where it lives:**
  - `src/app/(deputy)/` — route group, scoped layout, and `deputy.css` (the design system).
  - `src/components/deputy/` — `operator-detail.tsx` (client root), `sections.tsx` (all sections),
    `gate-replay.tsx` (the interactive Gate), `primitives.tsx` (CountUp, ThinMeter).
  - `src/lib/deputy/` — `types.ts` (domain types) and `mock-data.ts` (the demo operator).
- **Self-contained light theme:** Deputy is a light-mode, white-first surface scoped under
  `.deputy`, so it lives cleanly inside the host repo's dark global theme without collision.

### The page, top to bottom (the final structure)

A single calm column — one story, no dashboard, no cards fighting:

1. **Top bar** — quiet `‹ Operators` and `Stop operator` controls.
2. **Hero** — `Launch Growth · Helios Protocol`, a huge `47 / 50`, "qualified founders found", a
   whisper-thin progress line, and the status line **`● Operating normally · under mandate ·
   $288 of $500 left`** (money kept present).
3. **Latest decision** (elevated, the moat) — an Apple-Wallet-style card: `$40.00 → DataVendorX`,
   a red **Rejected** pill, "Vendor not on the approved list," and **No funds moved. · Enforced
   on-chain.** Tappable → opens the full Gate replay.
4. **Now** (alive — "where is the worker") — `● Now`, "Verifying emails via Hunter," a **breathing
   progress bar**, `26 of 31 verified · ~11 min left`, and `Next · Draft outreach sequence`.
5. **Outcomes** (the first-class object) — a ledger: `47 produced · 31 verified · $4.51 average`,
   then each outcome with `#id`, kind, label, cost, a **Verified/Verifying** pill, and **Proof**.
6. **Memory** (it remembers) — cumulative learnings, not logs: `Learned · Founders in the Base
   ecosystem reply 2.3× more often`, `Observed · …`, `Decided · …`.
7. **Reasoning** (it reasons, and adapts) — a timeline of *major decisions only*, with colored
   nodes: `Requested $40 from DataVendorX` → **Rejected by policy** → `Re-routed to Hunter` →
   **Settled**. The worker visibly hitting a wall and routing around it.
8. **What this worker can do** (the mandate, in human language) — `Budget up to $500 · Approved
   vendors 6 · Spending limit $25 per payment · Runs for 5 more days`, with "these limits are
   enforced on-chain — the worker cannot exceed them."
9. **Track record** (footer) — `31 of 38 outcomes verified against reality · grade A`.

### The Gate (the signature interaction)

A focused modal that animates **real policy enforcement** — each check resolves in sequence (no
fake "thinking"):

- **Replay rejection** → stops at the failing vendor check → **`Rejected by policy · No funds
  moved · Enforced on-chain`.**
- **Try an approved spend** → all five checks pass → settles green: `$4.20 paid to Clearbit ·
  attested.`
- **Over the $25 cap** → stops at the per-transaction check.
- **Kill switch** → cascades the **whole page** to a revoked state (status → Stopped, Now → "no
  task running," the mandate dims and disables). One tap, and an autonomous economic agent is
  visibly powerless.

### The three depth concepts (the most recent leap)

The page was deliberately upgraded from "task execution" to a worker that **remembers, reasons,
and produces outcomes** — by adding **Outcomes**, **Memory**, and **Reasoning** as first-class
concepts (and deleting the low-value "recent activity," because users care about outcomes, not
actions).

## C. The design journey (how the taste was tuned)

The page went through four deliberate iterations, each in response to a sharp critique:

| Version | What it was | Why it changed |
|---------|-------------|----------------|
| v1 | Full dashboard — sidebar, KPI grid, bordered cards, spend table | "Too much machinery. Clean, but still SaaS." |
| v2 | Extreme minimalism — big hero, lots of whitespace, almost no chrome | "Beautiful, but feels like a landing page, not a product that controls real money." |
| v3 (sweet spot) | Show the worker (live "Now"), elevate the rejection (the moat), keep money present | The right middle — calm but substantial. |
| Depth layer | + Outcomes, Memory, Reasoning | "A prettier UI won't win — a worker that appears to remember, learn, reason, and improve will." |

## D. What's real vs mock vs spec (honest status)

| Layer | Status |
|-------|--------|
| Product/architecture/protocol/UX thinking | **Done** — 4 complete specifications. |
| Operator Detail frontend (the flagship page) | **Built & running**, fully interactive (Gate, kill cascade, animations). |
| Data | **Mock** — one demo operator in `mock-data.ts`. |
| x402 / ERC-8004 / LazAI / Metis Policy Vault | **Specified, not implemented** — no live contracts, payments, or chain calls yet. |
| Other screens (Home, Dashboard, Create Operator) | **Not built** (deliberately — perfect one page first). |

## E. Verification status

- `npm run typecheck` ✓ (strict) · `npm run lint` ✓ · no runtime console errors.
- Renders correctly on **desktop and mobile** (rail-less single column; mandate stays visible).
- Gate verified on both the rejection and settle paths; kill-switch cascade verified.

---

# Part III — What's Next (deliberately not built yet)

1. **Record the demo.** The flow `Operator Detail → spend request → policy rejection → "No funds
   moved" → kill switch` is already a stronger demo than most submissions.
2. **Connect the depth concepts** — e.g., a Memory entry links to the Outcome that taught it, so
   learning is provably *earned*, not asserted.
3. **The other screens** — Create Operator (where "give it a budget, not your keys" first becomes
   literal), Dashboard, Homepage. Held until this page is exceptional.
4. **Wire the real layers** — x402 settlement, the Metis Policy Vault contracts (per the
   protocol spec), ERC-8004 identity/reputation, LazAI attestations. Today these are mock.
5. **Name the product.** "Deputy" is a codename. The name should feel as inevitable as *"give it
   a budget, not your keys."* Running candidates: **Allowance**, **Mandate**, Stipend, Warrant,
   Writ, Tender. Not rushing it.

---

## Appendix — file map

```
docs/
  deputy-overview.md              ← this file (the entry point)
  deputy-prd.md                   ← product requirements
  deputy-architecture.md          ← system architecture + ADR
  deputy-policy-vault-protocol.md ← the on-chain enforcement protocol
  deputy-experience-spec.md       ← UX / UI source of truth

src/
  app/(deputy)/
    layout.tsx                    ← light-mode scoped wrapper
    deputy.css                    ← the Deputy design system (tokens + components)
    operators/[id]/page.tsx       ← the route (/operators/launch-growth)
  components/deputy/
    operator-detail.tsx           ← client root (composes the page, holds kill state)
    sections.tsx                  ← hero, latest decision, now, outcomes, memory, reasoning, …
    gate-replay.tsx               ← the interactive Gate modal
    primitives.tsx                ← CountUp, ThinMeter
  lib/deputy/
    types.ts                      ← Operator, Outcome, MemoryEntry, ReasoningEntry, …
    mock-data.ts                  ← the demo operator (Launch Growth)
```

---

*In one sentence: Deputy lets a founder hire an autonomous AI worker, give it a budget instead of
their keys, and watch it remember, reason, and produce verifiable outcomes — while an on-chain
mandate guarantees it can never exceed its budget, pay an unapproved vendor, bypass policy, or
keep running after revocation, even if the AI is fully compromised.*
