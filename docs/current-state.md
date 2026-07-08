# Deputy — Honest Current State

> No marketing. No aspiration. This is what is **actually in the repo right now**, what works,
> what's faked, and what doesn't exist. Verified against the code on 2026-06-21, not from memory.
> Read this before any demo so we never over-claim.

---

## TL;DR (the one honest paragraph)

We have **two things that both work but are not connected to each other**: (1) a genuinely
polished, fully-navigable **Next.js frontend running 100% on hardcoded mock data**, and (2) a
separate, **well-tested Foundry smart contract** that really does enforce the spending policy.
**There is no AI, no backend, no deployment, no wallet, and none of the four named integrations
(x402 / ERC-8004 / LazAI / Metis) exist in code** — they appear only as footer text. So: a
*convincing demo shell* + a *real enforcement core*, sitting in two piles that have never talked
to each other. **It is not yet a working product.**

Rough honest split: **~80% of a 4-minute demo, ~20–25% of an actual end-to-end product.**

---

## 1. What actually works today (real, you can show it)

- **The frontend runs** (`npm run dev`) and is fully navigable: `/` → `/dashboard` → `/create`
  → `/operators/launch-growth`. Typecheck ✓, lint ✓, renders desktop + mobile, no console
  errors.
- **The design is genuinely production-grade.** The Operator Detail page, the Gate modal, the
  create flow, the dashboard — these look like a real, premium product. This is the strongest
  asset we have.
- **The Gate animation works** as an interaction: click a scenario, the checks resolve in
  sequence, you get "Rejected by policy → No funds moved → Enforced on-chain," and the kill
  switch cascades the page to a revoked state. It is a strong, memorable demo moment.
- **The contracts are real and tested.** `contracts/` is a Foundry project where `PolicyVault`
  genuinely enforces G1–G4 (budget ceiling, vendor allowlist, per-tx + velocity caps, terminal
  revoke). **35/35 tests pass; `forge build` has zero warnings.** This is real, auditable logic.

## 2. What is mock / faked / hardcoded (be specific — this is most of it)

- **All operator data is hand-written fiction** in `src/lib/deputy/mock-data.ts` (3 operators).
  The outcomes, the "Memory" learnings ("Base founders reply 2.3× more often"), the "Reasoning"
  timeline, the activity, the track record, the ROI — **all authored strings**. None of it was
  produced by anything.
- **There is no AI in the "AI worker."** No LLM is called anywhere. No agent loop exists. The
  "autonomous worker" is, in code, a set of static objects. Nothing proposes, decides, or acts.
- **The Gate evaluates nothing.** `gate-replay.tsx` runs hardcoded scenarios with a literal
  `failAt` index and `setTimeout` reveals. It is a scripted animation, not a policy check. The
  tx refs it shows ("metis 0x7b1e…c92", "0x9f2c…a41") are **fake strings**.
- **The kill switch is a React `useState` boolean.** It revokes nothing on any chain.
- **"Deploy worker"** (`create-operator.tsx`) is a 2-second `setTimeout` that redirects to the
  existing mock operator. It deploys nothing and saves nothing.
- **"Enforced on-chain", "attested", "Proof"** are decorative labels. The Proof links have no
  `href` and go nowhere. Nothing is on a chain or attested.
- **No persistence.** Refresh = everything resets. Created operators are not saved (you always
  land back on the one mock operator).

## 3. What exists but is NOT connected

- **The contracts** (`contracts/PolicyVault.sol` etc.) implement the real enforcement and pass
  tests — but they are **not deployed to any network** (not even local anvil by default), there
  is **no ABI in the frontend**, and **the frontend never references them** (verified: grep for
  `PolicyVault`/`.abi`/`contracts/` in `src/` returns nothing). The "AI proposes, chain
  enforces" loop does not exist end-to-end anywhere. The frontend Gate and the on-chain Gate are
  two separate implementations of the same idea that have never met.

## 4. What does NOT exist in code at all (zero lines)

| Claimed / implied | Reality in code |
|-------------------|-----------------|
| **x402** payments | **0 lines.** Footer text only. |
| **ERC-8004** identity/reputation | **0 lines.** Footer text only. |
| **LazAI** attestations | **0 lines.** Footer text only. |
| **Metis** deployment | **Not deployed anywhere.** |
| Wallet connect / tx signing | None. No viem/wagmi/ethers in `package.json`. |
| Any LLM / agent loop | None. No `@anthropic`/`openai` dependency. |
| Backend / API / database / auth | None. No `src/app/api`, no DB, no server actions. |
| Real-time / streaming | None. |
| Frontend tests | None for the Deputy app (one Playwright test, and it covers the old `/sage` page). |

## 5. Honest completion estimate

- **As a demo (the 4-minute judge path):** ~**80%**. The shell is strong and the story lands.
  The missing 20% is the one thing that matters most: making a single moment *actually real*
  (the Gate backed by a real on-chain tx). Right now if a judge asks "is this actually
  on-chain?" the honest answer is **no, not yet** — the contract exists but the demo doesn't
  use it.
- **As a real product (end-to-end):** ~**20–25%**. The genuinely hard parts are all unbuilt: a
  real autonomous loop (LLM proposing spends), real x402 settlement, real attestation, on-chain
  deployment + wiring, and the unsolved **oracle problem** (verifying that an "outcome" is real)
  that the whole reputation thesis depends on.

## 6. The most important honest risks

1. **"Enforced on-chain" is currently a claim, not a fact.** This is the core of the pitch and
   it is the biggest gap. Closing it (deploy the vault + have the Gate call it) is the single
   highest-leverage task.
2. **"Autonomous AI worker" is aspirational** — there is no AI. For a demo this is survivable if
   we don't over-claim; for the product it's the hardest unbuilt piece.
3. **Integration breadth is zero.** If judges score "did you use the sponsor tech," we currently
   score nothing on x402 / ERC-8004 / LazAI / Metis beyond name-dropping.
4. **Nothing persists**, so the create→operator flow is an illusion (always the same mock).

## 7. What's genuinely strong (fair credit)

- The **smart-contract enforcement logic is real, tested, and the hardest-to-fake part** — it's
  the actual moat made concrete.
- The **frontend design/UX is excellent** and demo-ready.
- The **strategy and specs are thorough** (PRD, architecture, protocol, experience spec) — we
  know exactly what we're building.
- The **Gate is a strong, memorable concept** — the demo has a clear wow moment.

## 8. The single most important next step

Make **one** moment actually real: deploy `PolicyVault` to a local anvil (or Metis Sepolia),
and have the Operator Detail page **read live vault state** + have the Gate send a **real**
`requestSpend` so the rejection and "No funds moved" are backed by an actual transaction. That
one change converts the pitch from "nice mockup" to "this actually works," which is the
difference between a forgettable demo and a winning one.

---

*Honest snapshot, 2026-06-21. If any of this changes, update this file — it's the one document
that should never flatter us.*
