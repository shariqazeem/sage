# Deputy — Product Requirements Document

> **Codename:** Deputy · **Category:** Autonomous Economic Workers
> **Status:** Draft v1.0 (foundational PRD) · **Owner:** Founding Engineering & Product
> **Audience:** Senior engineers, designers, and founding team. This document is the
> single source of truth for *what* Deputy V1 is and *why*. It deliberately stops at
> the product/behavior altitude — it specifies entities, flows, screens, guarantees,
> and the design system, but not implementation. When a downstream decision contradicts
> this document, update the document deliberately.

---

## How to read this document

- **Sections 1–13** are the requested PRD deliverable, in order.
- **Appendices A–E** add the rigor a senior team needs to build without re-deriving
  intent: the enforcement model, a metrics dictionary, risks/open questions, a glossary,
  and explicit V1 scope guardrails.
- **MUST / SHOULD / MUST NOT** are used in the RFC sense and denote hard requirements.
- Anything labeled **Non-goal** or **Deferred** is intentionally excluded from V1.

---

## 0. TL;DR

Deputy lets a user **hire an autonomous AI worker, give it a budget instead of a private
key, and hold it accountable for outcomes.** The worker — an **Operator** — receives a
goal and a fixed budget. It may spend money autonomously to achieve the goal, but it can
**never** exceed its budget, pay an unapproved vendor, bypass spending policy, or keep
operating after revocation. Those four guarantees are **enforced on-chain**, not by the
model's good behavior. **The AI proposes; the chain enforces.**

V1 ships exactly **one** worker — the **Growth Operator** — whose job is to acquire
qualified leads and growth opportunities for a project. V1 is a complete, production-grade
product for that single worker: create it, fund it, watch it work, audit every dollar and
decision, and kill it instantly. No marketplace. No second worker. No future features.

---

## 1. Product Vision

### 1.1 The problem

Autonomous AI agents are becoming capable enough to *do work* — research, outreach, lead
generation, distribution. But to act in the real economy, an agent needs to spend money,
and today that means one of two bad options:

1. **Give the agent a key / a funded wallet.** Now a probabilistic system holds custody of
   capital. A hallucination, a prompt injection, or a runaway loop is a financial incident.
   There is no hard ceiling, no vendor control, no instant off-switch that the agent itself
   can't route around.
2. **Put a human in the loop on every payment.** Now the agent isn't autonomous — it's a
   very expensive form-filler, and the promised leverage evaporates.

Both options force a false choice between **autonomy** and **control**.

### 1.2 The insight

> **AI agents should not have private keys. They should have budgets.**

Custody and capability should be separated. The agent's job is to *decide and propose*. The
authority to *move money* lives in a programmable spending mandate that the agent cannot
override. The mandate is enforced where it can't be argued with: on-chain.

This collapses the false choice. The agent is fully autonomous **inside a box whose walls
it physically cannot push through.** The user gets leverage *and* control.

### 1.3 The product

Deputy is a platform for **Autonomous Economic Workers**. A user hires a worker, assigns it
a goal and a budget, and the worker produces measurable outcomes by autonomously spending
its budget under an enforced policy. Every action is logged, every dollar is receipted, and
every important decision is provable to a third party.

Deputy is **not** a chatbot, an assistant, or an analyst. It is a place where you **hire
workers that are responsible for outcomes** — and are held accountable for them through a
portable, on-chain reputation.

### 1.4 The mechanism (why this is real and not a demo)

Four product invariants define Deputy. They are the spine of the product; everything else
serves them. (Full enforcement model in **Appendix A**.)

| # | Invariant | What it means in practice |
|---|-----------|---------------------------|
| 1 | **Cannot exceed budget** | The budget is a hard, on-chain ceiling. The sum of all settled spend can never exceed the allocated amount. There is no "just this once." |
| 2 | **Cannot pay unapproved vendors** | Funds can only flow to vendors on an explicit allowlist. A payment to an unknown recipient is rejected at settlement, not flagged after the fact. |
| 3 | **Cannot bypass spending policy** | Per-transaction caps, rate/velocity limits, category rules, and approval thresholds are enforced at settlement. The agent cannot route around them. |
| 4 | **Cannot operate after revocation** | Revocation is instant and terminal. Once revoked, no further spend can settle — even if the agent is mid-task and still "trying." |

The model can be wrong, jailbroken, or buggy. The walls hold anyway. That property — **the
chain enforces what the AI merely proposes** — is the entire product.

### 1.5 What success looks like

A crypto founder hires a Growth Operator on a Friday with a \$500 budget, goes to sleep, and
wakes up to **47 qualified leads, a complete ledger of where every dollar went, a provable
record of why each decision was made, and the confidence that the worker could not have done
anything outside the mandate.** They never touched a key. They could have killed it from
their phone in one tap. And the worker's track record — good or bad — follows it forward.

### 1.6 Required integrations (V1)

| Integration | Role in Deputy | Product requirement |
|-------------|----------------|---------------------|
| **x402** | Payment / metering rail | All Operator spending settles over the x402 HTTP payment protocol. Spending is metered, per-action, and machine-native. |
| **ERC-8004** | Identity & reputation | Each Operator has an on-chain identity. Its verifiable track record (jobs, success rate, efficiency, ROI) is anchored to ERC-8004 so reputation is portable and not self-asserted. |
| **LazAI** | Immutable receipts & reasoning | The reasoning behind each action and the receipt for each spend are attested through LazAI, producing an auditable proof trail rather than opaque logs. |

These are requirements, not suggestions. Integrations are consumed behind interfaces so the
product is testable in isolation, and production paths **MUST NOT** silently fall back to
mocks.

---

## 2. Product Principles

These principles are tie-breakers. When two designs are otherwise reasonable, the one that
better honors these wins.

1. **Budgets, not keys.** We never ask the user to hand custody to a model. Capital
   authority always lives in an enforced mandate the agent cannot override. Any feature that
   requires giving the agent unconstrained spend authority is rejected on sight.

2. **The AI proposes; the chain enforces.** Soft guardrails (prompts, model rules) are
   advisory and assumed fallible. Every hard guarantee is enforced at the settlement layer.
   If a safety property is only enforced in the model, it isn't a guarantee — it's a hope.

3. **Outcomes over activity.** A worker is judged on results, not motion. We surface
   qualified leads and ROI, never "messages sent" as a headline metric. Vanity metrics are a
   product smell.

4. **Proof is a trust surface, not a developer feature.** Every important action must *feel*
   auditable to a non-technical founder. Proof is presented as confidence, not as a JSON
   dump behind a "Developers" link.

