# Deputy — Product Experience Specification

> **Discipline:** Product & Design · **Status:** Draft v1.0 (experience source of truth)
> **Owner:** Head of Product & Design
> **Companions:** [PRD](deputy-prd.md) · [Architecture ADR](deputy-architecture.md) · [Policy Vault Protocol](deputy-policy-vault-protocol.md)
> **Audience:** Product designers, UX engineers, front-end engineers.
> This document is the single source of truth for UX, UI, page layout, information hierarchy,
> and interaction design. It does **not** specify backend, contracts, or implementation. Where a
> visual choice cannot be expressed within the constraints here, the constraint wins.

---

## 0. What we are designing

Deputy is **a system for hiring autonomous workers that operate under on-chain law.** Not a
dashboard. Not a marketplace. Not an AI chat app. The user is a manager; the worker is an
*Operator*; the law is the *Mandate*. The product's entire job, expressed as experience, is to
make a person feel four things and never their opposites:

| Feel | Never |
|------|-------|
| **Control** — I set the limits; I can stop it instantly. | Mystery — "what is it doing?" |
| **Trust** — every claim is verifiable, not asserted. | Magic — "just believe the AI." |
| **Visibility** — I can see the work as it happens. | Opacity — a black box with a spinner. |
| **Accountability** — outcomes are graded against reality. | Hand-waving — unfalsifiable wins. |

### 0.1 The three conceptual devices (used everywhere)

Everything in the product is one of three things. Designers should be able to place any screen
element into one of these:

1. **The Mandate** — the worker's visible law: budget ceiling, approved vendors, caps, expiry,
   kill switch. Always shown as *enforced facts*, never as soft "settings." Delivers **Control**.
2. **The Gate** — the moment a proposal meets the law and is approved or refused. This is the
   thesis made visible: *the AI proposes, the law decides.* Delivers **Trust**.
3. **The Record** — proof and reputation: the permanent, gradable trail. Delivers
   **Accountability**.

### 0.2 The one recurring visual motif: the Enforcement Mark

A single, restrained marker — a 1px mono "✓ enforced on-chain" / "✓ attested" affordance —
appears on facts that are guaranteed (a budget ceiling, a settled spend, a proof). It is
monochrome, line-weight, never neon, never a "crypto badge." It is the product's signature: a
quiet stamp that says *this is real, not a claim.* Defined in §12.9. It is the visual carrier of
trust and must never be used decoratively or on anything unverified.

---

## 1. The product narrative — 5s / 30s / 5min

Exactly what a user must understand at three time horizons. Every page is graded against this.

### 1.1 In 5 seconds (the glance)
> *"I can hire an AI worker, give it a budget instead of my keys, and kill it instantly."*

What the eye must catch without reading: **a worker**, **a budget with a visible hard ceiling**,
and **a stop control**. On the homepage hero and on every Operator, those three are perceivable
pre-cognition — through layout and the budget meter, not copy. If a viewer takes only one image
away, it is *a worker inside a visible box it cannot leave.*

### 1.2 In 30 seconds (the loop)
> *"It proposes spending; an on-chain policy approves or rejects each one; outcomes pile up; I
> can see and verify everything; I'm always in control."*

What they must grasp: the **propose → gate → settle → prove** loop, that **rejections happen**
(the law has teeth), and that outcomes are accumulating against a budget that cannot be exceeded.
This is delivered by the Dashboard's live pulse and one visible Gate event.

### 1.3 In 5 minutes (the conviction)
> *"This worker has a track record graded against what actually happened. Its limits are law it
> physically can't break. I could hand any of its receipts to a skeptic and they'd verify it
> without trusting Deputy — or me."*

What they must reach: **accountability** (reputation graded against reality, verified vs
claimed), the **Mandate as on-chain law** (not toggles), and **independent verifiability** (proof
that survives distrust of the company). This is the Operator Detail page + a shared Proof link
doing their job. The 5-minute feeling is *quiet confidence,* the opposite of hype.

---

## 2. Design principles & anti-patterns

1. **Show the walls.** Control is a feeling produced by *seeing* the limits, not by being told
   they exist. The Mandate is always visible near the work.
2. **Proof over persuasion.** We never ask for trust; we make it checkable. Every important
   number has a path to its evidence.
