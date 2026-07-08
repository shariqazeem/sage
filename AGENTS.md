# Sage

> Canonical product specification. This file is the single source of truth for
> what Sage is, what it must not do, and the rules every contributor (human or
> agent) follows. When code and this document disagree, this document wins —
> update it deliberately, never casually.

---

## 1. Product thesis

Sage is an autonomous AI agent that **investigates crypto tokens launched within
the last 72 hours and produces verifiable, gradable verdicts.**

A user submits a freshly launched token. Sage performs an investigation backed by
observable, on-chain and off-chain evidence, and returns exactly one verdict:

- **SAFE** — no disqualifying evidence found within the investigation window.
- **RISKY** — material risk signals present; proceed only with caution.
- **SCAM** — strong evidence of intent to defraud or rug holders.

Two properties make Sage different from a "rug checker":

1. **Verifiability.** Every verdict cites the concrete evidence and actions that
   produced it. A third party can replay the reasoning and reach the same place.
2. **Accountability.** Every verdict is graded later against what actually
   happened on-chain (see §6). Sage builds a public, falsifiable track record
   instead of unaccountable opinions.

The product is intentionally narrow. Sage is not a portfolio tool, a price
oracle, a trading bot, or a general chat assistant. It investigates new tokens
and is judged on whether its verdicts hold up.

---

## 2. Scope restrictions

**Sage only investigates tokens launched within the last 72 hours.** This is a
hard product boundary, not a default.

- Eligibility is defined by the token's **first observable on-chain launch
  event** — the earliest of first liquidity provision or first mint/transfer
  that constitutes the launch — falling inside a **rolling 72-hour window**
  measured from the moment of investigation.
- A token whose launch event is older than 72 hours is **out of scope** and must
  be rejected before any investigation work begins. Sage does not produce a
  verdict for out-of-scope tokens.
- The 72-hour rule exists because Sage's value is catching fraud in the window
  where holders are most exposed and least informed. Widening the window dilutes
  the thesis; do not widen it without changing this document first.
- The eligibility check is a precondition of every investigation and must be
  enforced server-side. It is never assumed, inferred from user claims, or
  skipped for convenience.

---

## 3. Required integrations

Sage is built on a fixed set of integrations. These are requirements, not
suggestions. Adapters must not silently fall back to mocks in production paths.

| Integration                 | Role                                 | Notes                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **x402**                    | Payment / metering rail              | Investigations are paid actions, settled over the x402 HTTP payment protocol. Pricing and settlement flow through x402.                                                                                                                     |
| **ERC-8004**                | On-chain agent identity & reputation | Sage's agent identity and its verdict track record are anchored to the ERC-8004 standard so reputation is portable and verifiable.                                                                                                          |
| **LazAI**                   | Verifiable inference / data layer    | Investigation reasoning and data attestations are produced through LazAI so verdicts are backed by verifiable computation, not opaque calls.                                                                                                |
| **Metis**                   | Default chain                        | Metis is the **default** network for investigations and on-chain anchoring. New tokens are investigated on Metis unless an explicitly supported alternative is selected.                                                                    |
| **GOAT-compatible adapter** | Tooling abstraction                  | All blockchain tool access goes through a **GOAT-compatible adapter interface**. Chains, wallets, and on-chain actions are consumed through this abstraction so additional chains/tools can be added without rewriting investigation logic. |

Rules:

- **Metis is the default.** Any network selection logic defaults to Metis.
- **Everything on-chain goes through the GOAT-compatible adapter.** No direct,
  ad-hoc chain calls in feature code — they must be expressible as adapter tools.
- Integrations are injected behind interfaces so they can be tested in isolation.

---

## 4. Design system rules

Sage's interface is a **Bloomberg-terminal aesthetic**: dense, monochrome,
information-first, and built out of borders rather than decoration. The design
tokens below are defined in `src/app/globals.css` and are the only source of
these values — never hardcode hex values in components.

### Color

| Token       | Value     | Use                       |
| ----------- | --------- | ------------------------- |
| Deep ink    | `#0A0E14` | Primary background        |
| Paper white | `#F8F9FA` | Primary foreground / text |
| SAFE        | `#10B981` | SAFE verdict only         |
| RISKY       | `#F59E0B` | RISKY verdict only        |
| SCAM        | `#EF4444` | SCAM verdict only         |

The verdict colors are reserved for verdicts and verdict-adjacent state
(success/warning/error). Do not repurpose them as generic accents.

### Typography

- **Inter** — UI and body text (`--font-sans`).
- **JetBrains Mono** — data, addresses, labels, numbers, terminal chrome
  (`--font-mono`). Numeric data uses tabular figures for alignment.

### Hard constraints

- **No gradients.** Flat fills only.
- **No glassmorphism.** No blur, no translucency-as-decoration.
- **No emoji.** Use line icons (lucide) where an icon is needed.
- **Border-driven UI.** Structure and separation come from `1px` borders and
  spacing, not shadows or background contrast tricks.
- **Corner radius is 2–4px only.** The radius scale is clamped to this band; do
  not introduce pill shapes or large rounded cards.

If a design choice cannot be expressed within these constraints, the constraint
wins. Reach for density and clarity, not ornament.

---

## 5. Investigation feed rules

While an investigation runs, Sage streams an **investigation feed** — a live log
of what the agent is doing. The feed is the user's window into the agent's work
and a core trust mechanism. It is governed by two non-negotiable rules:

1. **Every feed event must correspond to a real, observable action.** A feed
   event is emitted only when the agent actually performs the action it
   describes (a query was made, a contract was read, a heuristic was evaluated, a
   source was fetched). Each event should be traceable to the underlying call or
   evidence.
2. **Never fabricate progress events.** Do not emit decorative "thinking…",
   fake step counters, simulated delays, or placeholder progress that does not
   map to real work. No invented timings, no staged drama. If nothing is
   happening, the feed says nothing is happening.

The feed exists to make the investigation auditable. A fabricated feed is worse
than no feed because it manufactures false confidence. When in doubt, emit fewer,
truer events.

---

## 6. Reputation rules

Sage is accountable for its verdicts. Reputation is earned by being graded
against reality, not by self-assertion.

### T+30 grading methodology

- Every issued verdict is **re-evaluated 30 days after issuance** (T+30) against
  what actually happened to the token on-chain during that window.
- The grade compares the verdict to observable outcomes (e.g. liquidity pulled,
  contract drained, honeypot behavior, ownership abuse, or — conversely — a
  token that behaved normally). A SCAM call on a token that rugged is correct; a
  SAFE call on a token that rugged is a miss.
- Grades are aggregated into Sage's public track record and anchored to its
  ERC-8004 identity (see §3). The track record is the reputation; nothing else
  counts.
- Grading is automated and deterministic where possible: the same inputs must
  produce the same grade so the record is auditable.

### Required verdict fields (for future grading)

Every verdict Sage issues **must** capture the fields below at issuance time so
it can be graded fairly at T+30. A verdict missing any required field is invalid.

| Field                            | Why it's required for grading                                 |
| -------------------------------- | ------------------------------------------------------------- |
| `verdict`                        | The call being graded: `SAFE` / `RISKY` / `SCAM`.             |
| `tokenAddress`                   | Subject of the verdict.                                       |
| `chainId`                        | Network the token lives on (default Metis).                   |
| `launchTimestamp`                | Proves the token was in scope (≤ 72h) at issuance.            |
| `issuedAt`                       | T+0; the anchor from which T+30 is computed.                  |
| `gradeDueAt`                     | `issuedAt + 30 days`; when grading runs.                      |
| `evidence[]`                     | The observable evidence cited; lets graders replay reasoning. |
| `confidence`                     | Sage's stated confidence; calibration is graded over time.    |
| `modelVersion` / `rubricVersion` | Which Sage produced it, so regressions are attributable.      |

These fields are the contract between "issuing a verdict now" and "grading it
later." Do not issue a verdict that cannot be graded.

---

## 7. Coding standards

- **Strict TypeScript.** `strict` mode stays on. No `any` as an escape hatch, no
  silencing the type checker with `// @ts-ignore`. Model the domain with types;
  prefer discriminated unions and exhaustive `switch` checks.
- **Server-first architecture.** Default to React Server Components and
  server-side execution. Reach for `"use client"` only where genuine
  interactivity requires it, and keep client components small and at the leaves.
  Secrets, integrations, eligibility checks, and investigation logic run on the
  server, never the client.
- **Reusable components.** Build composable, presentational primitives (e.g. the
  async-state patterns in `src/components/states`, the verdict primitives) and
  reuse them. No copy-pasted one-off UI. Design tokens come from the theme, not
  inline values.
- **Test coverage required for core logic.** Core logic — eligibility, the
  verdict model, grading, adapters, and the state machines that drive UI — must
  have unit tests (Vitest). User-facing flows are covered by Playwright E2E
  tests. Don't ship core logic without tests.

### Quality gates

The project must always satisfy:

```bash
npm run lint        # ESLint (next/core-web-vitals + typescript, Prettier-aware)
npm run typecheck   # tsc --noEmit, strict
npm run test        # Vitest unit/component tests
npm run test:e2e    # Playwright E2E
npm run build       # Production build
```

`npm run format` / `npm run format:check` keep formatting consistent (Prettier).

---

## 8. Project layout

```
src/
  app/                 # Next.js App Router (server-first)
    layout.tsx         # Root layout, fonts (Inter + JetBrains Mono), metadata
    page.tsx           # Homepage (wordmark, thesis, placeholders)
    globals.css        # Design tokens + base layer (the design system)
  components/
    ui/                # shadcn/ui primitives
    states/            # Reusable loading / empty / error / success patterns
    verdict-badge.tsx  # Verdict primitive (SAFE / RISKY / SCAM)
  lib/
    utils.ts           # cn() and shared helpers
    verdicts.ts        # Verdict taxonomy + metadata
e2e/                   # Playwright tests
```

---

## 9. Current phase — Phase 0.1 (foundation only)

This repository is at **Phase 0.1: foundation**. The following are intentionally
**not built yet** and must not be added under this phase:

- Business logic, the investigation engine, or the agent loop.
- Supabase / databases / persistence.
- Blockchain integrations, wallets, or live on-chain calls.
- Payments (x402 settlement) or any real metering.
- Real verdict issuance, the feed runtime, or grading jobs.

Phase 0.1 delivers: the app shell, tooling (Next.js 15, TypeScript, Tailwind,
shadcn/ui, Vitest, Playwright, ESLint, Prettier), the design system, reusable
async-state UI patterns, and a placeholder homepage. The sections above are the
specification those later phases build toward.