5. **Authentic activity only.** Every event in an Operator's activity stream corresponds to a
   *real action it actually took*. We never fabricate progress, fake "thinking…" states,
   simulate delays, or pad the feed for drama. If nothing is happening, the feed says so. A
   manufactured feed is worse than an empty one because it sells false confidence.

6. **Instant, irreversible control.** The user is always one tap from stopping a worker, and
   that stop is real and immediate. Control is never buried, throttled, or "processing."

7. **Narrow and deep.** V1 does one worker exceptionally well. We resist breadth. Every hour
   spent on a second worker, a marketplace, or a settings toggle is an hour not spent making
   the Growth Operator trustworthy.

8. **Premium restraint.** The interface communicates seriousness through clarity, density,
   and typography — not ornament. This is enterprise infrastructure for people moving real
   money. It should feel like Stripe, Linear, and Ramp, never like a crypto casino.

9. **Accountability is the moat.** A verdict or outcome that can't be checked later doesn't
   count. Reputation is earned by being graded against reality, and it is portable. That
   accountability — not the model — is the durable advantage.

---

## 3. User Personas

V1's initial market is **crypto founders** and the small teams around them. Three personas
cover the V1 buying and usage surface. (A fourth, the external auditor, is a *consumer* of
proof, not a logged-in user, but the product is designed for their gaze.)

### Persona 1 — Maya, the Founder (primary buyer & user)

| | |
|---|---|
| **Role** | Solo or co-founder of an early-stage crypto project (protocol, AI agent, consumer app, or token). |
| **Context** | Pre- or just-post-launch. Wearing every hat. Cash- and time-constrained. Technical enough to read a contract, too busy to babysit tools. |
| **Goal** | Distribution and qualified pipeline *now*, without hiring a growth team or learning ten tools. |
| **Pains** | Growth is a second job she doesn't have time for; agencies are slow and opaque; she doesn't trust an AI with her wallet; she's been burned by tools that promise leads and deliver scraped junk. |
| **Success** | "I funded a worker, it found me real leads while I shipped, and I can prove to my co-founder exactly where the money went." |
| **What she needs from Deputy** | One-screen comprehension, hard spend safety, real outcomes, instant kill switch. |
| **Quote** | *"I'll give an AI a budget. I will never give it my keys."* |

### Persona 2 — Devin, the Growth Lead (operator/operator-runner)

| | |
|---|---|
| **Role** | First growth/marketing hire or fractional growth operator at a crypto startup. |
| **Context** | Runs day-to-day acquisition. Manages spend across tools. Reports ROI upward. Lives in dashboards. |
| **Goal** | Maximize qualified pipeline per dollar; show his work; scale what works. |
| **Pains** | Manual prospecting eats his week; he can't easily attribute spend to outcomes; leadership asks "what did we get for that?" and he doesn't have a clean answer. |
| **Success** | "I can tune the operator's policy, watch it work in real time, and hand my founder a clean cost-per-qualified-lead number." |
| **What he needs from Deputy** | Live activity, policy controls (vendors, caps), a credible ROI/efficiency view, exportable proof. |
| **Quote** | *"Show me cost per qualified lead, or it didn't happen."* |

### Persona 3 — Priya, the Co-founder / Finance & Ops (the control buyer)

| | |
|---|---|
| **Role** | Co-founder who owns the treasury, or an ops/finance lead at a slightly larger startup. |
| **Context** | Accountable for capital. Signs off on spend. Allergic to unaccountable, un-capped tools. |
| **Goal** | Bounded, auditable spend with zero custody risk and a clean trail for the board. |
| **Pains** | "Autonomous" usually means "unbounded liability"; she needs hard ceilings, vendor control, and an audit trail she can defend. |
| **Success** | "Every dollar is capped, allow-listed, and receipted. I can revoke instantly. I can hand the proof trail to anyone." |
| **What she needs from Deputy** | Enforced budget ceiling, vendor allowlist, the proof/audit surface, role-appropriate kill switch. |
| **Quote** | *"Autonomy is fine. Unbounded autonomy is a liability. Show me the ceiling."* |

### Persona 4 — Sam, the External Auditor (proof consumer, not a user)

A skeptical outsider — a prospective customer of Maya's, an investor doing diligence, a
journalist, or a rival. Never logs in. Receives a shared proof link or visits the public
reputation page. **The product is designed so that Sam, with no account and no trust in
Deputy, can independently verify that an Operator's claimed outcomes and spend are real.**
If Sam can't verify it, the proof system has failed.

---

## 4. Information Architecture

Deputy is two products under one brand: a **public trust surface** (marketing + reputation +
proof + docs) and an **authenticated application** (where work happens).

### 4.1 Sitemap

```
Deputy
│
├── Public (unauthenticated, indexable)
│   ├── Home                     Vision, the "budgets not keys" thesis, primary CTA
│   ├── Documentation            How Deputy works; the enforcement model; integrations
│   ├── Reputation               Public, falsifiable track record of Operators / the platform
│   │   └── Reputation Detail     Per-Operator public profile (identity, history, grades)
│   ├── Demo                      Guided, read-only walkthrough of a real (or sandbox) Operator
│   └── Shared Proof              Public, link-shareable proof record (no account required)
│
└── Application (authenticated)
    ├── Dashboard                Portfolio overview — the 5 answers (see §8)
    ├── Operators                List of the user's Operators + "Create Operator"
    │   ├── Create Operator       Funding & configuration flow (project, objective, budget, policy)
    │   └── Operator Detail       THE core screen (see §9): mission, budget, actions,
    │                             spend, proof, reputation, kill switch
    ├── Activity                 Cross-operator unified stream of work + spend events
    ├── Proof                    Cross-operator proof ledger; verify & share any record
    └── Settings                 Account, funding source, vendor allowlist library,
                                 policy defaults, team & roles, notifications
```

### 4.2 Content domains

| Domain | Owns | Primary screens |
|--------|------|-----------------|
| **Trust** | The case that Deputy's guarantees are real | Home, Documentation, Reputation, Demo, Shared Proof |
| **Command** | Creating, funding, steering, and killing workers | Dashboard, Operators, Create Operator, Operator Detail, Settings |
| **Evidence** | The auditable record of work and money | Activity, Proof, Spend History, Proof Trail |
| **Accountability** | The earned, portable track record | Reputation, Reputation Detail, Operator → Reputation panel |

### 4.3 Cross-cutting surfaces