3. **Narrative, not logs.** Work reads like sentences a human wrote, not machine output.
4. **Honest silence.** When nothing is happening, we say so plainly. We never fabricate progress,
   fake "thinking…," or pad a feed (carried from the PRD's authenticity rule). An honest empty
   state out-trusts a busy fake one.
5. **Restraint is the brand.** White-first, near-monochrome, one accent, color reserved for
   meaning. Density and typography do the work; ornament does none.
6. **One primary action per surface.** Create on the list; Kill on the detail. The eye is never
   asked to choose between five equal buttons.
7. **The number is the message.** Tabular mono figures, aligned, unhyped. No "🚀", no exclamation.

**Anti-patterns (forbidden):** crypto/neon/cyberpunk aesthetics, gradients, glassmorphism,
gaming visuals, dark mode, emoji, glow, drop-shadow theater, vanity metrics, fake progress,
spinners-as-experience, "AI is thinking…" mysticism, badges/confetti for reputation.

---

## 3. Homepage (structure only — no marketing copy)

A single, calm scroll. Each band has exactly one job. White-first; the only color is the
Mandate meter, verdict states, and one accent CTA.

```
┌──────────────────────────────────────────────────────────────────────┐
│  NAV  Deputy        Product   How it works   Reputation   Docs  [CTA]  │
├──────────────────────────────────────────────────────────────────────┤
│  BAND 1 — HERO                                                         │
│   Left: one-line thesis (worker · budget-not-keys · kill).            │
│   Right: a LIVE Operator object — a real worker card showing a budget │
│   meter, a working state, one streaming activity line, a kill control.│
│   (Not an illustration. A product object. The hero IS the product.)   │
│   Primary CTA below the thesis. Single button.                        │
├──────────────────────────────────────────────────────────────────────┤
│  BAND 2 — THE LOOP (how it works)                                     │
│   Four steps shown as a horizontal sequence with the Gate at center:  │
│   Propose → [GATE: approve/reject] → Settle → Prove.                  │
│   Each step is a real miniature of the in-app component, not an icon. │
├──────────────────────────────────────────────────────────────────────┤
│  BAND 3 — PROOF                                                        │
│   A real proof receipt, rendered. Plain-language summary on top,      │
│   the four-layer trust ladder, the Enforcement Mark, a "verify" link. │
│   Message: proof is a receipt anyone can check, not a developer page. │
├──────────────────────────────────────────────────────────────────────┤
│  BAND 4 — TRUST / "ON-CHAIN LAW"                                       │
│   The Mandate explained: budget ceiling, approved vendors, caps,      │
│   instant revoke — each as an enforced fact with the Enforcement Mark.│
│   A compact "what survives if X fails" statement (model, backend, us).│
├──────────────────────────────────────────────────────────────────────┤
│  BAND 5 — ACCOUNTABILITY / REPUTATION                                 │
│   A real track-record strip: graded outcomes, verified vs claimed.    │
│   Message: workers earn a falsifiable record, not a score.            │
├──────────────────────────────────────────────────────────────────────┤
│  BAND 6 — CTA FLOW                                                     │
│   Single primary CTA → "Hire an Operator". Secondary: see the Demo.   │
│   No pricing wall, no signup friction theater. One door.              │
└──────────────────────────────────────────────────────────────────────┘
```

**CTA flow:** Hero CTA and Band-6 CTA both route to *Create Operator*. Unauthenticated users hit
a minimal sign-in *inside* the create flow (auth is a step, not a gate), so the first thing they
ever do is define a worker — the product sells itself by being used. "See the Demo" routes to a
read-only real Operator (Band 1's live object, expanded).

**Design intent:** the homepage proves the product by *showing real product objects*, not
marketing illustrations. The hero is a working Operator. The proof band is a real receipt. This
is the Stripe/Linear move: the product is the best argument for itself.

---

## 4. Navigation & information architecture

### 4.1 Map

```
PUBLIC (unauthenticated, indexable)
├── Home
├── How it works (the loop + the Mandate)
├── Reputation            ── public track records
│   └── Reputation Detail ── one Operator's public, verifiable record
├── Docs
├── Demo                  ── read-only real Operator
└── Shared Proof          ── public, link-only proof receipt (no account)

AUTHENTICATED — APP SHELL (persistent left sidebar)
├── Dashboard             ── the 10-second portfolio answer
├── Operators             ── list + Create Operator
│   ├── Create Operator   ── define mission, budget, Mandate, fund
│   └── Operator Detail   ── THE flagship (mission, budget, work, spend, proof, reputation, kill)
├── Activity              ── cross-operator narrative timeline
├── Proof                 ── cross-operator proof ledger; verify & share
└── Settings (Admin)
    ├── Account & funding source
    ├── Vendor library    ── the approved-vendor allowlist library + add/remove (owner-gated)
    ├── Mandate defaults  ── default caps/thresholds for new Operators
    ├── Team & roles      ── who can fund / steer / approve / kill
    └── Notifications     ── budget thresholds, needs-human, anomalies
```

### 4.2 View tiers

| Tier | Surfaces | Primary job |
|------|----------|-------------|
| **Public** | Home, How, Reputation, Docs, Demo, Shared Proof | Earn trust before login; let proof travel. |
| **Authenticated (portfolio)** | Dashboard, Operators, Activity, Proof | Command and oversee all workers. |
| **Operator views** | Operator Detail, Create Operator | Understand, steer, and stop one worker. |
| **Admin views** | Settings (account, vendor library, mandate defaults, team/roles, notifications) | Govern the org-level mandate and access. |

### 4.3 Sidebar & chrome

- **Left sidebar** (240px, collapsible to 64px icon rail): the five destinations, an org switcher
  at the footer, a subtle environment marker, help. Active item uses the accent; everything else
  is ink/secondary. No nested accordions — depth lives inside pages.
- **Top bar (in-app):** breadcrumb/title left; right side holds search, notifications, and the
  single global primary action **+ Create Operator**, plus the account menu.
- **Kill reachability rule:** anywhere an Operator is represented (card, row, detail), its kill
  control is ≤ 2 interactions away. Control is never buried.

---

## 5. Dashboard

> **The 10-second question:** *If a founder logs in for 10 seconds, what should they understand?*
> **Answer:** "All my workers, what they've cost, what they've produced, whether anything needs
> me — and that nothing is out of control."

### 5.1 Hierarchy (priority order, top → bottom)

```
┌──────────────────────────────────────────────────────────────────────┐
│ TIER 0 — ATTENTION BAR (only if something needs the human)            │
│   e.g. "2 spends await your approval · 1 operator near budget"        │
│   Appears only when true. Silence when all is well (honest).          │
├──────────────────────────────────────────────────────────────────────┤
│ TIER 1 — THE FIVE ANSWERS (hero KPI row, equal weight, mono figures)  │
│   Active Operators │ Allocated │ Spent (of allocated) │ Outcomes │ ROI│
│   Each: one number + a quiet trend line. Nothing decorative here.     │
├──────────────────────────────────────────────────────────────────────┤
│ TIER 2 — BUDGET POSTURE (one honest chart, not a wall of charts)      │
│   Allocated vs Spent vs Remaining · portfolio burn rate · runway.     │
├──────────────────────────────────────────────────────────────────────┤
│ TIER 3 — OPERATOR PORTFOLIO (the workhorse table)                     │
│   Name · Status · Mission · Allocated · Spent · Remaining · Outcomes  │
│   · ROI · Efficiency · Last active · inline Pause/Kill.               │
├──────────────────────────────────────────────────────────────────────┤
│ TIER 4 — LIVE PULSE (recent real work + spend across all operators)   │
│   The last N narrative events, each linking to source + proof.        │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 Section definitions

- **Tier 0 — Attention bar.** The only interruptive element in the product. Surfaces *exactly*
  what requires the human: spends needing approval, an Operator near its ceiling, an anomaly
  freeze. If nothing needs them, the bar is absent — its absence is information ("nothing needs
  me").
- **Tier 1 — The five answers.** The mandatory hero from the PRD: Active Operators, Budget
  Allocated, Budget Spent (with % of allocated), Qualified Outcomes, Portfolio ROI (verified vs
  claimed marked). Equal visual weight, large mono numerals, a small trend delta each. **No
  vanity metric earns a slot here** — the test is "does this change a decision?"
- **Tier 2 — Budget posture.** One restrained chart: allocated / spent / remaining, plus burn
  rate and **runway** (days at current pace). This is the "am I safe on money" glance.
- **Tier 3 — Operator portfolio.** The dense, sortable table that is the real working surface.
  Status pills, tabular figures, inline pause/kill. This is where a multi-worker user lives.
- **Tier 4 — Live pulse.** A short cross-operator narrative stream proving the system is *alive
  and honest* — real events only, each a sentence, each linking to its proof.

### 5.3 Behavior
Real-time updates animate **in place** — never hijacking scroll, focus, or selection. Skeletons
match final layout (no shift). A metric that can't be computed shows *unavailable* with a reason,
never a stale-as-fresh or invented number.

---

## 6. Operator Detail — the flagship page

This page must, on one coherent surface, answer a strict narrative sequence top-to-bottom, while
keeping **control** (kill switch) and **the law** (Mandate) persistently in view.

> **The page's question sequence:**
> 1. *Who is this worker, and is it alive?* → Header
> 2. *What has it achieved, at what cost?* → Outcomes band
> 3. *What is it doing right now?* → Activity (the heart)
> 4. *Where did the money go — and was it allowed?* → Spend & Policy ledger (the Gate)
> 5. *Can I prove any of it?* → Proof trail
> 6. *(always) What are its limits, and how do I stop it?* → Mandate rail + Kill switch

### 6.1 Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ STICKY HEADER                                                                  │
│  ◀ Operators   ●Active  "Launch Growth"  · acquiring leads · active 8s ago     │
│                         [Pause] [Edit Mandate] [Share]      [ ⛔ KILL SWITCH ]   │
├──────────────────────────────────────────────────────────────────────────────┤
│ OUTCOME BAND  (what did we get for the money — the answer band)                │
│  47 qualified leads · $212 spent · $4.51 / lead · ROI 3.1× (verified)          │
├───────────────────────────────────────────┬────────────────────────────────────┤
│ MAIN COLUMN (≈64%)                         │ RIGHT RAIL (≈36%, sticky)          │
│                                            │                                    │
│  MISSION (compact)                         │  THE MANDATE  ✓ enforced on-chain  │
│   objective + project context + the        │   Budget meter  ████████░░  $212/  │
│   plain-language mandate summary.          │                 $500 · runway 6d   │
│                                            │   LAWS:                            │
│  ACTIVITY (the narrative timeline) ──────  │    • Ceiling  $500     ✓ enforced  │
│   live story of real work + spend + gates. │    • Vendors  6 approved ✓         │
│   (the emotional + visibility core)        │    • Per-tx   ≤ $25    ✓           │
│                                            │    • Velocity ≤ $150/day ✓         │
│  SPEND & POLICY LEDGER (the Gate) ───────  │    • Expires  in 5d               │
│   every spend request, its policy verdict, │    • Kill     [ ⛔ revoke now ]     │
│   amount, vendor, purpose, proof link.     │                                    │
│   rejections shown as first-class.         │  REPUTATION                       │
│                                            │   track record · verified outcomes │
│  PROOF TRAIL ──────────────────────────    │   · calibration · efficiency trend │
│   the four-layer receipts for this worker. │                                    │
└────────────────────────────────────────────┴────────────────────────────────────┘
```

### 6.2 Module specifications

- **Header (sticky).** Operator name, project, **status pill**, last-active relative time. The
  **Kill Switch** is pinned here, visually distinct (danger), reachable at any scroll. Secondary:
  Pause/Resume, Edit Mandate, Share. The header is the only place the kill switch is *large*; the
  rail echoes it.
- **Outcome band.** The single most important answer: qualified outcomes, spent, cost-per-
  outcome, ROI — with **verified vs claimed** explicitly marked. This band exists so "what did I
  get for the money" is answered before the user scrolls.
- **Mission (compact).** Objective in the user's words + project context + the **plain-language
  mandate summary** ("may spend up to $500, ≤ $25 per tx, only to these 6 vendors, you can stop
  it anytime"). Collapsible; it sets the frame, it is not the focus.
- **Activity timeline.** The heart of the page (full spec §8). Live, narrative, real-only.
- **Spend & Policy ledger (the Gate).** Every spend request with its **policy verdict** —
  approved / auto-approved / needs-human / **rejected (with reason)** — vendor, amount, purpose,
  category, settlement state, and a proof link. Rejections are shown as prominently as
  approvals; they are the proof the law works. Filterable by vendor/category/status/time.
- **Proof trail.** Per-spend and per-outcome four-layer receipts (full spec §9), each shareable.
- **The Mandate (right rail, sticky).** The law, always in view: a **budget meter** (spent /
  ceiling + runway), and the enforced **Laws** list each carrying the Enforcement Mark. A
  secondary **revoke** control lives here so the kill is reachable even when the header scrolls
  on small screens. Editing a law opens the owner-gated flow (additions are slow/timelocked,
  per the protocol; the UI communicates this — §6.3).
- **Reputation (right rail).** This worker's earned record (full spec §10).

### 6.3 Editing the Mandate (UX of "law has weight")
Tightening (lower a cap, remove a vendor, reduce budget) is **immediate** and framed as routine.
**Expanding** authority (add a vendor, raise the budget/cap) is framed as a deliberate,
**owner-signed, time-delayed** act: the UI shows a pending state ("New vendor — active in 24h,
cancel anytime"), a countdown, and a one-tap cancel. The friction is intentional and
*reassuring* — it visibly demonstrates that even the owner can't instantly redirect funds. This
is the protocol's anti-poisoning timelock surfaced as a trust feature, not an obstacle.

---

## 7. The Signature Moment — "The Law Holds"

> The single interaction Demo Day viewers remember. It must make the thesis *visceral*: the AI
> proposes, and a law it cannot override decides — and the human can end it all in one tap.

### 7.1 The screen
A focused view (works inside Operator Detail and as a standalone Demo scene): a single **Spend
Request card** rising into a vertical **Gate** — a stack of the worker's Laws rendered as
checkpoints. Below the Gate, an outcome slot. To the side, the **Kill Switch**, pinned and live.

```
        ┌───────────────────────────────────────────────┐
        │  SPEND REQUEST                                 │
        │  Operator wants to pay  $40  to  "DataVendorX" │
        │  purpose: enrich 200 contacts                  │
        └───────────────────────────────────────────────┘
                              │  (the request descends through the Gate)
        ┌─────────────────────▼─────────────────────────┐
        │  THE GATE — the Mandate, evaluating            │
        │   Budget remaining $288 ............... ✓ pass │
        │   Vendor approved? .................... ✗ NO   │  ◀── stops here
        │   Per-tx ≤ $25? ....................... — n/a  │
        │   Not revoked? ........................ —      │
        └───────────────────────────────────────────────┘
                              │
        ┌─────────────────────▼─────────────────────────┐
        │  ⛔ REJECTED BY POLICY                          │
        │  Reason: vendor not on the approved list.      │
        │  No funds moved.  ✓ enforced on-chain          │
        └───────────────────────────────────────────────┘
```

### 7.2 The interaction & state changes
1. A real spend request animates up into the Gate (no fabricated delay — it moves at the speed
   of the real check).
2. Each Law **resolves in sequence** — a quiet check or cross resolving top to bottom. The checks
   are real evaluations, shown honestly.
3. **Two endings, both designed:**
   - **Pass:** the request settles — the card transforms into a **green SETTLED receipt** with the
     Enforcement Mark and a live proof link; the budget meter ticks down by the exact amount; an
     outcome begins to form in the slot below. Calm, satisfying, *legitimate*.
   - **Reject:** the request stops at the failing Law and becomes a **red REJECTED card** stating
     the reason and, crucially, **"No funds moved · enforced on-chain."** The worker visibly
     *tries again differently* (adapts) — it does not get its way.
4. **The mic-drop:** while a request is mid-Gate, the presenter taps **Kill Switch**. The status
   flips to **REVOKED** with an on-chain stamp; the in-flight request and every pending proposal
   collapse to **"cannot execute — authority revoked."** The worker is alive one second and
   powerless the next — and the screen *proves* it stopped.

### 7.3 Emotional impact
The viewer feels, in order: *curiosity* (an AI is about to spend money) → *tension* (will it?) →
**relief and authority** (the law caught it / I stopped it). The takeaway sentence forms itself:
**"The AI proposed. The chain refused. I'm in control — and I can prove it."** No other product
in the category can show this, because no other product enforces at this layer. The signature
moment *is* the differentiation, rendered.

### 7.4 Discipline
Every animation maps to a real evaluation. We never stage a fake "thinking" pause to build drama;
the drama is real (a real check, a real rejection, a real on-chain revoke). Manufactured tension
would betray Principle 4 and the product's whole premise.

---

## 8. Activity Timeline — a narrative system, not logs

### 8.1 Principle
Work reads as **sentences**, grouped into a **story**. A log says `tool_call: enrich(120)`. Deputy
says *"Enriched 120 contacts from the Q3 segment — 18 matched your ICP."* Each event is authored
for a human, derived from the real action.

### 8.2 The event grammar
Every event is one line built from a fixed grammar so the stream scans cleanly:

```
[type-mark]  <subject did action>  → <outcome>     <metric>   <cost?>   ✓proof
   ◆         Searched 3 sources for DeFi founders   → 240 found   —        ·
   ✦         Qualified 240 contacts against ICP     → 31 matched  —        ·
   $→        Paid Clearbit to enrich 31 contacts    → enriched    $24      ✓proof
   ⛔         Tried to pay an unapproved vendor       → refused      —        ✓proof
   ★         Outcome verified: 31 qualified leads    → confirmed    —        ✓proof
```

- **Event types** (each a distinct quiet mark + a semantic role, never color-spammed):
  *Work* (◆ search/analyze), *Result* (✦ qualify/produce), *Spend* ($→ settled), *Gate* (⛔/✓
  policy decision), *Outcome* (★ verified/rejected), *System* (○ funded/paused/revoked).
- **Confidence** appears as a small calibrated marker on result/outcome events — shown honestly,
  never dressed as certainty.
- **Cost** appears only on spend events, in mono, right-aligned, tabular.
- **Proof** is an inline affordance (`✓proof`) on every event that has one — proof is attached to
  the act, not siloed.

### 8.3 Structure
- **Grouped into sessions / mission phases** ("Prospecting · 2h", "Enrichment · 40m") so the
  story has chapters, not an undifferentiated firehose.
- **Newest first, streams live**, animating in place.
- **Expandable:** a row opens to reveal the attested reasoning ("why it did this") and any linked
  spend/proof — progressive disclosure from sentence → evidence.
- **Honest idle state:** when the worker is between actions, the stream says so plainly
  (*"Idle — no actions in the last 4m"*), never an invented heartbeat.

### 8.4 Why this matters
The timeline is the primary delivery of **Visibility**, and — because every line is real and
links to proof — a secondary delivery of **Trust**. It is the antidote to "black box with a
spinner."

---

## 9. Proof Experience — proof as trust, not a developer screen

### 9.1 Inversion
Most products bury proof behind a "Developers" link as raw JSON. Deputy makes proof a **receipt a
non-technical founder reads with confidence and a skeptic verifies without trusting us.**

### 9.2 The proof receipt (anatomy)

```
┌──────────────────────────────────────────────────────────────┐
│  PROOF                                          ✓ attested     │
│  $24 paid to Clearbit to enrich 120 contacts.                 │
│  Approved under policy · settled on-chain · receipt attested. │   ◀ plain-language summary, first
│                                                                │
│  ① PROPOSED   what the worker decided & why      [view reason] │   ◀ four-layer
│  ② ENFORCED   checked against the Mandate → approved          │     trust ladder
│  ③ SETTLED    $24 moved to Clearbit on Metis     [view tx]    │     (vertical stepper,
│  ④ ATTESTED   immutable receipt                  [verify]     │      checks resolve down)
│                                                                │
│  [ Share proof ]   public link — verifiable without an account│
└──────────────────────────────────────────────────────────────┘
```

- **Top:** one plain sentence anyone understands. The Enforcement Mark sits here.
- **Middle:** the **four-layer ladder** (Proposed → Enforced → Settled → Attested) as a vertical
  stepper with resolved checks. Each layer has a progressive-disclosure link to its raw evidence
  for those who want it — but the default view is *human*.
- **Honesty:** if a layer is pending (e.g., attestation lagging), it is shown as *pending*, never
  implied complete. We state **what is proven** (the money moved; the reasoning is attested) and
  **what is not** (subjective quality; outcomes awaiting verification).
- **Rejections get receipts too.** A policy-refused spend produces a proof showing the law worked
  — among the most trust-building artifacts in the product.

### 9.3 Shareable proof
Any receipt produces a **public link** consumable with no account. This turns proof into outbound
trust: a founder shows a customer/investor the receipts; the skeptic verifies independently. The
shared page is the receipt above, minus app chrome, plus a quiet "what is Deputy" footer.

### 9.4 The Proof ledger (app)
A cross-operator, filterable ledger of every receipt, with **verify** and **share** on each, and
an **export audit bundle** (per operator / per period) for finance and board reporting. This is
the only "audit" surface, and it is designed for a human reader, not a log parser.

---

## 10. Reputation Experience — trust, not scores

### 10.1 Principle
Reputation is **a track record graded against reality**, presented the way you'd assess a person
you might hire — not a game score, not a badge shelf, not a 5-star rating. The feeling target:
*"this worker has been right before, and I can check every time it was."*

### 10.2 What it shows (and how it feels)

```
┌──────────────────────────────────────────────────────────────┐
│  TRACK RECORD                                                 │
│   Graded against what actually happened — 38 outcomes graded. │
│                                                                │
│   Verified outcomes      31 / 38  confirmed real    [see all] │   ◀ verified vs claimed,
│   Calibration            said 0.8 · delivered 0.79  ✓ honest  │     not a single number
│   Budget efficiency      $4.51 / verified lead  (trend ↓ good)│
│   Completed missions     6                                    │
│                                                                │
│   ▸ recent grades  ★ confirmed  ★ confirmed  ✗ missed  ★ ...  │   ◀ a falsifiable history,
│                                                  each → proof  │     each links to its proof
└──────────────────────────────────────────────────────────────┘
```

- **Verified vs claimed**, always separated — the headline is *graded* outcomes, never self-
  reported wins.
- **Calibration** ("it said 0.8, reality was 0.79") is the trust signal: does this worker mean
  what it says? Shown as an honesty indicator, not a trophy.
- **Efficiency over time** as a quiet trend (cost per verified outcome), the one place a small
  sparkline is allowed.
- **A history of grades**, each linking to the proof of that grading. The record is *checkable*,
  which is the entire point — a reputation you can audit is a reputation you can trust.
- **Survives upgrades.** The record is the worker's identity, not a model version; the UI never
  resets it on an upgrade (it may annotate "model updated" as a timeline marker).

### 10.3 What we never do
No 5-star ratings, no letter grades as the headline, no badges, no leaderboards-as-vanity, no
confetti. Reputation is sober by design; gravity *is* the aesthetic.

---

## 11. Empty states (designed, not afterthoughts)

Each empty state reinforces trust through honesty and points at the one next action. None use
fake data or decorative cheer.

| State | What it says | The one action |
|-------|--------------|----------------|
| **New Operator (just funded, no actions)** | "Warming up — no actions yet. Work appears here the moment it happens." Honest, not a fake heartbeat. The Mandate is already fully populated (the walls exist before the work). | — (watch) / Edit Mandate |
| **No outcomes yet** | "No outcomes yet. Qualified leads appear here as the worker produces and verifies them — claimed first, then graded." Sets the verified-vs-claimed expectation early. | — |
| **No spending yet** | "No spending yet. Every payment will pass the Mandate and produce a receipt." Frames the Gate before the first spend, building anticipation of control. | — |
| **No reputation yet** | "No track record yet. Reputation is earned only after outcomes are graded against reality — it can't be bought or asserted." Turns the void into a *credibility* statement. | — |
| **No activity (idle)** | "Idle — nothing is happening right now." Plain. The product's honesty thesis, rendered as a feature. | Pause / Kill if unexpected |
| **No operators (first run, Dashboard)** | A single confident "Create your first Operator" path — not a wall of zeroed cards. The five KPI slots show a quiet "—". | + Create Operator |
| **Proof pending** | "Settled on-chain · attestation pending." Never implies completeness. | Verify (when ready) |

Design rule: an empty state is a **promise about how the product behaves**, not an apology for
missing data.

---

## 12. Design system (hi-fi ready)

Tokens are carried verbatim from the PRD so the docs do not drift; they are defined once,
centrally, and components never hardcode raw values.

### 12.1 Color
Near-monochrome, white-first. Color carries **meaning only** (state + one accent). Light mode
only.

| Role | Token | Use |
|------|-------|-----|
| Canvas | `#FFFFFF` | Page background |
| App shell / sunken | `#FAFBFC` | Sidebar, chrome, sunken areas |
| Surface / card | `#FFFFFF` + 1px border | Cards sit on canvas via border, not shadow |
| Border (light) | `#ECEDEF` | Primary structural line |
| Border (strong) | `#DDE0E3` | Emphasis dividers, table rules |
| Text — ink | `#15181C` | Headlines, key numbers |
| Text — secondary | `#5B6068` | Body, labels |
| Text — tertiary | `#8A9099` | Meta, captions, placeholders |
| **Accent (single)** | `#4F46E5` | Links, active nav, focus ring, selection, primary data line. **Sparingly.** |
| Primary action | `#15181C` (ink) | Primary buttons are ink-black; accent reserved for active/links |
| SAFE / positive | `#15803D` | Settled, healthy ROI, verified outcome |
| WARN / caution | `#B45309` | Near-cap, needs-human, pending |
| DANGER / negative | `#DC2626` | Kill switch, rejected spend, missed grade |

Rules: **no gradients, no glassmorphism, no neon, no emoji.** Semantic colors are for state only;
the accent is for interaction only. Structure comes from 1px borders + spacing, never heavy
shadow.

### 12.2 Typography
- **Inter** — UI & body. **JetBrains Mono** (or equivalent, tabular figures) — all numbers,
  money, addresses, IDs, status chrome.
- **Scale:** Display 36/40 · H1 28/34 · H2 22/28 · H3 18/24 · Body 15/22 · Small 14/20 · Caption
  12/16 · Mono-data 14/20. Prose gets generous leading; data tables get tight leading.
- **Tabular figures everywhere numbers align** (KPIs, tables, budget meters). Money always mono.

### 12.3 Spacing & layout
- **4px base scale:** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64. Density is a feature.
- **Grid:** 12-column fluid; app content max-width ~1280px; sidebar 240px (rail 64px); Operator
  Detail uses a 64/36 main/rail split that collapses to a single column below ~1024px (rail moves
  above the main column; Mandate + Kill stay first so control leads).
- **Page padding:** 32px desktop, 16px mobile. Section rhythm: 24–32px between modules.

### 12.4 Cards
Border-driven. 1px `#ECEDEF` border, `#FFFFFF` fill, **radius 8–10px**, padding 16–24px,
**whisper shadow only** (`0 1px 2px rgba(20,24,28,0.04)`; one heavier step for overlays). No
floating, no glass. A card's header is a small uppercase mono/secondary label; its body is the
data. Cards never use color fills except a 1px accent left-border for a *selected* state.

### 12.5 Tables
The product's workhorse (portfolio, spend ledger, vendor library). Dense rows (40–44px), 1px
`#ECEDEF` row rules, mono tabular figures right-aligned for numerics, left-aligned text columns,
sticky header (uppercase 12px secondary). Row hover = `#FAFBFC`. Inline actions reveal on hover /
are always present on touch. Status rendered as pills (§12.7). No zebra striping — borders do the
separation.

### 12.6 Buttons
- **Primary:** ink `#15181C` fill, white text, radius 6–8px, height 36/40px. One per surface.
- **Secondary:** white fill, 1px `#DDE0E3` border, ink text.
- **Ghost/tertiary:** text-only, accent on hover.
- **Destructive (Kill):** danger `#DC2626` — used *only* for revoke. It is the only red button in
  the product, which makes it unmistakable. Requires a deliberate confirm that states
  irreversibility.
- Focus: 2px accent ring, always visible for keyboard.

### 12.7 Status indicators
A single consistent **pill** system, reused everywhere a state appears (Operator state, spend
state, outcome state). Mono caps text, 1px border, tinted-on-light fill at low saturation, a
leading dot:

| Domain | States → color |
|--------|----------------|
| Operator | Active (accent/ink dot) · Paused (tertiary) · Frozen (warn) · Revoked (danger) · Exhausted (tertiary) · Completed (positive) |
| Spend | Auto-approved (positive) · Needs-human (warn) · Rejected (danger) · Settled (positive) · Failed (tertiary) |
| Outcome | Claimed (tertiary) · Verified (positive) · Missed (danger) |

Color is never the *only* signal — every state has a distinct label and dot shape/position for
accessibility.

### 12.8 Icons
**Lucide line icons**, 1.5px stroke, used functionally and sparingly — never decorative, never
emoji. Consistent 16/20px sizes. The activity event marks (§8.2) are a small, fixed, custom set,
monochrome, distinguishable by shape not color.

### 12.9 The Enforcement Mark (signature component)
A small inline component: a 1px line check + the mono micro-label `enforced on-chain` /
`attested` / `verify`. Ink or positive at rest; the label can link to evidence. **Strictly
reserved** for facts that are actually guaranteed (a ceiling, a settled spend, a proof layer).
Never on a claim, a projection, or anything pending (pending uses the warn "•••" treatment). This
is the one component allowed to feel quietly special; it is the visual atom of trust.

### 12.10 Budget meter (signature component)
A horizontal bar: spent (ink) / remaining (light) against the ceiling, with mono `$spent /
$ceiling` and a runway caption. Crosses to **warn** at the 80% threshold and **danger** approach
near the ceiling. The meter is the single most-repeated "show the walls" element — it appears on
the hero, every Operator card, the portfolio table, and the Mandate rail, always identical.

### 12.11 Motion
Purposeful only. Motion exists to show **real change**: a value updating, an event arriving, a
check resolving, a status flipping. **Durations** 120–240ms, **easing** standard ease-out;
overlays 200ms. **Never** animate to manufacture drama or fake "thinking." Respect
`prefers-reduced-motion` (cross-fade instead of movement). The Gate's check-resolution and the
budget-meter tick are the two "hero" motions and must feel crisp, not theatrical.

### 12.12 Accessibility & data formatting
- WCAG **AA** contrast on the light palette; full keyboard operability; the kill switch and all
  statuses are perceivable without color (label + dot + shape).
- **Money:** mono, tabular, explicit currency, consistent precision. **Addresses/IDs:** mono,
  truncated, copy affordance + verify link. **Timestamps:** relative for recency ("8s ago"),
  absolute on hover. **Confidence:** calibrated value/bar, never styled as certainty.

### 12.13 Voice & content
Plain, precise, unhyped. "47 qualified leads · $212 spent · $4.51 / lead," never "🚀 Crushing
it!". No emoji, no false urgency, no hype. Numbers carry the message; copy gets out of the way.
Errors and limits are stated honestly and specifically.

---

## 13. Component inventory (for the design library)

Build once, reuse everywhere (no one-off UI). Each maps to a section above.

- **KPI Stat** (number + label + trend) — Dashboard hero.
- **Budget Meter** (§12.10) — ubiquitous "show the walls."
- **Enforcement Mark** (§12.9) — the trust atom.
- **Status Pill** (§12.7) — every state.
- **Operator Card** — portfolio cell with meter + inline pause/kill.
- **Activity Event Row** (§8) — the narrative unit, expandable to reasoning + proof.
- **Spend/Policy Ledger Row** — request + verdict + reason + proof.
- **The Gate** (§7) — the signature enforcement visualization.
- **Proof Receipt** (§9) — four-layer ladder, plain-first, shareable.
- **Track Record / Reputation panel** (§10) — verified vs claimed + calibration + history.
- **Mandate panel** — budget meter + enforced Laws + revoke.
- **Kill Switch** — the lone destructive control, deliberate confirm.
- **Async-state set** — loading skeleton / empty / error, consistent and never fabricated.

---

## 14. How this delivers the four feelings (traceability)

| Feeling | Primary carriers |
|---------|------------------|
| **Control** | The Mandate always in view (§6.1 rail, §12.10 meter) · Kill Switch ≤2 taps everywhere (§4.3) · timelocked expansion as reassurance (§6.3) |
| **Trust** | The Enforcement Mark (§12.9) · the Gate (§7) · the Proof receipt + shareable proof (§9) · honest empty/idle states (§2, §11) |
| **Visibility** | The narrative Activity timeline (§8) · the Dashboard live pulse (§5) · real-only events (§2.4) |
| **Accountability** | The Track Record graded vs reality (§10) · the audit-bundle export (§9.4) · verified-vs-claimed everywhere |

The product never says "trust the AI." It shows the walls, proves the work, and grades the
outcomes — and lets the user end it in one tap. That is the whole experience.

---

*End of Product Experience Specification v1.0. This is the source of truth for UX, UI, layout,
hierarchy, and interaction. Hand it to a senior product designer; it should be sufficient to
begin high-fidelity design without re-deciding the experience. The four feelings in §0 are the
bar every screen is graded against.*
