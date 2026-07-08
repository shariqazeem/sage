# Deputy — System Architecture & Architecture Decision Record (ADR)

> **Codename:** Deputy · **Category:** Autonomous Economic Workers
> **Status:** Draft v1.0 (architecture baseline) · **Owner:** Principal Systems Architecture
> **Companion:** [Deputy PRD](deputy-prd.md)
> **Audience:** Staff/senior engineers and security reviewers. This document is detailed
> enough to begin implementation without inventing major architecture decisions. It specifies
> structure, boundaries, trust, and the load-bearing decisions — not code.

---

## 0. The one idea this architecture is built to defend

> **The model is compromised. The LLM is jailbroken. The operator is malicious. The user
> prompt is adversarial. The guarantees still hold.**

This is not a caveat — it is the **central design assumption**. Every boundary below is drawn
so that the four hard guarantees survive total compromise of the AI and most of the
off-chain stack:

| # | Guarantee | Enforced by | Survives compromise of |
|---|-----------|-------------|------------------------|
| G1 | Cannot exceed budget | On-chain Policy Vault (Metis) | Model, runtime, backend, DB, frontend |
| G2 | Cannot pay unapproved vendors | On-chain allowlist (Merkle root) | Model, runtime, backend, DB, frontend |
| G3 | Cannot bypass policy | On-chain caps/velocity + off-chain policy | Model, runtime; degraded-but-bounded if backend |
| G4 | Instant revocation | On-chain kill flag (+ off-chain freeze) | Model, runtime, backend, DB, frontend |
| G5 | Reputation survives upgrades | ERC-8004 stable identity, decoupled from runtime | Runtime/model swaps, platform redeploys |
| G6 | Every action auditable | LazAI attestations + event log + chain anchors | Backend, DB (replayable from canonical sources) |

The governing principle: **capability and custody are separated.** The AI has unlimited
capability to *propose* and zero authority to *move value*. Authority lives in code the AI
cannot reach and cannot rewrite.

---

## Table of contents

1. Architectural overview & principles
2. Key Architecture Decisions (ADR-001 … ADR-014)
3. Subsystem catalog (responsibility / inputs / outputs / trust / failure modes)
4. Operator lifecycle (11 stages)
5. Trust model (the most important section)
6. Event architecture (the full event graph)
7. Data ownership (where every byte lives and why)
8. Scalability (10 → 10,000 operators)
9. Security review (top 15 attack vectors)
10. Appendices: glossary, open questions, deployment topology

---

## 1. Architectural overview & principles

### 1.1 The four planes

Deputy is organized into four trust planes. Data and authority flow *down*; trust flows *up*.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ PLANE 1 — PRESENTATION (untrusted)                                         │
│ Web app · real-time UI · user wallet signing                               │
└──────────────────────────────────────────────────────────────────────────┘
                 │ requests (authn/authz) ▲ events (read models)
┌──────────────────────────────────────────────────────────────────────────┐
│ PLANE 2 — ORCHESTRATION (trusted-but-bounded)                              │
│ API/BFF · Policy Engine (off-chain) · Payment Engine · Reputation Engine · │
│ Proof Engine · Tool Gateway · Event Bus · Storage/Index · KMS              │
└──────────────────────────────────────────────────────────────────────────┘
                 │ proposals only ▲ outcomes/attestations
┌──────────────────────────────────────────────────────────────────────────┐
│ PLANE 3 — OPERATOR RUNTIME (UNTRUSTED / assumed hostile)                   │
│ Sandboxed agent loop · LLM calls · planning · tool *requests*              │
│  — no keys, no funds, no direct egress, no chain access —                  │
└──────────────────────────────────────────────────────────────────────────┘
                 │ authorized settlement requests ▲ confirmations