- **Kill switch** is reachable from the Operator card (Dashboard/Operators) and prominently on
  Operator Detail. Control is never more than two taps away from anywhere a worker is visible.
- **Proof** is linkable from every spend event and every work event — proof is *attached to
  the thing it proves*, not siloed.
- **Status** (Operator state) is shown consistently everywhere an Operator appears.

---

## 5. Navigation Structure

### 5.1 Public navigation

- **Top bar:** wordmark (→ Home) · `Product`/`How it works` · `Reputation` · `Docs` ·
  `Demo` · primary CTA **Hire an Operator** (→ app / sign-in).
- Minimal, single row, sticky, light. One primary CTA; no secondary clutter.

### 5.2 Application navigation

- **Persistent left sidebar** (collapsible to icons):
  `Dashboard` · `Operators` · `Activity` · `Proof` · `Settings`.
- **Sidebar footer:** account switcher / org, environment indicator, help.
- **Top bar (in-app):** breadcrumb / page title on the left; global actions on the right
  (search, notifications, **+ Create Operator**, account menu).
- **Operator Detail** opens within the `Operators` section and uses an in-page section nav
  (sticky sub-nav or anchored scroll) for Mission · Budget · Actions · Spend · Proof ·
  Reputation, with the kill switch persistently pinned.

### 5.3 Navigation principles

- **Depth ≤ 3.** Dashboard → Operators → Operator Detail is the deepest core path.
- **One primary action per screen.** Create Operator on the list; Kill/Pause on detail.
- **State persistence.** Returning to an Operator restores the last-viewed section and live
  stream position.
- **Real-time without disruption.** Live updates animate in place; the user's scroll, focus,
  and selection are never hijacked by incoming events.

---

## 6. Core Entities

The domain is small and sharp. Five entities. Field tables below are the product contract;
exact storage/transport shapes are an implementation concern.

### 6.1 Operator

The worker. A funded, policy-bound, autonomous agent with one objective.

| Field | Type | Notes |
|-------|------|-------|
| `operatorId` | id | Stable, unique. |
| `name` | string | Human label (e.g., "Mainnet Launch — Growth"). |
| `projectName` | string | The project the Operator works for. |
| `projectDescription` | text | Context the Operator uses to qualify leads. |
| `objective` | text | The goal in plain language (the "mission"). |
| `workerType` | enum | V1: always `GROWTH_OPERATOR`. |
| `status` | enum | `DRAFT · FUNDED · ACTIVE · PAUSED · REVOKED · COMPLETED · DEPLETED` (see §6.6). |
| `budgetAllocated` | money | Hard on-chain ceiling committed at funding. |
| `budgetSpent` | money | Sum of settled spend. Never exceeds `budgetAllocated`. |
| `budgetRemaining` | money | `allocated − spent` (derived). |
| `policy` | Policy | The enforced spending mandate (see §6.5). |
| `roi` | ROIMetrics | Outcome-per-dollar metrics (see §6.7 / Appendix B). |
| `reputationRef` | ref | On-chain identity & reputation handle (ERC-8004). |
| `identityRef` | ref | The Operator's on-chain agent identity. |
| `createdAt` | timestamp | |
| `fundedAt` / `revokedAt` / `completedAt` | timestamp? | Lifecycle stamps. |
| `lastActivityAt` | timestamp | Drives "is it actually working?" signals. |

### 6.2 Spend Event

A single attempt to move money. Every spend is policy-checked before it can settle, and every
settled spend produces a receipt.

| Field | Type | Notes |
|-------|------|-------|
| `spendId` | id | |
| `operatorId` | ref | |
| `vendor` | Vendor | Recipient; must be on the allowlist to settle. |
| `amount` | money | |
| `purpose` | string | Why — in plain language, tied to a work event. |
| `category` | enum | e.g., `DATA · ENRICHMENT · OUTREACH · RESEARCH · COMPUTE · BOUNTY`. |
| `approvalStatus` | enum | `PROPOSED · POLICY_CHECKED · APPROVED · REJECTED · AUTO_APPROVED · NEEDS_HUMAN` (see §6.6). |
| `settlementStatus` | enum | `PENDING · SETTLING · SETTLED · FAILED · REFUNDED`. |
| `rejectionReason` | enum? | If rejected: `OVER_BUDGET · UNAPPROVED_VENDOR · OVER_TX_CAP · RATE_LIMIT · REVOKED · CATEGORY_BLOCKED`. |
| `proofRecordRef` | ref | Link to the proof/receipt (LazAI-attested). |
| `relatedWorkEventId` | ref? | The work this spend served. |
| `timestamp` | timestamp | |

### 6.3 Work Event

A real action the Operator took. The unit of the activity feed. **One work event = one thing
the Operator actually did.** No fabricated events (Principle 5).

| Field | Type | Notes |
|-------|------|-------|
| `workEventId` | id | |
| `operatorId` | ref | |
| `action` | string | What it did (e.g., "Enriched 120 contacts from segment X"). |
| `actionType` | enum | e.g., `SEARCH · ENRICH · QUALIFY · OUTREACH · ANALYZE · REPORT`. |
| `outcome` | string | Result produced (e.g., "18 contacts matched ICP"). |
| `outcomeRefs` | ref[] | Links to produced artifacts (lead records, opportunities). |
| `confidence` | 0–1 | The Operator's stated confidence in the outcome. |
| `reasoningRef` | ref | LazAI-attested reasoning trace behind the action. |
| `relatedSpendIds` | ref[] | Any spend this action incurred. |
| `timestamp` | timestamp | |

### 6.4 Reputation Record

The earned, portable track record. Per-Operator and aggregated to the org/platform identity.
Anchored to ERC-8004 (see §10).

| Field | Type | Notes |
|-------|------|-------|
| `subjectRef` | ref | Operator (or aggregate) the record describes. |
| `completedJobs` | int | Objectives carried to completion. |
| `successRate` | 0–1 | Share of jobs that met their success bar (see §10). |
| `budgetEfficiency` | ratio | Qualified outcomes per unit of budget (see Appendix B). |
| `historicalRoi` | ratio | Realized ROI across the Operator's lifetime. |
| `gradedOutcomes` | int | Outcomes that have been verified/graded vs. reality. |
| `lastGradedAt` | timestamp | |
| `anchorRef` | ref | On-chain anchor (ERC-8004). |

### 6.5 Policy (the spending mandate)

Not in the user's enumerated list, but **required**: the policy is the object that makes the
four invariants real. It is the enforced mandate.

| Field | Type | Enforces |
|-------|------|----------|
| `budgetCap` | money | Invariant 1 — hard ceiling. |
| `vendorAllowlist` | Vendor[] | Invariant 2 — only these recipients can be paid. |
| `perTxCap` | money | Invariant 3 — max single spend. |
| `dailyCap` / `velocityLimit` | money / rate | Invariant 3 — burn-rate limits. |
| `categoryRules` | map | Invariant 3 — allowed categories / per-category caps. |
| `humanApprovalThreshold` | money? | Spends at/above this require explicit human approval. |
| `revoked` | bool | Invariant 4 — terminal kill flag. |

### 6.6 Lifecycle & state machines

**Operator states**

```
DRAFT ──fund──▶ FUNDED ──start──▶ ACTIVE ⇄ PAUSED
                                     │
                  budget exhausted ──┼──▶ DEPLETED
                  objective met ─────┼──▶ COMPLETED
                  revoke (any state) ┴──▶ REVOKED   (terminal, irreversible)
```

- `REVOKED` is **terminal**. No transition leaves it. No spend can settle from it.
- `DEPLETED` and `COMPLETED` are terminal-for-work but the record (activity, spend, proof,
  reputation) remains fully readable forever.
- `PAUSED` halts new *proposals*; in-flight settled spend is not reversed, but no new spend is
  initiated while paused.

**Spend event lifecycle**

```
PROPOSED ─▶ POLICY_CHECKED ─▶ {APPROVED | AUTO_APPROVED | NEEDS_HUMAN | REJECTED}
APPROVED ─▶ SETTLING ─▶ {SETTLED ─▶ RECEIPTED | FAILED}
NEEDS_HUMAN ─▶ (human approves) ─▶ APPROVED ... | (declines) ─▶ REJECTED
```

A `REJECTED` spend is still recorded with its `rejectionReason` — rejections are first-class
evidence that the policy is working, and are visible in the proof trail.

---

## 7. User Flows

Each flow lists: **Trigger → Actors → Preconditions → Steps → Postconditions → Edge cases.**

### Flow 1 — Create & fund an Operator

- **Trigger:** User clicks **Hire an Operator** / **+ Create Operator**.
- **Actors:** Founder (Maya) or Growth Lead (Devin).
- **Preconditions:** Authenticated; a funding source connected.
- **Steps:**
  1. Enter **project name** and **project description**.
  2. State the **objective** in plain language.
  3. Set the **budget** (the hard ceiling).
  4. Configure **policy**: vendor allowlist (from the library or defaults), per-tx cap,
     daily cap, optional human-approval threshold. Sensible defaults are pre-filled.
  5. Review a **plain-language summary of the mandate** ("This worker may spend up to \$500,
     no more than \$25 per transaction, only to these 6 vendors, and you can stop it anytime").
  6. **Fund** — budget is committed on-chain; the Operator receives its identity (ERC-8004).
  7. Confirm start, or save as `DRAFT`.
- **Postconditions:** Operator is `FUNDED` (or `ACTIVE` if started). On-chain ceiling and
  allowlist are live. The funding action itself is receipted.
- **Edge cases:** Funding fails/insufficient → stays `DRAFT`, no identity minted, clear error.
  Empty allowlist → cannot start (an Operator with no approved vendors can do paid work with
  no one); must add at least one vendor or run in research-only mode. Budget below a usable
  floor → warn.

### Flow 2 — The Operator works (the autonomous loop)

- **Trigger:** Operator enters `ACTIVE`.
- **Actors:** Operator (autonomous); user observes.
- **Preconditions:** `FUNDED`, has objective + policy + ≥1 vendor (for paid actions).
- **Steps (repeating loop):**
  1. Operator decides a next action toward the objective and records a **Work Event** with
     its reasoning (LazAI-attested).
  2. If the action needs paid resources, it creates a **Spend Event** (`PROPOSED`).
  3. **Policy check** runs: budget, vendor, caps, velocity, category, revocation.
     - Within policy and below human threshold → `AUTO_APPROVED` → settle via x402.
     - Within policy but at/above threshold → `NEEDS_HUMAN` → user prompted.
     - Outside policy → `REJECTED` with reason; Operator adapts.
  4. On settlement, a **receipt** is produced and attested; the spend is `RECEIPTED`.
  5. Resulting data feeds the Work Event's **outcome** and **confidence**; outcomes (leads,
     opportunities) are recorded.
  6. Metrics (spent, remaining, ROI, efficiency) update live.
- **Postconditions:** Activity stream and budget reflect only real, settled work.
- **Edge cases:** Vendor/x402 failure → `FAILED` spend, no charge, Operator retries or
  routes elsewhere; surfaced honestly in the feed. Budget reaches ceiling → no further
  spend can settle → Operator → `DEPLETED`. Low-confidence outcomes are labeled, never hidden.

### Flow 3 — Monitor & steer

- **Trigger:** User opens Dashboard or an Operator.
- **Actors:** Founder, Growth Lead.
- **Steps:** Scan Dashboard (the 5 answers) → open an Operator → read Mission, Budget burn,
  live Actions, Spend History, Proof Trail → optionally **adjust policy** (tighten caps, add/
  remove vendors, change human threshold) → **Pause** to freeze without killing.
- **Postconditions:** Policy edits take effect immediately and apply to future spend only;
  the edit itself is an auditable event.
- **Edge cases:** Tightening a cap below committed in-flight spend doesn't claw back settled
  funds (impossible); it constrains future spend. Removing a vendor mid-task blocks future
  payments to it instantly.

### Flow 4 — Revoke (the kill switch)

- **Trigger:** User taps **Kill Switch** (anywhere an Operator is visible).
- **Actors:** Founder or anyone with the kill permission.
- **Steps:** Tap → single confirm (clear about irreversibility) → revocation is committed
  on-chain → Operator → `REVOKED`.
- **Postconditions:** No further spend can settle, full stop. Remaining budget is no longer
  spendable. The record stays fully readable. Revocation is itself receipted (who, when).
- **Edge cases:** Spend already settled before the tap is not reversed (it already happened);
  spend mid-settlement is blocked from completing wherever enforceable. The UI never shows a
  "revoking…" limbo that could be mistaken for "still spending" — kill is immediate and final.

### Flow 5 — Review outcomes & ROI

- **Trigger:** Operator reaches `COMPLETED`/`DEPLETED`, or user reviews periodically.
- **Steps:** Open Operator → read outcome summary (qualified leads, opportunities), **cost per
  qualified lead**, **budget efficiency**, **realized ROI** → drill into any outcome → open
  its proof → optionally export/share.