┌──────────────────────────────────────────────────────────────────────────┐
│ PLANE 4 — ENFORCEMENT (root of trust)                                      │
│ Metis EVM: Policy Vault · ERC-8004 registries · x402 settlement            │
│ LazAI: immutable attestations / verifiable inference provenance            │
└──────────────────────────────────────────────────────────────────────────┘
```

**The critical inversion:** the Operator Runtime (Plane 3, where the AI lives) sits *between*
orchestration and enforcement but holds **less** authority than the planes around it. It is a
sandboxed proposer with no keys, no funds, no network egress except through a broker, and no
ability to touch Plane 4 directly. Treat it like untrusted user input that happens to be very
articulate.

### 1.2 Principles

1. **Enforcement is on-chain; everything else is convenience.** If a guarantee is only
   enforced off-chain, it is not a guarantee.
2. **Off-chain policy is defense-in-depth, not the floor.** The off-chain policy engine makes
   the system smart, cheap, and fast. The on-chain vault makes it *safe*. The chain is the
   floor; off-chain only ever makes the envelope *tighter*, never looser.
3. **The runtime is hostile.** Zero standing authority. It emits intents; orchestration and
   the chain decide.
4. **Source of truth is plural and domain-specific.** Money → chain. Proof → LazAI/chain.
   Identity/reputation → ERC-8004. App state → the event log. The relational DB is a *mirror*.
5. **Everything is an event.** State changes are immutable, ordered, replayable events. The
   system is reconstructable from canonical sources after any off-chain loss.
6. **Keys are constrained and isolated.** No key in the system can both move funds and bypass
   policy. Proposer keys can request; only the vault authorizes; only owners mutate mandates.

---

## 2. Key Architecture Decisions

Each ADR: **Context → Decision → Consequences → Rejected alternatives.**

### ADR-001 — The AI runtime is untrusted and has zero standing authority
- **Context:** The threat model assumes the model is jailbroken and the operator is malicious.
- **Decision:** The Operator Runtime runs in an isolated sandbox with no secrets, no keys, no
  funds, and no direct network or chain access. It can only emit **proposals** (work intents,
  spend requests, tool requests) to the orchestration plane. All authority is exercised by
  systems the runtime cannot influence.
- **Consequences:** A fully compromised runtime cannot move value, exfiltrate funds, or reach
  vendors directly. Worst case it proposes bad actions that are rejected, or wasteful-but-
  in-policy actions that are bounded by caps. Reasoning quality degrades; safety does not.
- **Rejected:** Giving the agent a funded wallet (custody to a probabilistic system); relying
  on system-prompt guardrails as a security boundary (jailbreaks make them advisory).

### ADR-002 — Two-tier policy: rich off-chain engine + hard on-chain floor
- **Context:** We need expressive policy (categories, velocity, daily caps, human thresholds,
  simulation) and unbreakable guarantees. One layer cannot do both well.
- **Decision:** Every spend passes a **deterministic off-chain Policy Engine** (rich, fast,
  cheap) **and** the **on-chain Policy Vault** (the four hard invariants). The off-chain layer
  can only *narrow* what the chain already permits; it can never widen it.
- **Consequences:** If the off-chain engine is bypassed or buggy, the chain still enforces
  budget ceiling, allowlist, per-tx cap, and revocation. Defense-in-depth without a single
  point of trust.
- **Rejected:** Off-chain-only policy (fails the compromise test); on-chain-only policy
  (too expensive/inflexible for category/velocity logic; poor UX).

### ADR-003 — Per-operator on-chain Policy Vault; proposer keys are not owners
- **Context:** Funds must be enforced, isolated per operator, and never exfiltratable by a
  hot key.
- **Decision:** Each operator is backed by a **dedicated smart account (Policy Vault) on
  Metis**, created by a factory. The vault holds the budget and enforces caps, allowlist, and
  revocation. The backend holds only a **proposer/session key** that can *request* transfers;
  the vault authorizes only transfers that pass on-chain policy. The **owner key** (user, or a
  guardian on the user's behalf) holds revocation and mandate-mutation authority.
- **Consequences:** Stolen proposer keys cannot exceed budget, pay non-allowlisted vendors, or
  act after revocation. Per-operator isolation contains blast radius. Slightly higher on-chain
  cost per operator (mitigated by minimal-proxy factory).
- **Rejected:** One shared treasury with off-chain accounting (a single bug/hack drains
  everyone); EOA per operator holding raw funds (no policy enforcement at the custody layer).

### ADR-004 — Allowlist as on-chain Merkle root; mandate mutation is owner-gated + timelocked
- **Context:** The allowlist *is* the anti-exfiltration control (G2). Whoever can edit it can
  redirect funds. This is the highest-leverage control in the system.
- **Decision:** The vendor allowlist is committed on-chain as a **Merkle root**; each payment
  supplies a proof. Adding/removing vendors or raising budget requires the **owner signature**
  (never the proposer key) and passes through a **short timelock** for additions, with an
  event the user is alerted on. Removals/kill are immediate.
- **Consequences:** A compromised backend cannot add the attacker's address as a vendor. Large
  allowlists are cheap (root + proofs). The timelock gives the user a window to detect and
  veto a malicious addition. Residual risk reduces to social-engineering the owner.
- **Rejected:** On-chain array of addresses (gas-bound at scale); off-chain allowlist (fails
  the compromise test — backend could pay anyone).

### ADR-005 — Instant revocation = off-chain freeze + on-chain kill flag, race bounded by caps
- **Context:** "Instant" must mean instant to the user, but on-chain finality takes seconds,
  creating a revoke-race window.
- **Decision:** Revocation is **dual-path**: (1) the backend immediately freezes proposing and
  invalidates the operator's session (instant, trusts backend), and (2) an **on-chain kill
  transaction** sets the vault's terminal `revoked` flag (durable, trustless). The worst-case
  spend during the race window is bounded by **per-tx cap × velocity limit** over the few
  seconds to finality, and high-value spends already require owner co-sign (ADR-013).
- **Consequences:** Even if the backend is compromised and keeps proposing, the on-chain flag
  is the hard stop; even before it mines, the loss is capped to a small, known amount.
  Revocation is terminal — no state transition leaves `REVOKED`.
- **Rejected:** Off-chain-only freeze (compromised backend ignores it); on-chain-only (UX feels
  laggy and leaves no instant freeze if mining is slow).

### ADR-006 — Event-sourced core with CQRS read models and a transactional outbox
- **Context:** Auditability (G6), replayability after DB loss, and real-time UX all demand an
  immutable history.
- **Decision:** The orchestration plane is **event-sourced**: every state change is an
  append-only event in a durable log (the source of truth for *application* state). Read
  models (dashboard, detail, activity) are **CQRS projections** rebuilt from the log. Chain
  and attestation writes use a **transactional outbox** so off-chain and on-chain stay
  consistent under failure (at-least-once with idempotency).
- **Consequences:** The relational DB becomes a disposable projection; corruption is
  recoverable by replay. Every meaningful action is, by construction, an event that can be
  attested. Adds event-store operational complexity.
- **Rejected:** CRUD-on-RDBMS as source of truth (no native audit trail, hard to reconcile
  with chain, DB corruption = data loss).

### ADR-007 — Plural source of truth, domain-partitioned
- **Decision:** Canonical ownership is split: **money & enforcement state → Metis vault**;
  **identity & reputation → ERC-8004 registries**; **immutable proof (reasoning, receipts) →
  LazAI + content hashes anchored on-chain**; **application state → event log**; the
  **relational DB and cache are mirrors/indexes**, never authoritative for money or proof.
- **Consequences:** Every "what really happened" question resolves to a tamper-evident source
  independent of Deputy's servers. Enables the trust-model answers in §5. Requires reconciliation
  jobs to keep mirrors honest.
- **Rejected:** Database-as-truth (a corrupted/hacked DB could rewrite history and balances).

### ADR-008 — Stable ERC-8004 identity decoupled from mutable runtime → reputation survives upgrades
- **Context:** G5 — upgrading an operator's model/code must not reset its track record.
- **Decision:** Each operator owns a **stable ERC-8004 Identity** (Plane 4). The runtime
  (model version, prompt, tool code) is a **mutable attribute** of that identity, recorded as
  `modelVersion`/`rubricVersion` on every action. Reputation (Reputation Registry) and
  validations (Validation Registry) attach to the **identity**, not the runtime instance.
- **Consequences:** Model swaps, prompt changes, and platform redeploys preserve reputation;
  regressions remain attributable to the exact runtime version that produced each action.
  Reputation is portable beyond Deputy (ERC-8004 is an open standard).
- **Rejected:** Reputation keyed to runtime/deployment (every upgrade orphans history);
  reputation in Deputy's DB (self-asserted, non-portable, not trustless).

### ADR-009 — All chain access via a GOAT-compatible adapter
- **Decision:** No feature code makes ad-hoc chain calls. Every on-chain action (vault ops,
  registry writes, x402 settlement, reads) is expressed as a **tool on a GOAT-compatible
  adapter interface**. Chains, wallets, and actions are consumed through this abstraction.
- **Consequences:** Metis is the default; new chains/tools are added without rewriting
  investigation/spend logic. Uniform place to enforce simulation, gas policy, idempotency, and
  signing. Single seam to audit for chain safety.
- **Rejected:** Direct RPC/SDK calls scattered through services (un-auditable, un-portable).

### ADR-010 — x402 settlement flows only through the vault, idempotent and nonce-guarded
- **Context:** Payments are machine-native (x402): a vendor responds `402` with payment
  requirements; the client pays and retries.
- **Decision:** The **Payment Engine** answers 402 challenges by constructing payments whose
  funds come from the operator's **Policy Vault** — the vault validates recipient (allowlist
  proof), amount (per-tx cap + remaining budget), and revocation **before** releasing value.
  Every payment carries an **idempotency key** and on-chain nonce so retries can't double-spend;
  on-chain accumulated spend is authoritative.
- **Consequences:** A payment is only ever as authorized as the chain permits. Vendor or
  facilitator flakiness yields `FAILED` (no charge) and a safe retry, never a silent double pay.
- **Rejected:** Paying vendors from a hot wallet outside the vault (bypasses G1/G2); trusting
  the facilitator for limits.

### ADR-011 — KMS/HSM key custody, per-operator key isolation, co-signing for high value
- **Decision:** All signing keys live in a **KMS/HSM**; the runtime and application code never
  see private keys. **Proposer keys are isolated per operator** (or per shard) to bound blast
  radius. High-value spend and all mandate mutations require an **owner co-signature**.
- **Consequences:** Key theft from one component cannot drain the platform; co-signing makes
  large unauthorized movements impossible without the owner. Operational complexity in key
  lifecycle/rotation.
- **Rejected:** A single platform hot key (one theft = systemic loss).

### ADR-012 — Tool Gateway brokers 100% of operator egress (prompt-injection containment + DLP)
- **Context:** Prompt injection arrives through the data the operator reads (web pages, vendor
  responses). Containment must assume the operator *will* be injected.
- **Decision:** The runtime has **no direct network access**. Every external action — web
  fetch, vendor API call, x402 payment, data read — is a **request to the Tool Gateway**, which
  enforces an egress allowlist, injects credentials server-side (the model never sees them),
  applies DLP on outbound data, and policy-checks anything that costs money before it reaches
  the Payment Engine.
- **Consequences:** Injected instructions can change what the operator *proposes* but not what
  it can *reach* or *spend*. Credentials and user data cannot be exfiltrated to arbitrary
  endpoints. Single chokepoint to monitor for anomalies.
- **Rejected:** Letting the runtime call the internet/vendors directly (uncontainable injection
  → exfiltration and unbounded action surface).

### ADR-013 — Human-in-the-loop enforced both off-chain and on-chain
- **Decision:** Spends at/above the operator's `humanApprovalThreshold` are gated off-chain
  (queued as `NEEDS_HUMAN`) **and** require an **owner co-signature on-chain** to settle. Below
  the threshold, in-policy spends auto-settle.
- **Consequences:** The most damaging single actions cannot occur without a human signature,
  even if both the runtime and backend are compromised. Throughput cost only on high-value spend.
- **Rejected:** Off-chain-only HITL (compromised backend can skip the human).

### ADR-014 — Reputation is verified-only, deterministically graded, and anti-gamed
- **Decision:** Reputation weights **verified** outcomes only (claimed outcomes never inflate
  it). Grading is **deterministic and versioned** (same inputs → same grade), uses the ERC-8004
  **Validation Registry** for independent validation, and includes duplicate/fraud detection so
  manufacturing junk outcomes lowers efficiency rather than raising reputation.
- **Consequences:** A falsifiable, replayable track record; gaming is economically self-
  defeating. Requires solving outcome verification (the system's hardest open problem — §9, §10
  of PRD, and Appendix B).
- **Rejected:** Self-reported reputation (not trustless, trivially gamed).

---

## 3. Subsystem catalog

Each subsystem lists **responsibility · inputs · outputs · trust assumptions · failure modes.**
"Trust assumptions" states what the subsystem is *allowed* to be trusted for; everything else is
defended against.

### 3.1 Web Frontend (Presentation)
- **Responsibility:** Render dashboard, operator detail, activity, proof, reputation; capture
  user intent; surface real-time events; host the user's wallet-signing interactions (fund,
  revoke, approve, mutate allowlist).
- **Inputs:** Read-model projections (via API/subscriptions); user actions; wallet signatures.
- **Outputs:** Authenticated API requests; signed transactions from the *user's own wallet*.
- **Trust assumptions:** **None for safety.** Holds no secrets. Treated as fully untrusted.
- **Failure modes:** Compromise/XSS/supply-chain → can display false data or attempt to trick a
  user into signing. Mitigated by CSP/SRI, signed releases, wallet showing real tx data, and
  the fact that proofs/balances are independently verifiable on-chain. Cannot move funds.

### 3.2 API / Backend-for-Frontend (Orchestration)
- **Responsibility:** AuthN/Z, request validation, RBAC, orchestrate the lifecycle, mediate
  between frontend, runtime, policy, payment, chain; emit/consume events.
- **Inputs:** Frontend requests; runtime proposals; chain confirmations; events.
- **Outputs:** Commands to subsystems; events; read-model updates.
- **Trust assumptions:** Trusted for **liveness and correct routing**, **not** for upholding
  G1–G4 (those are chain-enforced). Bounded authority via constrained proposer keys.
- **Failure modes:** RCE/compromise → attacker can propose in-policy spend to allowlisted
  vendors up to caps until revocation (residual). Cannot exceed budget, add vendors, or skip
  the kill flag. Mitigated by KMS, per-operator key isolation, co-signing, anomaly detection,
  user revoke.

### 3.3 Operator Runtime (sandboxed agent execution) — UNTRUSTED
- **Responsibility:** Run the agent loop: plan toward the objective, call the LLM, decide next
  actions, and emit **proposals** (work intents, tool/spend requests). Produce reasoning traces.
- **Inputs:** Objective, project context, current budget/policy *view* (read-only), tool
  results returned by the Gateway, LLM completions.
- **Outputs:** Proposals only — never payments, never chain writes, never raw egress.
- **Trust assumptions:** **Zero.** Assumed jailbroken/malicious. No keys, no funds, no egress,
  no chain access. One sandbox per operator; no cross-operator memory or network.
- **Failure modes:** Hallucination/jailbreak/injection → bad proposals, all of which are
  policy-checked and chain-bounded. Worst case: wasteful in-policy spend. Resource abuse
  (loops) is bounded by runtime quotas and velocity caps.

### 3.4 Tool Gateway / Action Broker
- **Responsibility:** The single egress chokepoint. Validate every tool request, enforce the
  egress allowlist, inject vendor credentials server-side, apply DLP on outbound payloads,
  route paid actions to the Policy Engine → Payment Engine, normalize results.
- **Inputs:** Tool requests from the runtime; vendor responses (incl. `402`); credentials (from
  KMS).
- **Outputs:** Sanitized tool results to the runtime; spend requests to the Policy Engine;
  audit events.
- **Trust assumptions:** Trusted to contain egress and protect credentials; not trusted to
  uphold spend limits alone (Policy Engine + vault do).
- **Failure modes:** Bug/bypass → could leak data to an allowlisted endpoint or over-call a
  vendor; bounded by egress allowlist + caps. Outage → operator can't act (liveness only).

### 3.5 Policy Engine (off-chain, deterministic)
- **Responsibility:** Evaluate each spend/action against the full mandate — remaining budget,
  per-tx cap, daily/velocity caps, category rules, vendor allowlist, human threshold,
  revocation — and **simulate** the resulting on-chain settlement before authorizing an attempt.
- **Inputs:** Spend request; current policy + accounting (from chain + read model); operator
  state.
- **Outputs:** `APPROVED` / `AUTO_APPROVED` / `NEEDS_HUMAN` / `REJECTED(reason)`; a settlement
  authorization for approved spends.
- **Trust assumptions:** Trusted to be **deterministic and versioned**; **not** the floor — the
  vault re-checks the hard invariants on-chain.
- **Failure modes:** Bug/compromise that wrongly approves → the on-chain vault still rejects
  out-of-bounds settlement (G1–G4 hold). Bug that wrongly rejects → liveness loss for that
  spend; visible and recoverable.

### 3.6 Payment Engine (x402 settlement)
- **Responsibility:** Handle the x402 flow (`402` challenge → payment → retry); construct
  vault-authorized payments; manage idempotency, nonces, confirmations, retries, refunds; emit
  receipts.
- **Inputs:** Approved spend authorizations; 402 payment requirements; vault state; proposer
  signing (via KMS).
- **Outputs:** On-chain settlements through the vault; settlement receipts; payment events.
- **Trust assumptions:** Trusted for correct settlement mechanics; **not** for limits (vault
  enforces). Proposer key is constrained.
- **Failure modes:** Facilitator/vendor failure → `FAILED` (no charge), safe retry. Double-submit
  → blocked by idempotency + on-chain nonce. Key theft → bounded by vault policy.

### 3.7 Policy Vault & on-chain enforcement (Metis) — ROOT OF TRUST
- **Responsibility:** Hold each operator's budget; enforce G1 (total cap), G2 (allowlist Merkle
  proof), G3 (per-tx cap, velocity accounting), G4 (terminal revoke flag); release funds only on
  authorized, in-policy settlements; expose owner-gated mandate mutation (timelocked additions).
- **Inputs:** Settlement requests (proposer-signed) with Merkle proofs; owner-signed mandate
  changes; kill transactions.
- **Outputs:** Authorized transfers; on-chain accounting; events (anchored truth).
- **Trust assumptions:** **The trust anchor.** Trusted iff the contract is audited, minimal, and
  immutable (with timelocked upgrade governance). This is where trust *concentrates by design*.
- **Failure modes:** Contract bug → highest-severity risk (could break a guarantee) → mitigated
  by audits, formal verification, minimal surface, reentrancy guards, and upgrade timelock.
  Chain congestion → delayed settlement (liveness), not loss.

### 3.8 Identity Service (ERC-8004)
- **Responsibility:** Mint and manage stable operator identities; bind mutable runtime versions
  to the stable identity; serve identity resolution to reputation/proof.
- **Inputs:** Operator creation; runtime version metadata.
- **Outputs:** On-chain identity records; identity references used everywhere.
- **Trust assumptions:** Trusts the ERC-8004 registry on Metis as canonical identity.
- **Failure modes:** Registry/chain unavailability → identity mint deferred (operator stays
  `DRAFT`); existing identities unaffected. Reputation never lost on upgrade (decoupled).

### 3.9 Reputation Engine
- **Responsibility:** Grade outcomes (deterministic, versioned), compute success rate, budget
  efficiency, ROI, calibration; aggregate to the identity; anchor to ERC-8004; run anti-gaming
  (dup/fraud detection, verified-only weighting).
- **Inputs:** Work/spend events; verified outcomes; validations (Validation Registry); grading
  rubric version.
- **Outputs:** Reputation records (on-chain anchored + queryable mirror); grades; alerts.
- **Trust assumptions:** Trusted to compute deterministically; outputs are independently
  recomputable from canonical events (auditable).
- **Failure modes:** Grading bug → versioned and replayable; regrade on fix. Gaming attempt →
  lowers efficiency by construction. Verification gap (the open problem) → outcomes stay
  `claimed`, never silently `verified`.

### 3.10 Proof Engine (attestation, LazAI)
- **Responsibility:** Produce the four-layer proof (proposed → policy-enforced → settled →
  attested); content-address reasoning traces and receipts; write **immutable attestations via
  LazAI**; anchor hashes on-chain; serve verification and shareable proof links.
- **Inputs:** Reasoning traces, policy decisions, settlement receipts, outcome evidence.
- **Outputs:** Attestations; proof records; verification responses; public proof links.
- **Trust assumptions:** Trusts LazAI + chain anchors as immutable; the engine itself need not
  be trusted because attestations are independently verifiable.
- **Failure modes:** LazAI/anchor unavailability → attestation queued; proof shows "attestation
  pending" honestly (never implies full proof). Cannot forge proof for a non-event (proofs map
  to real events only).

### 3.11 Event Bus / Event Store
- **Responsibility:** Append-only, ordered, durable event log (source of truth for app state);
  publish to consumers; power projections, attestation, reputation, real-time, and the
  transactional outbox to chain.
- **Inputs:** Domain events from all orchestration services.
- **Outputs:** Ordered event streams; replay; outbox dispatch.
- **Trust assumptions:** Trusted for durability and ordering within the orchestration plane.
- **Failure modes:** Outage → orchestration halts (liveness); no inconsistent state (events are
  the commit point). Partition → at-least-once + idempotent consumers prevent double effects.

### 3.12 Storage Layer (RDBMS + object store + cache + search)
- **Responsibility:** **RDBMS** — projections/read models, operator metadata, users, accounting
  mirror. **Object store** — large reasoning traces and produced artifacts (hashed for proof).
  **Cache** — hot read models, real-time feed, sessions. **Search/index** — activity/proof query.
- **Inputs:** Events → projections; artifact writes; queries.
- **Outputs:** Fast reads for UI/API.
- **Trust assumptions:** **Mirror/index only.** Not authoritative for money or proof.
- **Failure modes:** Corruption/loss → rebuild projections by replaying the event log and
  reconciling with chain; artifacts are content-addressed so tampering is detectable. No funds
  or proof lost.

### 3.13 Blockchain Access Layer (GOAT-compatible adapter + indexer)
- **Responsibility:** All chain I/O behind the GOAT-compatible adapter: tx construction,
  simulation, gas policy, nonce lanes, multi-RPC redundancy, finality/reorg handling, and a
  chain **indexer** reconciling on-chain truth into read models.
- **Inputs:** Adapter tool calls; chain state/events.
- **Outputs:** Submitted/confirmed txs; normalized chain events into the bus.
- **Trust assumptions:** Trusts Metis finality; uses redundant RPCs to avoid single-provider
  trust.
- **Failure modes:** RPC outage → failover; reorg → wait for finality before treating settled;
  nonce contention → per-operator/lane nonces. Chain truth is authoritative over the indexer.

### 3.14 Key Management (KMS/HSM)
- **Responsibility:** Custody all signing material; sign proposer transactions; enforce per-key
  scope and rotation; never expose private keys to application code or the runtime.
- **Inputs:** Signing requests (scoped, authorized).
- **Outputs:** Signatures.
- **Trust assumptions:** Trusted custody root for *proposer* keys; owner keys live in the user's
  own wallet, never in Deputy.
- **Failure modes:** KMS compromise → attacker gains proposer signing, still bounded by vault
  policy + co-signing; rotate keys, revoke operators. Owner keys are never in scope.

### 3.15 Identity & Access (user auth, RBAC)
- **Responsibility:** Authenticate users; manage sessions; enforce org roles (who can fund,
  steer, approve, kill); link user wallets for on-chain owner actions.
- **Inputs:** Credentials; wallet links; role assignments.
- **Outputs:** Sessions; authorization decisions.
- **Trust assumptions:** Trusted for app-level access; **on-chain owner authority is gated by
  wallet signatures**, not just app roles, for sensitive ops.
- **Failure modes:** Account takeover → in-app actions possible, but mandate mutation/kill
  require wallet signatures; mitigated by MFA and on-chain owner gating.

### 3.16 Observability, Audit & Anomaly Detection
- **Responsibility:** Metrics, tracing, security monitoring; detect spend anomalies (velocity
  spikes, novel vendors-at-edge-of-policy, runtime loops); raise alerts; the event log doubles
  as the audit trail.
- **Inputs:** Events, traces, chain data.
- **Outputs:** Dashboards, alerts, automated freezes on high-severity anomalies.
- **Trust assumptions:** Best-effort detection; not a guarantee (the chain is).
- **Failure modes:** Missed anomaly → still bounded by hard guarantees; false positive → safe
  freeze (liveness cost).

> **Additional subsystems beyond the example list:** Tool Gateway (3.4), Identity Service
> (3.8), Key Management (3.14), Identity & Access (3.15), and Observability/Anomaly (3.16) are
> added because the threat model requires explicit egress containment, key custody, identity
> stability, and detection — they are not optional.

---

## 4. Operator lifecycle (11 stages)

Each stage names the responsible subsystems, what becomes canonical, and the safety property.

| # | Stage | What happens | Canonical writes | Safety property |
|---|-------|--------------|------------------|-----------------|
| 1 | **Create** | User defines project, objective, budget, draft policy (allowlist, caps, threshold). | Event log (`OperatorDrafted`); DB projection. | No identity, no funds yet — nothing to attack. |
| 2 | **Fund** | Budget committed on-chain into a freshly deployed **Policy Vault**; ERC-8004 **identity minted**; allowlist Merkle root set; owner = user's wallet. | Metis (vault, identity, root); event log. | Hard ceiling + allowlist now exist on-chain (G1, G2). Funding itself is receipted. |
| 3 | **Activate** | Owner authorizes start; backend mints a **scoped session/proposer key**; runtime sandbox spun up. | Event log (`OperatorActivated`). | Runtime gets zero authority; key is constrained + isolated. |
| 4 | **Operate** | Runtime plans toward the objective, calls the LLM, decides actions, emits proposals; reasoning traces produced. | Event log (work intents); traces to object store (hashed). | Runtime is sandboxed; proposals carry no authority (ADR-001, ADR-012). |
| 5 | **Spend Request** | A paid action triggers a `SpendRequested` proposal via the Tool Gateway (vendor, amount, purpose, category). | Event log (`SpendRequested`). | No funds move on a request; it is only an intent. |
| 6 | **Policy Evaluation** | Off-chain Policy Engine evaluates the full mandate and simulates settlement → APPROVED / AUTO_APPROVED / NEEDS_HUMAN / REJECTED(reason). | Event log (`SpendApproved`/`SpendRejected`/`SpendNeedsHuman`). | Off-chain narrowing (ADR-002); rejections are first-class evidence. |
| 7 | **Execute** | For approved spend, Payment Engine runs x402 settlement **through the vault**, which re-checks G1–G4 on-chain; high-value needs owner co-sign. | Metis (settlement, accumulated spend). | The chain is the floor — out-of-bounds settlement is impossible even if step 6 was wrong. |
| 8 | **Record** | Work outcome, confidence, receipt, and reasoning are recorded and **attested via LazAI**; outcome marked `claimed`. | Event log; LazAI attestations; anchors on-chain. | Every meaningful action becomes auditable (G6); proofs map to real events only. |
| 9 | **Reputation Update** | On verification/grading, outcomes become `verified`/`rejected`; Reputation Engine recomputes and **anchors to ERC-8004**. | ERC-8004 (reputation/validation); reputation mirror. | Verified-only, deterministic, anti-gamed (ADR-014); attached to the stable identity (G5). |
| 10 | **Revoke** | Owner triggers kill: backend **freezes instantly**; on-chain **terminal revoke** flag set. | Metis (`revoked=true`); event log (`OperatorRevoked`). | Dual-path instant + durable stop; race bounded by caps (ADR-005). |
| 11 | **Terminate** | Operator reaches `REVOKED`/`COMPLETED`/`DEPLETED`; remaining funds withdrawable by owner; record stays fully readable forever. | Metis (sweep to owner); event log. | No further spend possible; history immutable and auditable. |

**Upgrade (cross-cutting):** swapping the runtime/model changes the mutable runtime attribute of
the *same* identity — lifecycle, vault, and reputation are untouched (ADR-008, G5).

---

## 5. Trust model (most important section)

### 5.1 What the user must trust

A short, deliberate list — trust is concentrated here on purpose so it can be audited:

1. **The Metis Policy Vault contract** (and the chain's finality). This is the root of
   safety. Mitigation for *us*: minimal, audited, formally verified, immutable-with-timelock.
2. **The ERC-8004 registries** on Metis for identity/reputation.
3. **LazAI** for immutable attestations / verifiable inference provenance.
4. **Their own wallet/owner key** for revocation and mandate mutation.
5. **Standard cryptography** (signatures, hashes, Merkle proofs).

That is the entire trusted computing base for *safety*. Note what is **absent**: the model, the
runtime, the backend, the database, and the frontend.

### 5.2 What the user does NOT need to trust

- **The LLM / model provider** (OpenAI, Anthropic, any). The model can be wrong or malicious;
  it has no authority.
- **The Operator Runtime.** Assumed hostile by construction.
- **Deputy's backend** for *safety*. It is bounded by constrained keys and on-chain policy.
- **The database / cache.** Mirrors only; rebuildable from canonical sources.
- **The frontend.** Untrusted; holds no secrets; cannot move funds.
- **Deputy the company** to be honest about history — because proof and balances are
  independently verifiable on-chain and via LazAI.

### 5.3 Compromise scenarios — which guarantees remain intact

> The answer is never "the system stops working." It is "these guarantees survive."

| Scenario | What an attacker gains | What still holds | Residual risk |
|----------|------------------------|------------------|---------------|
| **OpenAI/Anthropic down** | Nothing | All of G1–G6. Operator simply produces no new actions → no spend. | Liveness only; can failover to an alternate model (version recorded). |
| **OpenAI/Anthropic compromised (malicious outputs)** | Influence over what the operator *proposes* | G1–G4: bad proposals are policy-checked and chain-bounded; G5/G6 intact. | Wasteful **in-policy** spend to allowlisted vendors up to caps; bounded by per-tx/velocity caps, human threshold, anomaly freeze, revoke. |
| **Operator goes rogue (jailbroken/malicious)** | Full control of the runtime | G1–G4: runtime has no keys/funds/egress; can't exceed budget, pay non-allowlisted vendors, bypass policy, or act after revoke. | Same bounded in-policy waste; reputational. |
| **Database corrupted/lost** | Tampered/missing projections | Money state intact (on-chain); proof intact (LazAI/anchors); identity/reputation intact (ERC-8004); app state replayable from the event log. | Temporary read degradation; rebuild by replay + chain reconciliation. **No funds or proof lost.** |
| **Backend hacked (RCE, proposer key theft)** | Constrained proposer signing | G1 (ceiling), G2 (allowlist — can't add vendors without owner sig + timelock), G4 (revoke flag) all hold; G6 (lies are detectable against on-chain truth). | **In-policy drain** to already-allowlisted vendors up to caps until revocation — the system's worst realistic loss. Bounded by per-op key isolation, co-signing, caps, anomaly freeze, fast user revoke. |
| **Frontend compromised (XSS/supply chain)** | Ability to show false UI / attempt to trick the user | No secrets exposed; cannot move funds; on-chain truth contradicts any lie. | User socially engineered into signing a malicious mandate change — mitigated by wallet showing real tx data + timelock on allowlist additions. |

The shape of every row is the same: **availability may degrade; the four hard guarantees do
not.** The only scenario that can break a *guarantee* (not just availability) is a bug in the
Policy Vault contract — which is exactly why trust is concentrated there and defended with
audits, formal verification, minimal surface, and upgrade timelocks (ADR-003, §9 #7).

---

## 6. Event architecture

Everything meaningful is an event. Events are immutable, ordered, and replayable; they are the
source of truth for application state and the substrate for attestation, projection, real-time
UI, and reputation.

### 6.1 Event catalog (by domain)

| Domain | Events |
|--------|--------|
| **Lifecycle** | `OperatorDrafted` · `OperatorIdentityMinted` · `OperatorActivated` · `OperatorPaused` · `OperatorResumed` · `OperatorCompleted` · `OperatorDepleted` · `OperatorTerminated` |
| **Funding / mandate** | `BudgetAllocated` · `VaultDeployed` · `PolicyConfigured` · `PolicyUpdated` · `AllowlistAdditionProposed` · `AllowlistChanged` · `BudgetToppedUp` |
| **Work** | `WorkActionProposed` · `ActionExecuted` · `ActionCompleted` · `OutcomeRecorded` · `OutcomeVerified` · `OutcomeRejected` |
| **Spend** | `SpendRequested` · `PolicyEvaluationStarted` · `SpendApproved` · `SpendAutoApproved` · `SpendNeedsHuman` · `SpendRejected(reason)` |
| **Human gate** | `HumanApprovalRequested` · `HumanApprovalGranted` · `HumanApprovalDenied` |
| **Payment** | `PaymentInitiated` · `PaymentSettled` · `PaymentFailed` · `PaymentRefunded` |
| **Proof** | `ReasoningAttested` · `ReceiptAttested` · `AttestationWritten` · `AttestationPending` |
| **Reputation** | `ReputationGradeComputed` · `ReputationAnchored` · `ValidationRequested` · `ValidationCompleted` |
| **Budget signals** | `BudgetThresholdReached(80/95%)` · `BudgetDepleted` |
| **Revocation / safety** | `OperatorRevoked` · `OperatorFrozen` · `AnomalyDetected` · `AlertRaised` |

### 6.2 The causal event graph (happy path + branches)

```
OperatorDrafted
   └─▶ BudgetAllocated ─▶ VaultDeployed ─▶ OperatorIdentityMinted ─▶ PolicyConfigured
          └─▶ OperatorActivated
                 └─▶ WorkActionProposed
                        ├─(no spend)─▶ ActionExecuted ─▶ ActionCompleted ─▶ OutcomeRecorded
                        │                                                       └─▶ ReasoningAttested
                        └─(paid)─▶ SpendRequested ─▶ PolicyEvaluationStarted
                                      ├─▶ SpendRejected(reason) ─▶ (operator adapts) ─▶ WorkActionProposed
                                      ├─▶ SpendNeedsHuman ─▶ HumanApprovalRequested
                                      │        ├─▶ HumanApprovalGranted ─▶ SpendApproved
                                      │        └─▶ HumanApprovalDenied ─▶ SpendRejected
                                      └─▶ SpendApproved | SpendAutoApproved
                                               └─▶ PaymentInitiated
                                                      ├─▶ PaymentFailed ─▶ (retry | PaymentRefunded)
                                                      └─▶ PaymentSettled ─▶ ReceiptAttested ─▶ AttestationWritten
                                                                 └─▶ ActionCompleted ─▶ OutcomeRecorded
                                                                          └─▶ BudgetThresholdReached? ─▶ BudgetDepleted?
                                                                                   └─▶ OperatorDepleted

  (verification, async) OutcomeRecorded ─▶ ValidationRequested ─▶ ValidationCompleted
                              └─▶ OutcomeVerified | OutcomeRejected ─▶ ReputationGradeComputed ─▶ ReputationAnchored

  (safety, any time)  AnomalyDetected ─▶ AlertRaised ─▶ (auto) OperatorFrozen
                       User kill ─▶ OperatorFrozen (off-chain, instant) ─▶ OperatorRevoked (on-chain, terminal)
                                          └─▶ OperatorTerminated ─▶ (funds swept to owner)