- **Postconditions:** A defensible "what did we get for the money" answer with proof behind it.
- **Edge cases:** Outcomes pending verification are labeled `unverified` until graded (§10);
  ROI distinguishes *claimed* vs *verified*.

### Flow 6 — Audit a proof (the trust flow)

- **Trigger:** User (or external Sam) opens a proof record or a shared proof link.
- **Steps:** Open Proof → see the four-layer record (proposed → policy-enforced → settled →
  attested) → follow the on-chain settlement reference and the LazAI attestation →
  independently confirm the spend and the reasoning without trusting Deputy's word.
- **Postconditions:** A third party with no account can verify the claim.
- **Edge cases:** If any layer is missing (e.g., attestation pending), the proof clearly shows
  *what is and isn't yet provable* rather than implying full proof.

### Flow 7 — Vendor & policy administration

- **Trigger:** User edits the vendor allowlist library or policy defaults in Settings, or on an
  Operator.
- **Steps:** Add/remove approved vendors (with category and caps) → set org-wide defaults →
  changes propagate to new Operators; existing Operators are edited explicitly.
- **Postconditions:** Allowlist changes are enforced at settlement immediately.
- **Edge cases:** Removing a vendor an active Operator depends on is allowed but warns about the
  impact on in-progress work.

### Flow 8 — Budget exhaustion & top-up

- **Trigger:** `budgetRemaining` approaches zero.
- **Steps:** User is notified at configurable thresholds (e.g., 80% / 95%) → may **top up**
  (commit additional budget, raising the on-chain ceiling) or let it reach `DEPLETED`.
- **Postconditions:** Top-up extends the ceiling; without it, the Operator halts spend cleanly
  at the cap.
- **Edge cases:** Top-up is a new funding action — itself receipted; it never retroactively
  approves a spend the policy already rejected.

---

## 8. Dashboard Specification

The Dashboard exists to answer **five questions in under five seconds**, with **no vanity
metrics**.

### 8.1 The five answers (mandatory, above the fold)

| # | Question | Primary metric | Definition (precise) |
|---|----------|----------------|----------------------|
| 1 | How many operators exist? | **Active / Total Operators** | Count by state; active = `ACTIVE` + `PAUSED`. |
| 2 | How much budget is allocated? | **Budget Allocated** | Σ `budgetAllocated` across non-revoked Operators. |
| 3 | How much budget is spent? | **Budget Spent** | Σ settled `budgetSpent`. Show as amount and % of allocated. |
| 4 | What outcomes were produced? | **Qualified Outcomes** | Σ qualified leads + growth opportunities produced. |
| 5 | What is current ROI? | **Portfolio ROI** | Realized value ÷ budget spent (see Appendix B); show verified vs claimed. |

These five are the hero row. Each is a single, decision-relevant number with a small
trend/context line. Nothing decorative shares this row.

### 8.2 Layout (top → bottom)

1. **Hero KPI row** — the five answers, equal weight, mono numerals, subtle trend deltas.
2. **Budget posture** — allocated vs spent vs remaining, with portfolio **burn rate** and
   **runway** (days remaining at current burn). One compact, honest chart — not a dashboard of
   charts.
3. **Operator portfolio table** — every Operator, sortable. Columns: Name · Status ·
   Objective (truncated) · Allocated · Spent · Remaining · Qualified outcomes · ROI ·
   Efficiency · Last activity · quick **Pause/Kill**. The table is the workhorse.
4. **Recent activity** — the last N real work + spend events across all Operators, each linking
   to its source and proof.

### 8.3 Behavior & states

- **Real-time:** metrics and activity update live; updates animate in place, never disrupting
  scroll or selection.
- **Empty state:** zero Operators → a single, confident **Create your first Operator** path,
  not a wall of zeroed cards.
- **Loading:** skeletons that match final layout; no layout shift.
- **Error/degraded:** if a metric can't be computed (e.g., chain read fails), show the metric
  as *unavailable* with a reason — never a fabricated or stale-as-fresh number.
- **No vanity metrics rule:** any proposed dashboard metric must pass the test *"does this
  change a decision the user would make?"* If not, it doesn't belong here.

---

## 9. Operator Detail Specification

**This is the most important screen in the product.** Everything a user needs to trust,
understand, steer, and stop a worker lives here, on one coherent page. The reader should never
have to leave it to answer "what is this worker doing, what has it spent, can I prove it, and
how do I stop it?"

### 9.1 Page anatomy (single page, anchored sections)

**Sticky header (always visible):**
- Operator name, `projectName`, **status pill**, `lastActivityAt` ("active 12s ago").
- **Kill Switch** — pinned, unmistakable, always reachable (see §9.3).
- Secondary: **Pause/Resume**, **Edit policy**, **Share proof**.