```

### 6.3 Event rules

- **On-chain vs off-chain truth:** `BudgetAllocated`, `PaymentSettled`, `AllowlistChanged`,
  `OperatorRevoked`, `ReputationAnchored`, `OperatorIdentityMinted` are **chain-anchored**
  (Plane 4 is authoritative). Off-chain events are projections/intents and must reconcile to
  chain truth via the indexer.
- **No fabricated events (from the PRD's authenticity rule):** an event is emitted only when its
  underlying action actually occurred. `SpendRejected` is emitted as readily as `SpendSettled`.
- **Idempotency & ordering:** consumers are idempotent (idempotency keys); the outbox guarantees
  at-least-once delivery to chain/attestation with dedupe.
- **Replay:** any read model, attestation index, or reputation aggregate is reconstructable by
  replaying the log and reconciling with chain.

---

## 7. Data ownership

Where every category of data lives, and the justification. The rule: **the most damaging thing
to forge lives in the most tamper-evident place.**

| Data | Canonical location | Mirror/derived | Justification |
|------|--------------------|----------------|---------------|
| Budget ceiling, accumulated spend, per-tx/velocity state | **Metis vault (on-chain)** | DB accounting mirror | Money must be tamper-proof *and* enforced, not just recorded (G1, G3). |
| Vendor allowlist (Merkle root) | **Metis vault (on-chain)** | DB expanded list for UI | The allowlist is the anti-exfiltration control; off-chain it could be edited by a hacked backend (G2, ADR-004). |
| Revocation flag | **Metis vault (on-chain)** | Cache (instant freeze) | The kill must be enforced where no off-chain compromise can ignore it (G4). |
| Operator identity | **ERC-8004 (on-chain)** | DB index | Stable, portable, verifiable; must survive upgrades (G5, ADR-008). |
| Reputation grades & validations | **ERC-8004 (on-chain anchor)** | Reputation mirror (queryable) | Trustless, portable, not self-asserted; recomputable from events (ADR-014). |
| Reasoning traces & receipts (immutable proof) | **LazAI attestations + on-chain content hashes** | Object store (full blob), DB index | Proof must be immutable and independently verifiable; large blobs stored content-addressed, hash anchored (G6). |
| Application state (all domain events) | **Event log (durable, append-only)** | — | Source of truth for app state; replay enables recovery after any mirror loss (ADR-006). |
| Operator metadata, project info, users, roles | **Relational DB** | Cache | Queryable operational data; not safety-critical; rebuildable from events. |
| Read models (dashboard, detail, activity, proof index) | **Relational DB / search** | Cache | Fast reads; pure projections (CQRS). |
| Hot reads, real-time feed, sessions | **Cache (e.g., Redis)** | — | Latency; fully reconstructable; never authoritative. |
| Large produced artifacts (lead lists, opportunity records) | **Object store (content-addressed)** | Hash anchored for proof | Cheap bulk storage; tampering detectable via hash. |
| Vendor credentials, proposer keys | **KMS/HSM / secrets manager** | — | Never in DB plaintext, never in the runtime; signing happens behind KMS (ADR-011, ADR-012). |
| Owner keys | **User's own wallet (off-platform)** | — | Deputy never custodies owner authority; non-custodial revoke/mutation. |
| Draft form state, ephemeral UI | **Browser** | — | Convenience only; no secrets; no authority. |

**Net effect:** losing or corrupting any *off-chain* store costs availability and rebuild time,
never money, proof, identity, or reputation.

---

## 8. Scalability

Stateless orchestration scales horizontally; the interesting limits are LLM throughput, chain
throughput, key/nonce management, event/projection volume, and real-time fan-out. Bottlenecks by
tier:

| Tier | Dominant cost | First bottleneck | Mitigations |
|------|---------------|------------------|-------------|
| **10 operators** | Per-operator LLM loops; one vault each. | None material — fits a single region, single event store, one indexer. | Keep it simple; per-operator vault via minimal-proxy factory. |
| **100 operators** | LLM cost/concurrency; chain tx volume for settlements. | Proposer-key **nonce contention**; LLM provider rate limits. | Per-operator/shard proposer keys with separate **nonce lanes**; queue-based work scheduling; model-provider pooling/failover. |
| **1,000 operators** | Event/projection volume; settlement throughput; real-time fan-out. | Event-store write amplification; **projection lag**; websocket fan-out; indexer keeping up with chain. | Partition events/read models **by operator**; CQRS with independently scaled projectors; **batch attestations** (Merkle-batch reasoning/receipt hashes to LazAI/chain); subscription fan-out via a pub/sub tier; horizontally scaled runtime workers. |
| **10,000 operators** | Aggregate on-chain throughput, gas, and key custody at scale; attestation write volume; reputation aggregation. | **On-chain settlement throughput / gas** and **KMS signing throughput**; deep reorg handling; cross-operator reporting queries. | Metis L2 keeps fees low; **batch/aggregate settlements** where x402 allows; sharded KMS signing; **roll up attestations** (one anchor per batch, proofs per item); precomputed reputation/portfolio aggregates; multi-region orchestration with regional event stores reconciled to a single chain truth; backpressure + admission control so spend stays bounded under load. |

**Scaling invariants:**
- The **safety path never amortizes correctness for throughput** — batching changes *how* we
  anchor, never *whether* the vault checks G1–G4 per settlement.
- **Per-operator isolation** (vault, key lane, sandbox, event partition) means scaling adds
  independent units rather than a shared hot path.
- The **runtime tier is embarrassingly parallel** and the cheapest to scale; the **chain tier**
  is the hard ceiling and the reason Metis (low-fee L2) is the default.

---

## 9. Security review — top 15 attack vectors

For each: **impact · mitigation · residual risk.** Ordered roughly by severity-after-mitigation.

1. **Policy Vault contract bug (reentrancy/logic error).**
   *Impact:* could break a hard guarantee (worst case in the system — funds drained / cap
   bypassed). *Mitigation:* minimal contract surface, multiple independent audits, formal
   verification of G1–G4, reentrancy guards, immutability with timelocked upgrade governance,
   bug bounty. *Residual:* unknown zero-day in the contract — accepted as the concentrated trust
   anchor; budget heavily for assurance here.

2. **Allowlist poisoning (attacker adds their address as a "vendor").**
   *Impact:* direct fund exfiltration to attacker (defeats G2). *Mitigation:* allowlist mutation
   requires the **owner wallet signature** (never the proposer key) **+ timelock + user alert**
   on additions. *Residual:* social-engineering the owner into signing a malicious addition —
   reduced by wallet showing real data and the timelock veto window.

3. **Backend RCE / proposer-key theft.**
   *Impact:* attacker proposes in-policy spend to allowlisted vendors up to caps. *Mitigation:*
   KMS/HSM custody, per-operator key isolation, co-signing for high value, anomaly-triggered
   freeze, fast user revoke; G1/G2/G4 hold regardless. *Residual:* bounded in-policy drain until
   revocation — the system's worst *realistic* loss.

4. **Revocation race / settlement censorship in the kill window.**
   *Impact:* a few seconds of spend after the user taps kill. *Mitigation:* instant off-chain
   freeze + on-chain terminal flag; worst-case loss bounded by per-tx × velocity caps; owner
   co-sign on high value. *Residual:* small, bounded, known-maximum loss during finality.

5. **Smart-contract upgrade / governance abuse.**
   *Impact:* a malicious upgrade weakens a guarantee. *Mitigation:* upgrade behind a **timelock**
   with user-visible events and (where possible) immutable core invariants; consider
   non-upgradeable vault core with upgradeable periphery only. *Residual:* governance-key
   compromise within the timelock window — detectable and vetoable.

6. **Prompt injection via vendor/web content.**
   *Impact:* operator is steered to propose malicious spend or data exfiltration. *Mitigation:*
   runtime has no egress/keys (ADR-012); Tool Gateway egress allowlist + DLP; on-chain caps and
   allowlist bound any resulting spend. *Residual:* in-policy waste; injected text can't reach
   funds or arbitrary endpoints.

7. **LLM jailbreak / malicious model provider.**
   *Impact:* model bypasses soft rules / emits hostile actions. *Mitigation:* soft rules are not
   the security boundary; the chain is. *Residual:* bounded in-policy waste + reputational; model
   failover available.

8. **Data exfiltration through operator outputs.**
   *Impact:* user data leaked via outbound vendor/tool calls. *Mitigation:* Tool Gateway egress
   allowlist + DLP + scoped, minimized data in the runtime context; no secrets in context.
   *Residual:* in-scope data sent to an already-allowlisted vendor as part of legitimate work.

9. **x402 payment replay / double-spend.**
   *Impact:* paying twice or replaying a payment authorization. *Mitigation:* idempotency keys,
   on-chain nonces, vault-authoritative accumulated spend, facilitator verification. *Residual:*
   negligible.

10. **Outcome/oracle forgery (operator fabricates "verified" outcomes).**
    *Impact:* inflated reputation and ROI lies. *Mitigation:* verified-only weighting,
    independent validation (ERC-8004 Validation Registry), evidence attestation, dup/fraud
    detection, claimed-vs-verified separation. *Residual:* genuinely subjective outcomes are hard
    to verify objectively — the platform's hardest open problem (Appendix B).

11. **Frontend compromise (XSS / dependency supply chain).**
    *Impact:* phishing, false UI, tricking a user into signing. *Mitigation:* CSP, SRI, signed/
    pinned releases, wallet shows real tx data, proofs/balances independently verifiable.
    *Residual:* user tricked into signing — bounded by timelock + on-chain veracity.

12. **Reputation gaming / Sybil identities.**
    *Impact:* fake track record. *Mitigation:* verified-only metrics, cost/stake to mint
    identity, dup detection; gaming lowers efficiency by construction. *Residual:* sophisticated
    collusion over time.

13. **Chain reorg / RPC manipulation / eclipse.**
    *Impact:* false confirmations, inconsistent accounting. *Mitigation:* wait for finality
    before treating settled, redundant multi-provider RPC, indexer reconciliation, chain truth
    authoritative. *Residual:* deep reorg (rare on Metis) delays, doesn't lose.

14. **DoS on runtime / backend / event bus.**
    *Impact:* liveness loss (operators stall). *Mitigation:* rate limits, autoscaling, per-
    operator isolation and quotas, admission control/backpressure. *Residual:* degraded
    availability — **never** a safety failure; no spend occurs while stalled.

15. **Privilege escalation / insider (org RBAC bypass or rogue Deputy engineer).**
    *Impact:* unauthorized fund/steer/kill, or a malicious runtime deploy. *Mitigation:*
    least-privilege RBAC, **on-chain owner gating** for sensitive ops (app role alone is
    insufficient), signed/reviewed deploys; crucially, the runtime has **no authority** so even a
    malicious deploy is bounded by the chain. *Residual:* insider with the owner wallet — outside
    Deputy's control by design (non-custodial).

**Honorable mentions (tracked, lower severity):** stuck/locked vault funds (mitigated by owner
sweep on terminate); gas griefing (gas policy + sponsored relays); KMS regional outage (multi-
region custody); attestation-layer (LazAI) downtime (queued, "pending" shown honestly).

---

## Appendix A — Glossary

- **Policy Vault** — per-operator smart account on Metis that custodies budget and enforces
  G1–G4. The root of trust.
- **Proposer / session key** — constrained backend signing key that can *request* vault
  settlements but cannot mutate the mandate or exceed policy.
- **Owner key** — the user's own wallet; holds revocation and mandate-mutation authority.
  Never custodied by Deputy.
- **Mandate / Policy** — the enforced spending rules (ceiling, allowlist root, per-tx/velocity
  caps, human threshold, revoke flag).
- **Tool Gateway** — the sole egress chokepoint brokering every external action the runtime
  attempts.
- **Off-chain floor vs on-chain floor** — off-chain policy can only *narrow* the on-chain
  envelope; the chain is the hard floor.
- **CQRS / event sourcing** — append-only event log as source of truth; read models are
  projections.
- **x402 / ERC-8004 / LazAI / Metis** — payment rail / identity & reputation registries /
  immutable attestation & verifiable inference / default EVM enforcement chain.

## Appendix B — Open questions (carried, owners to assign)

1. **Outcome verification (oracle problem).** How to deterministically verify a "qualified
   lead" is real without a trusted human grader. Hardest unsolved item; gates reputation
   integrity (ADR-014, vector #10).
2. **Regulatory posture of custody.** Funding/holding/disbursing user budgets may implicate
   money-transmission/custody rules; the per-operator vault is designed to keep owner authority
   non-custodial — needs legal sign-off before GA.
3. **x402 vendor coverage & vendor↔address binding.** The allowlist is only as strong as our
   ability to bind a real vendor to a payment address; thin x402 coverage at launch.
4. **Velocity accounting on-chain vs off-chain.** Exact split of which rate limits are enforced
   in the vault vs the Policy Engine (cost vs strength trade-off).
5. **Attestation batching vs per-action immediacy.** How aggressively to batch LazAI/chain
   anchors at 10k operators without weakening per-action auditability.

## Appendix C — Deployment topology (reference)

- **Plane 1:** CDN-fronted web app; CSP/SRI; wallet integration for owner signatures.
- **Plane 2:** stateless API/orchestration services (autoscaled, multi-region); durable event
  store; CQRS projectors; RDBMS + cache + object store + search; KMS/HSM; chain indexer; Tool
  Gateway; Policy/Payment/Reputation/Proof engines as independently scalable services.
- **Plane 3:** per-operator runtime sandboxes (isolated, no egress except via Tool Gateway,
  ephemeral, resource-quota'd), pooled and horizontally scaled.
- **Plane 4:** Metis (Policy Vault factory + per-operator vaults, ERC-8004 registries, x402
  settlement); LazAI (attestations / verifiable inference). All consumed via the GOAT-compatible
  adapter.

---

*End of Architecture ADR v1.0. This document defines structure, boundaries, trust, and the
load-bearing decisions. It is intended to be sufficient for a senior team to begin implementation
without inventing major architecture. Update the ADRs deliberately; the trust model in §5 is the
contract the rest of the system exists to honor.*