**Module 1 — Mission**
- The `objective` in the user's own words, plus project context the Operator is working from.
- The plain-language **mandate summary** ("may spend up to X, ≤ Y per tx, only to these
  vendors, you can stop it anytime") — so the boundaries are legible at a glance.

**Module 2 — Budget**
- `Allocated · Spent · Remaining` as a single clear bar.
- **Burn rate** and **runway**; **cost per qualified lead** to date.
- The on-chain ceiling shown as an enforced fact, with a link to verify it.
- **Top-up** action.

**Module 3 — Actions (live activity)**
- The Operator's **Work Events**, newest first, streaming live. Each row: action → outcome →
  confidence → timestamp, expandable to the attested reasoning and any linked spend.
- **Authenticity guarantee surfaced:** every row is a real action. When idle, the stream
  explicitly says *"No activity — the Operator is idle"* rather than inventing motion.

**Module 4 — Spend History**
- Every **Spend Event**: vendor · amount · purpose · category · approval status · settlement
  status · proof link. **Rejected** spends are shown (with reason) as evidence the policy bites.
- Filter/sort by vendor, category, status, time.

**Module 5 — Proof Trail**
- The auditable chain for this Operator: for any spend or outcome, the four-layer record
  (proposed → policy-enforced → settled → attested). Presented as **trust, not JSON** (§11).
- One-tap **share** of any proof record.

**Module 6 — Reputation**
- This Operator's earned record: completed jobs, success rate, budget efficiency, historical
  ROI, last graded. Link to its public reputation profile and on-chain anchor (§10).

### 9.2 Coherence requirements

- All six modules are on **one page**, navigable by an anchored in-page sub-nav; the header
  and kill switch stay pinned through scroll.
- Cross-links are tight: a Work Event links to the Spend it caused; a Spend links to its
  Proof; an outcome links to the action that produced it. The page is a *graph the user can
  walk*, not six disconnected tabs.

### 9.3 Kill switch (specification)

- **Placement:** pinned in the sticky header; visually distinct (danger semantic); reachable
  at any scroll position.
- **Interaction:** single deliberate confirm that states the consequence ("This permanently
  revokes the Operator. It cannot spend again. This can't be undone.").
- **Behavior:** on confirm, revocation commits on-chain; status flips to `REVOKED`
  immediately; the action is receipted. No ambiguous "processing" state that could read as
  "still spending."
- **Post-revocation:** the page remains fully readable; all actions except read/share are
  disabled; a clear banner explains the Operator is revoked and when.

### 9.4 States

- **Loading:** module-level skeletons; header/kill switch render first so control is available
  ASAP.
- **Empty (just funded, no activity yet):** Mission/Budget populated; Actions shows an honest
  "warming up / no actions yet" state — never fabricated startup events.
- **Error:** per-module degradation with reasons; the kill switch must remain functional even
  if other modules fail to load.

---

## 10. Reputation System Specification

Reputation is **earned by being graded against reality**, and it is **portable**. It is the
product's moat (Principle 9). Anchored to **ERC-8004** so it is verifiable and not
self-asserted.

### 10.1 What reputation measures

Per-Operator (and aggregated to the org/platform identity):

| Dimension | Meaning | Source |
|-----------|---------|--------|
| **Completed jobs** | Objectives carried to a defined end. | Operator lifecycle. |
| **Success rate** | Share of jobs meeting their success bar. | Outcome grading (below). |
| **Budget efficiency** | Qualified outcomes per unit of budget. | Outcomes ÷ spend. |
| **Historical ROI** | Realized value ÷ spend over lifetime. | Verified outcomes. |
| **Calibration** | Did stated `confidence` match realized outcomes? | Confidence vs grades. |

### 10.2 Defining "success" for the Growth Operator

A growth job succeeds when it produced **qualified leads / growth opportunities that hold up
to verification** at or below an efficiency bar. Critically, an outcome is not "qualified"
because the Operator said so — it must be **gradeable against reality**:

- **Qualified lead:** a contact/opportunity matching the project's ICP that is *real* (not
  fabricated, not duplicate, reachable) — verified post-hoc.
- **Verification lag:** outcomes are initially `claimed`; they become `verified` (or
  `rejected`) once graded. Reputation weights **verified** outcomes; claimed-but-unverified
  outcomes don't inflate the record.

### 10.3 Grading methodology

- **Deterministic where possible:** the same inputs produce the same grade so the record is
  auditable. Grading logic and version are recorded with each grade.
- **Graded against observable reality**, not the Operator's self-report. A claimed lead that
  turns out fabricated or duplicate is a *miss* and counts against the record.
- **Recency-aware:** the record reflects recent performance more strongly than ancient history,
  without erasing history.
- **Anchored:** aggregate grades are anchored to the Operator's ERC-8004 identity so the
  reputation is portable and independently checkable.

### 10.4 Public reputation surface

- A public **Reputation** page (and per-Operator **Reputation Detail**) presents the
  falsifiable track record: jobs, success rate, efficiency, ROI, calibration, with links to the
  on-chain anchor and to representative proof records.
- Designed for **Sam the auditor**: verifiable without an account, with no trust in Deputy's
  word required.

### 10.5 Anti-gaming requirements

- Reputation **MUST NOT** be self-asserted, editable by the user, or improvable without real,
  graded outcomes.
- Duplicate/fabricated outcomes are detected and penalized, not silently dropped.
- Spending to manufacture vanity outcomes (paying for junk "leads") *lowers* efficiency and ROI,
  so gaming is economically self-defeating by construction.

---

## 11. Proof System Specification

> **Proof is a trust page, not a developer page.** (Principle 4.) Every important action must
> *feel* auditable to a non-technical founder, and *be* independently verifiable by a skeptical
> outsider.

### 11.1 The proof object (four layers)

Every important action (a spend, an outcome) carries a proof record built in four layers. The
UI presents them as a confidence ladder, plainly labeled:

| Layer | Question it answers | Backed by |
|-------|---------------------|-----------|
| 1. **Proposed** | What did the Operator decide to do, and *why*? | LazAI-attested reasoning trace. |
| 2. **Policy-enforced** | Was it checked against the mandate, and what was the verdict? | Recorded policy check (approved/rejected + reason). |
| 3. **Settled** | Did money actually move, to whom, how much? | x402 settlement + on-chain reference. |
| 4. **Attested** | Is there an immutable receipt a third party can verify? | LazAI immutable receipt. |

A complete proof shows all four; an incomplete one **honestly shows which layers exist yet**
(e.g., "attestation pending") rather than implying full proof.

### 11.2 Proof experience requirements

- **Trust-first presentation:** plain-language summary at the top ("\$24 paid to Vendor X to
  enrich 120 contacts, approved under policy, settled on-chain, receipt attested"), with the
  raw references progressively disclosed beneath for those who want them.
- **Attached to the thing it proves:** reachable from the originating spend or work event — not
  siloed in a separate developer console.
- **Shareable:** any proof record can be shared as a public link consumable without an account
  (Flow 6) — turning proof into outbound trust (a founder can show a customer/investor the
  receipts).
- **Honest about limits:** the system states *what is proven* (the money moved; the reasoning is
  attested) and *what is not* (e.g., subjective quality of a lead, pending verification). It
  never overclaims.

### 11.3 The Proof ledger (app)

- A cross-Operator **Proof** screen: a filterable ledger of every proof record, with the ability
  to verify and share any of them, and to export an audit bundle for a given Operator or period
  (for Priya's board reporting).

### 11.4 Non-negotiables

- **No fabricated proof.** A proof record exists only when the underlying action occurred. This
  is the spend/outcome corollary of Principle 5.
- **Rejections are proof too.** A policy-rejected spend produces a record showing the policy
  worked — this is among the most trust-building artifacts in the product.

---

## 12. Design System Specification

**Aesthetic:** Premium. Minimal. Enterprise. **Light mode only.** References: Linear, Stripe,
Apple, Ramp, Vercel. **Avoid:** gradients-everywhere, glows, neon, gaming/cyberpunk, crypto-
casino. The interface earns trust through clarity, density, and typographic quality — not
ornament. (Token values below are the *specification*; the implementation defines them once,
centrally, and components never hardcode raw values.)

### 12.1 Color

A restrained, near-monochrome system with a **single** professional accent. Color is used
sparingly and almost entirely for **state and hierarchy**, not decoration.

| Role | Spec value (reference) | Use |
|------|------------------------|-----|
| Canvas | `#FFFFFF` | Page background. |
| App shell / sunken | `#FAFBFC` | Sidebar, app chrome, sunken areas. |
| Surface / card | `#FFFFFF` + 1px border | Cards sit on the canvas via border + whisper shadow. |
| Border (light) | `#ECEDEF` | The primary structural element. |
| Border (strong) | `#DDE0E3` | Emphasis dividers, table rules. |
| Text primary (ink) | `#15181C` | Headlines, key numbers. |
| Text secondary | `#5B6068` | Body, labels. |
| Text tertiary | `#8A9099` | Meta, captions, placeholders. |
| **Accent (single)** | `#4F46E5` (indigo) | Links, active nav, focus rings, selection, data-viz primary. **Used sparingly.** |
| Primary action | `#15181C` (ink) | Primary buttons are ink-black (Vercel/Linear style); accent reserved for active/links. |
| Success | `#15803D` | Positive state, healthy ROI, settled. |
| Warning | `#B45309` | Caution, approaching caps, needs-human. |
| Danger | `#DC2626` | Kill switch, rejected spend, over-policy. |

Rules: **No gradients. No glassmorphism / decorative blur. No neon. No emoji** (use line icons).
Semantic colors are reserved for state; the accent is reserved for interaction. Structure comes
from **1px borders and spacing**, not heavy shadows.

### 12.2 Typography

- **Inter** (or equivalent grotesque) — UI and body.
- **A monospaced face with tabular figures** (e.g., a geometric mono) — all **numbers,
  amounts, addresses, IDs, and terminal-style data**, so columns align and money reads as
  money. Numeric data uses **tabular figures**.
- **Scale (reference):** Display 32–40 · H1 24 · H2 20 · H3 16 · Body 14 · Small 13 · Caption
  12 · Mono-data 13–14. Generous line-height for prose, tight for data tables.

### 12.3 Spacing, radius, elevation

- **Spacing:** 4px base scale (4 · 8 · 12 · 16 · 24 · 32 · 48). Density is a feature — this is
  a tool for people who live in it.
- **Radius:** restrained, premium — ~6px controls, ~8–10px cards. **No pills, no large rounded
  cards.**
- **Elevation:** borders do the work; shadows are a whisper (`0 1px 2px rgba(20,24,28,0.04)`,
  one heavier step for overlays). No floating, glowing, or layered-glass surfaces.

### 12.4 Iconography & data formatting

- **Line icons** (lucide-style), 1.5px stroke, used functionally. No emoji.
- **Money:** mono, tabular, explicit currency, consistent precision. **Addresses/IDs:**
  mono, truncated with copy affordance and a link to verify. **Timestamps:** relative for
  recency ("12s ago") with absolute on hover. **Confidence:** shown as a calibrated value/bar,
  never dressed up as certainty.

### 12.5 Component inventory (spec-level, not implementation)

Reusable, composable primitives — built once, reused everywhere (no one-off copies):

- **KPI Stat** (number + label + trend) — the dashboard hero unit.
- **Status pill** — Operator state and spend states; consistent color mapping everywhere.
- **Approval/Verdict badge** — approved / auto-approved / needs-human / rejected.
- **Operator card** — portfolio cell with inline pause/kill.
- **Budget bar** — allocated/spent/remaining with burn/runway.
- **Activity row** — one real work/spend event, expandable to reasoning/proof.
- **Spend table** — dense, sortable, with proof links and rejection reasons.
- **Proof record / receipt** — the four-layer trust ladder, plain-language first.
- **Kill switch** — the danger control, with deliberate confirm.
- **Async-state set** — loading skeleton / empty / error / success patterns, reused across
  every data surface so states are consistent and never fabricated.

### 12.6 Motion & accessibility

- **Motion:** minimal and purposeful — used to show real change (a value updating, an event
  arriving), never as decoration or fake "thinking." Respects reduced-motion preferences.
- **Accessibility:** WCAG AA contrast on the light palette; full keyboard operability;
  semantic structure; the kill switch and status are perceivable without relying on color
  alone.

### 12.7 Voice & content

- **Plain, precise, unhyped.** "47 qualified leads · \$212 spent · \$2.39 per lead," not
  "🚀 Crushing it!" No emoji, no hype, no false urgency.
- Numbers carry the message; copy stays out of the way. Errors and limits are stated honestly.

---

## 13. Future Roadmap

V1 is deliberately one worker, done to production quality. The roadmap shows the arc *without*
pulling future work into V1. (See Appendix E for the V1 scope guardrails.)

### Now — V1: The Growth Operator (this PRD)

One worker. Create → fund → work → monitor → prove → kill. Enforced budgets via the four
invariants. x402 spend, ERC-8004 identity/reputation, LazAI proof. The complete trust surface
(Reputation, Proof, Demo, Docs).

### V1.1 — Trust & operability hardening

- Richer policy controls (per-category caps, scheduled budgets, multi-threshold human approval).
- Audit-bundle export for finance/board (Priya).
- Notifications/alerts (budget thresholds, needs-human, anomalies).
- Calibration reporting in reputation (confidence vs. realized).

### V2 — More worker types (still no marketplace)

- A *second* and *third* Operator type beyond Growth (e.g., Research Operator, Distribution
  Operator), sharing the same enforcement, proof, and reputation spine.
- **Policy & vendor templates** so new Operators inherit trusted mandates.
- Team accounts, roles, and approvals (separating who funds, who steers, who kills).

### V3 — The network (where the moat compounds)

- **Operator-to-operator** payments and composition (one worker hires another), all under
  enforced mandates and full proof.
- **Reputation-driven discovery / marketplace** — *only once* there is a real, graded track
  record to rank by. The marketplace is earned by the reputation system, not built before it.
- Portable reputation consumed by third parties (ERC-8004) as a credential outside Deputy.

### Enterprise track (parallel)

- SSO, granular RBAC, spend approvals/workflows, compliance exports, SLAs, on-chain audit
  attestations for regulated treasuries.

**Roadmap discipline:** each phase is unlocked by the prior one's *proof*. We do not build the
marketplace before reputation is real, or multiple workers before one worker is trusted.

---

## Appendix A — Trust & Enforcement Model (foundational)

The product's credibility rests entirely here. This is a behavioral spec, not an implementation.

### A.1 Separation of custody and capability

| Capability | Who holds it | Guarantee |
|------------|--------------|-----------|
| **Decide & propose** spending | The Operator (AI) | Unconstrained reasoning; zero custody. |
| **Authorize settlement** | The enforced policy/mandate | Only spends satisfying all policy constraints can settle. |
| **Hold the ceiling, allowlist, kill flag** | On-chain mandate | Cannot be overridden by the Operator under any prompt, bug, or attack. |

The Operator never holds a key that can move funds outside the mandate. It can only *request*;
the mandate *decides*.

### A.2 The four invariants, restated as enforceable guarantees

1. **Budget ceiling:** `Σ settled spend ≤ budgetAllocated`, always, enforced at settlement.
2. **Vendor allowlist:** settlement to any non-allowlisted recipient is impossible.
3. **Policy:** per-tx cap, daily/velocity cap, category rules, and human-approval thresholds
   are evaluated *before* settlement; failing checks block the spend (recorded as `REJECTED`).
4. **Revocation:** the kill flag is terminal; once set, no settlement can occur.

These hold **even if the model is fully compromised.** That is the design target: assume the
AI is adversarial and the guarantees still bind.

### A.3 Threat assumptions

- Treat the Operator as potentially **hallucinating, jailbroken, or prompt-injected.**
- The enforcement layer is the trusted computing base; the model is not.
- Soft guardrails (system prompts) reduce *waste*, not *risk* — risk is bounded only by the
  enforced mandate.

---

## Appendix B — Metrics Dictionary

Every product number has one definition. (Prevents the "two dashboards, two truths" failure.)

| Metric | Definition | Notes |
|--------|------------|-------|
| **Budget Allocated** | Committed on-chain ceiling for an Operator (Σ across portfolio). | Hard cap. |
| **Budget Spent** | Σ of `SETTLED` spend. | Never exceeds allocated. |
| **Budget Remaining** | `allocated − spent`. | Derived. |
| **Burn Rate** | Spend per unit time over a trailing window. | Powers runway. |
| **Runway** | `remaining ÷ burn rate`. | "Days left at current pace." |
| **Qualified Outcome** | A verified qualified lead or growth opportunity. | `claimed` until graded. |
| **Cost per Qualified Lead** | `spent ÷ verified qualified leads`. | Headline efficiency for growth. |
| **Budget Efficiency** | Verified qualified outcomes per unit budget. | Feeds reputation. |
| **ROI (realized)** | Realized value of verified outcomes ÷ spend. | Show verified vs claimed separately. |
| **Success Rate** | Share of completed jobs meeting their success bar. | Graded vs reality. |
| **Calibration** | Agreement between stated confidence and realized outcomes. | Graded over time. |
| **Reputation Score** | Composite of success rate, efficiency, ROI, calibration, recency-weighted. | Anchored on-chain; not self-asserted. |

**Verified vs claimed:** any value derived from outcomes MUST distinguish `claimed` (Operator-
reported) from `verified` (graded). Headline ROI and reputation use **verified** only.

---

## Appendix C — Risks & Open Questions

| Area | Risk / question | Direction |
|------|-----------------|-----------|
| **Outcome verification (oracle problem)** | How do we *prove* a lead is "qualified" and real, not fabricated? This is the hardest unsolved problem. | Reputation must weight verified outcomes; define a deterministic grading method and resist counting self-reported wins. Open. |
| **Vendor identity & x402 coverage** | The allowlist is only as good as our ability to bind a vendor to a recipient; x402 vendor coverage may be thin at launch. | Curated, verified vendor library; categories with caps; graceful behavior when a needed vendor isn't payable. |
| **Regulatory / custody** | Funding, holding, and disbursing user budgets may implicate money-transmission/custody rules. | Legal review before GA; prefer non-custodial mandate designs; document the model. Open. |
| **Model overclaiming outcomes** | The Operator may report confident outcomes that don't hold up. | Confidence is graded (calibration); unverified outcomes never inflate headline metrics. |
| **Reputation gaming** | Manufacturing junk outcomes to pad the record. | Verified-only weighting + duplicate/fraud detection makes gaming lower efficiency, not raise reputation. |
| **Disputes / refunds** | Failed or bad-value spend handling. | First-class `FAILED`/`REFUNDED` states; refunds are receipted; disputes are out of V1 automation but visible. |
| **Proof completeness** | A proof layer (attestation, settlement) may lag. | Always show which layers exist; never imply full proof from a partial record. |
| **"No fabricated activity" vs. perceived idleness** | An honest empty feed may feel "broken" to users used to fake progress. | Make idle states confident and explanatory; educate that silence = honesty (Principle 5). |

---

## Appendix D — Glossary

- **Operator** — an Autonomous Economic Worker: a funded, policy-bound AI worker with one
  objective. V1 ships one type: the **Growth Operator**.
- **Mandate / Policy** — the enforced spending rules (ceiling, allowlist, caps, thresholds,
  kill flag) the Operator cannot override.
- **Spend Event** — a single attempt to move money; policy-checked, then settled and receipted.
- **Work Event** — a single real action the Operator took, with outcome, confidence, and
  attested reasoning.
- **Proof Record** — the four-layer (proposed → enforced → settled → attested) auditable trail
  for a spend or outcome.
- **Reputation** — the earned, graded, portable track record, anchored on-chain.
- **Kill switch / Revocation** — the instant, terminal stop; after it, no spend can settle.
- **x402 / ERC-8004 / LazAI** — the payment rail / identity & reputation standard / verifiable
  receipts & reasoning layer, respectively.

---

## Appendix E — V1 Scope Guardrails (what we are NOT building)

Per the brief, V1 designs **one** worker — fully. The following are **out of scope for V1** and
**MUST NOT** be added under it:

- **No marketplace.** No discovery, ranking, or hiring of third-party workers.
- **No multiple workers.** Exactly one Operator type: the Growth Operator.
- **No future-feature scaffolding.** No multi-worker abstractions, no operator-to-operator
  payments, no template marketplace, no team-RBAC beyond what one founder needs.
- **No second objective type, chain expansion, or vendor self-serve onboarding** in V1.

Anything in §13 beyond "Now — V1" is a *direction*, not a V1 deliverable. When in doubt, make
the one worker more trustworthy rather than adding a second of anything.

---

*End of PRD v1.0. This document specifies intent and behavior, not implementation. Hand it to
senior engineers and designers; it should be sufficient to build V1 without re-deriving the
"why."*
