# Deputy — Policy Vault Protocol Specification

> **Component:** Policy Vault (the root of trust) · **Status:** Draft v1.0 (protocol baseline)
> **Owner:** Lead Protocol Engineering
> **Companions:** [Deputy PRD](deputy-prd.md) · [Architecture ADR](deputy-architecture.md)
> **Audience:** Smart-contract (Solidity) engineers and protocol auditors.
> **Bar:** Treat this as if it will secure millions of dollars. This document specifies the
> protocol — states, authority, accounting, signatures, invariants, threats — in enough
> detail that a Solidity engineer can implement without making protocol-level decisions.
> It contains **no implementation code**.

---

## 0. Scope, tenets, and one refinement

### 0.1 The single principle this protocol exists to enforce

> **The AI never controls funds. The Policy Vault controls funds. The AI may only submit
> requests.**

Every design choice below serves five guarantees that must hold **even if the model is
compromised, the backend is hacked, the operator is malicious, and prompt injection succeeds**:

| ID | Guarantee | Enforced primitive |
|----|-----------|--------------------|
| G1 | Operator can never exceed allocated budget | On-chain accounting + ceiling check |
| G2 | Operator can never pay an unapproved vendor | On-chain vendor registry + per-settlement membership check |
| G3 | Operator can never bypass policy | On-chain caps/velocity/state gate, every settlement |
| G4 | User can revoke authority at any time | Owner/guardian freeze + terminal on-chain revoke |
| G5 | All spending is auditable forever | Append-only on-chain settlement events + content-hash anchors |

### 0.2 Design tenets (non-negotiable)

1. **Minimal trusted core.** The invariant-critical contract is small, immutable, and has no
   admin backdoor. Richness lives in optional modules that can only *narrow* authority.
2. **Capability ≠ custody.** The operator key can *request*; only the vault *authorizes*; only
   the owner *mutates the mandate*. No single key both moves funds and expands authority.
3. **Expanding authority is slow and reversible; contracting authority is instant.** Adding a
   vendor or raising the budget is owner-gated (and, for vendors, timelocked). Removing a
   vendor, lowering a cap, freezing, and revoking are immediate.
4. **Fail closed.** Any ambiguity, any module revert, any unmet check → settlement is rejected.
5. **No oracle in the hot path.** External reads (e.g., reputation) are evaluated at slow,
   owner-reviewed checkpoints, never as a per-settlement dependency.

### 0.3 Asset model

- The vault custodies a single configured **settlement asset** per vault — a standard ERC-20
  (e.g., a USD stablecoin on Metis). Fixed at creation; non–fee-on-transfer, non-rebasing
  tokens only (rejected otherwise; see Threat T-13).
- All caps, budgets, and amounts are denominated in that asset's smallest unit.
- Native-token (METIS) handling is out of scope for v1 (gas is paid by the submitter/relayer,
  not from vault funds).

### 0.4 One refinement vs the Architecture ADR (flagged deliberately)

The Architecture ADR sketched the allowlist as an "on-chain Merkle root." On closer protocol
analysis this spec makes the **canonical allowlist an explicit on-chain registry** (§5),
because: (a) it removes a data-availability dependency (a lost off-chain list can't strand
proofs), (b) it is trivially auditable by reading contract state, and (c) it is *cheaper at
settlement time* (one storage read vs proof verification per spend), and spends vastly outnumber
allowlist edits. A Merkle-root mode is retained as an **optional large-scale extension** (§5.6).
This is the only place this spec intentionally supersedes the ADR; update the ADR to match.

---

## 1. Definitions

| Term | Definition |
|------|------------|
| **Policy Vault** | A per-operator smart account that custodies that operator's budget and is the *sole* authority that can release funds. One vault = one operator = one mandate. Deployed by a factory; immutable core logic. |
| **Policy (Mandate)** | The complete set of on-chain rules the vault enforces on every settlement: ceiling, vendor registry, per-tx cap, velocity caps, rate limit, human-approval threshold, expiry, roles, and optional restricting modules. |
| **Vendor** | An approved payee. An on-chain record: `{ address, status, perVendorCap, category, addedAt }`. A settlement may only pay an **active** vendor and at most its `perVendorCap`. |
| **Spend Request** | The *off-chain* intent produced by the operator/Policy Engine: `{ vendor, amount, purpose, category, workEventRef }`. Carries no authority; it is only a proposal. |
| **Spend Authorization** | The on-chain–submittable, EIP-712–signed artifact derived from a Spend Request. Signed by the **operator key** (and co-signed by the **owner** when `amount ≥ humanApprovalThreshold`). Binds `{ vault, chainId, vendor, amount, asset, spendId, nonce, deadline, reasoningHash, receiptHash }`. This is what the vault validates. |
| **Settlement** | The on-chain execution of a valid Spend Authorization: policy validation → effects (accounting) → asset transfer to the vendor → event emission. Atomic. |
| **Revocation** | The owner's termination of operator authority. Two tiers: **Freeze** (instant, reversible halt) and **Revoke** (permanent, terminal removal of authority). |
| **Attestation** | The permanent, auditable record of a settlement: the on-chain `SettlementExecuted` event (carrying content hashes of the reasoning and receipt) plus the off-chain LazAI attestation those hashes anchor. Together they satisfy G5. |

**Three-layer model (memorize this):** *Spend Request* (off-chain intent) → *Spend
Authorization* (signed, on-chain–submittable) → *Settlement* (on-chain execution). Authority
increases at each layer and is checked, independently, at the last.

---

## 2. Roles & authority matrix

Authority is partitioned so that no compromise of a single role breaks more than one guarantee.

| Capability | Owner | Guardian | Operator key | Anyone (relayer) |
|------------|:----:|:-------:|:-----------:|:----------------:|
| Fund / raise budget | ✓ | ✗ | ✗ | deposit only* |
| Lower budget (≥ totalSpent) | ✓ | ✗ | ✗ | ✗ |
| Propose vendor addition (timelocked) | ✓ | ✗ | ✗ | ✗ |
| Cancel pending vendor addition | ✓ | ✓ | ✗ | ✗ |
| Remove vendor / lower vendor cap (instant) | ✓ | ✗ | ✗ | ✗ |
| Sign Spend Authorization | ✗ | ✗ | ✓ | ✗ |
| Co-sign high-value (≥ threshold) Authorization | ✓ | ✗ | ✗ | ✗ |
| Submit a settlement (gas) | ✓ | ✓ | ✓ | ✓ |
| Freeze (instant halt) | ✓ | ✓ | ✗ | ✗ |
| Unfreeze | ✓ | ✗ | ✗ | ✗ |
| Revoke (permanent) | ✓ | ✗** | ✗ | ✗ |
| Rotate operator key | ✓ | ✗ | ✗ | ✗ |
| Replace guardian | ✓ | ✗ | ✗ | ✗ |
| Withdraw free balance | ✓ | ✗ | ✗ | ✗ |
| Close vault | ✓ | ✗ | ✗ | ✗ |

\* Depositing funds is permissionless (anyone can add to the vault) but only the owner can
*raise the budget ceiling* that makes funds spendable. \** Guardian may be granted a
delayed-revoke escalation in the recovery module (§7.4), never an instant unilateral one.

**The cardinal separation:** the **operator key** can move money *only inside the mandate* and
can never change the mandate. The **owner** can change the mandate but does not sit in the
spend hot path. The **guardian** can only *stop*, never *spend* or *expand*. A compromised
operator key cannot poison the allowlist; a compromised guardian can only DoS; only the owner
key is catastrophic — and it is defended by timelocks, alerts, and guardian-cancel (§5, §9).

Roles are addresses; the owner SHOULD be a smart-contract wallet / multisig. Keys never live in
Deputy's backend except the **operator (session) key**, which is constrained and rotatable.

---

## 3. State machine

### 3.1 States

| State | Meaning | Settlements allowed? |
|-------|---------|:--------------------:|
| `Created` | Deployed, policy set, unfunded. | No |
| `Funded` | Holds asset balance, budget allocated, operator not yet activated. | No |
| `Active` | Operator may submit Spend Authorizations; settlements execute. | **Yes** |
| `Frozen` | Temporary, reversible halt (instant brake). | No |
| `Expired` | `validUntil` passed; mandate lapsed by time. | No |
| `Exhausted` | `available = 0` (budget fully committed/spent). | No (until top-up) |
| `Revoked` | Permanent removal of operator authority. **Terminal-for-spend.** | No, ever |
| `Closed` | Funds withdrawn, vault retired. **Absorbing terminal.** | No, ever |

`Exhausted` and `Expired` are *derived conditions* surfaced as states for clarity; the contract
MAY represent them as `Active` + a guard. The normative requirement is that settlements are
rejected whenever `available = 0` or `now ≥ validUntil`.

### 3.2 Valid transitions

| From | To | Trigger | Authority |
|------|----|---------|-----------|
| `Created` | `Funded` | First deposit raising budget > 0 | Owner |
| `Funded` | `Active` | Activate | Owner |
| `Active` | `Frozen` | Freeze | Owner or Guardian |
| `Frozen` | `Active` | Unfreeze | Owner |
| `Active` | `Exhausted` | `available` reaches 0 (post-settlement) | System (automatic) |
| `Exhausted` | `Active` | Top-up raises budget > spent | Owner |
| `Active`/`Frozen` | `Expired` | `now ≥ validUntil` | System (automatic) |
| `Expired` | `Active` | Owner extends `validUntil` | Owner |
| `Active`/`Frozen`/`Expired`/`Exhausted` | `Revoked` | Revoke | Owner (or guardian via delayed escalation) |
| `Revoked`/`Frozen`/`Expired`/`Exhausted` | `Closed` | Withdraw remaining + close | Owner |

Closing from any non-revoked state performs an **implicit revoke first** (you cannot close a
vault whose operator authority is still live).

### 3.3 Invalid transitions (MUST be impossible)

- `Revoked → Active` / `Revoked → Frozen` / `Revoked → anything except Closed`. **Revoke is
  absorbing for authority.** No path restores operator authority after revoke. (Recovery means
  a *new* vault, §7.4.)
- `Closed → *`. Absorbing terminal.
- `Created → Active` (cannot activate an unfunded vault).
- `Frozen → Closed` *without* passing through revoke semantics (close implies revoke).
- Any settlement in any state other than `Active`.
- Any transition triggered by the **operator key** (it can never move the state machine).
- `* → Funded → spend` where the spender is not authorized for the funded budget.

### 3.4 Diagram

```
Created ──fund──▶ Funded ──activate──▶ Active ⇄(freeze/unfreeze) Frozen
                                          │  ▲                      │
                                 available=0 │ top-up               │
                                          ▼  │                      │
                                      Exhausted                     │
                                          │                         │
                          now≥validUntil  ▼                         │
                                       Expired ──extend──▶ Active    │
                                          │                         │
         ┌────────────────────────────────┴───────────┬────────────┘
         ▼ revoke (Owner)                              ▼ revoke
                                Revoked (terminal-for-spend)
                                          │ withdraw + close
                                          ▼
                                       Closed (absorbing)
```

---

## 4. Policy structure

The mandate is split into a **Core** (invariant-critical, immutable, in the audited contract)
and **Modules** (optional, owner-installed, may only *deny*). A module can never increase a cap
or approve a vendor — it can only return "reject."

### 4.1 Core policy fields (immutable contract logic; values owner-settable per rules)

| Field | Type | Mutability | Enforces |
|-------|------|-----------|----------|
| `owner` | address | Owner-transferable (timelocked) | Authority root |
| `guardian` | address | Owner-settable | Freeze-only brake |
| `operatorKey` | address | Owner-rotatable (instant) | Signs authorizations |
| `operatorKeyEpoch` | uint | Increments on rotation | Invalidates old signatures |
| `settlementAsset` | address | Immutable (set at creation) | The only payable asset |
| `budgetAllocated` (B) | uint | Owner: raise (immediate or timelocked option); lower ≥ S (immediate) | G1 ceiling |
| `totalSpent` (S) | uint | System, monotonic ↑ | G1 accounting |
| `totalReserved` (R) | uint | System | In-flight exposure |
| `perTxCap` | uint | Owner: lower instant / raise timelocked | G3 single-tx bound |
| `windowDuration` | uint (seconds) | Owner: timelocked | Velocity window |
| `windowSpendCap` (dailyCap) | uint | Owner: lower instant / raise timelocked | G3 velocity (value) |
| `windowCountCap` (rateLimit) | uint | Owner: lower instant / raise timelocked | G3 velocity (count) |
| `humanApprovalThreshold` | uint | Owner: lower instant / raise timelocked | Owner co-sign gate |
| `validUntil` | timestamp | Owner-extendable | Mandate expiry |
| `vendorRegistry` | mapping(address ⇒ VendorRecord) | Owner (add timelocked, remove instant) | G2 |
| `pendingVendorAdditions` | mapping(address ⇒ {cap, category, effectiveAt}) | Owner add / Owner-Guardian cancel | G2 timelock |
| `vendorAdditionDelay` | uint (seconds) | Immutable floor; owner may only *increase* | G2 anti-poison timelock |
| `nonceState` | bitmap / counter | System | Replay protection |
| `state` | enum | Per §3 | G4 / G3 |
| `policyVersion` / `rubricVersion` | uint | Owner | Attribution (G5) |
| `installedModules` | address[] | Owner add/remove (deny-only contract) | Extended restriction |

### 4.2 Vendor record

```
VendorRecord {
  status:       Active | Removed
  perVendorCap: uint          // 0 ⇒ falls back to perTxCap; else min(perVendorCap, perTxCap)
  category:     bytes32       // optional, for module/category rules
  addedAt:      timestamp
}
```

### 4.3 Extended policy via modules (optional, deny-only)

Modules receive the candidate settlement and return allow/deny. Examples a team MAY ship:
category caps, per-vendor velocity, **reputation gate** (`minVendorReputation`,
`minOperatorReputation` read from ERC-8004 at checkpoints — §App E), business-hours windows,
geo/asset constraints. **Protocol rule:** the vault takes the **logical AND** of Core ∧ all
modules; any module revert/deny rejects the settlement. A module **cannot** widen Core. Module
set changes are owner-only and SHOULD be timelocked if they *remove* a restricting module.

### 4.4 Derived quantities

```
available        = min( B − S − R ,  assetBalance − R )
freeBalance      = assetBalance − R − max(0, B − S)     // owner-withdrawable
windowSpent(t)   = Σ amount_i for settlements with t_i ∈ [t − windowDuration, t]
windowCount(t)   = count of settlements in that window
```

---

## 5. Vendor allowlist (primary attack surface)

> Assume **allowlist poisoning is the #1 attack**: whoever can add a vendor can redirect funds.
> The entire design goal of this section is that *no compromise short of the owner key can add a
> payee, and even the owner key cannot add-and-drain atomically.*

### 5.1 Storage model

- Canonical: an **explicit on-chain registry** `vendorRegistry[address] → VendorRecord`.
  Settlement checks membership and cap with a single storage read.
- Rationale: self-contained (no data-availability dependence), trivially auditable, cheap at
  settlement time. (Merkle mode is an optional extension for very large lists — §5.6.)

### 5.2 Update process — the asymmetry

| Operation | Authority | Latency | Reversible during latency? |
|-----------|-----------|---------|----------------------------|
| **Add vendor** (expands authority) | Owner only | **Timelocked** ≥ `vendorAdditionDelay` | Yes — owner or guardian cancels |
| **Raise vendor cap** | Owner only | Timelocked | Yes |
| **Remove vendor** (contracts authority) | Owner only | **Instant** | n/a |
| **Lower vendor cap** | Owner only | **Instant** | n/a |

Addition flow: `proposeVendorAddition(addr, cap, category)` → enters `pendingVendorAdditions`
with `effectiveAt = now + vendorAdditionDelay` and emits `VendorAdditionProposed` (the user is
alerted off-chain) → after the delay, `activateVendorAddition(addr)` moves it to `Active`. The
addition is **not spendable** before `effectiveAt`.

### 5.3 Owner permissions & guardian role

- **Only the owner** may propose additions, raise caps, remove vendors, or lower caps.
- **Owner or guardian** may `cancelPendingAddition(addr)` during the timelock — a fast veto if a
  malicious addition appears (e.g., owner key suspected compromised).
- The **operator key can never touch the registry** — not add, not remove, not cap.

### 5.4 Timelocks

- `vendorAdditionDelay` has a **protocol minimum floor** (e.g., 24h; exact value a launch
  parameter, §App D) and the owner may only *increase* it, never set it below the floor. This
  guarantees a minimum detection/veto window even against a compromised owner key.
- Cap raises and budget raises MAY share the same delay; cap *lowering* and budget *lowering*
  are always instant.

### 5.5 Emergency controls

- `freeze()` (owner/guardian): halts all settlements instantly; pending additions cannot
  activate while frozen.
- `cancelPendingAddition()` (owner/guardian): kills a queued addition before it goes live.
- `freezeAllowlist()` (owner/guardian, optional): blocks *new* proposals and activations without
  halting in-policy spend to already-trusted vendors — a scalpel for "I think someone is trying
  to add a payee" without stopping legitimate work.
- All emergency controls emit events for off-chain alerting.

### 5.6 Optional Merkle mode (large-scale extension)

For allowlists too large for explicit storage economics, a vault MAY be configured at creation
to verify a **Merkle proof of membership** against a committed `vendorRoot`. Root updates obey
the **same timelock and owner-only rules** as registry additions (a root change that could add a
vendor is timelocked; a root change that only removes is instant). Merkle mode trades a
data-availability assumption (proofs must remain available) for storage savings; it does **not**
relax any guarantee. A vault uses exactly one mode, fixed at creation.

### 5.7 Why poisoning fails (summary)

1. Operator key compromise → cannot add vendors at all (G2 holds; attacker stuck paying existing
   legit vendors = waste, not theft).
2. Backend compromise → same; backend never holds owner authority.
3. Owner key compromise (catastrophic) → still cannot add-and-drain in one tx; the addition is
   queued for ≥ `vendorAdditionDelay`, is alerted, and is cancelable by the guardian. Caps and
   the global budget further bound loss even if a malicious vendor goes live.

---

## 6. Spend flow

Five stages. The first two are off-chain (untrusted, advisory); **stages 3–5 are the
authoritative on-chain protocol.** The vault re-derives every safety property itself — it never
trusts the off-chain decision.

### Stage 1 — Operator proposes (off-chain, untrusted)
- **Input:** objective context, tool result requiring payment, vendor + amount.
- **Output:** a **Spend Request** `{ vendor, amount, purpose, category, workEventRef }`.
- **Failure conditions:** none are protocol-relevant — a malformed/malicious request simply
  fails later checks. Carries zero authority.

### Stage 2 — Policy evaluates (off-chain Policy Engine, advisory)
- **Input:** Spend Request + current mandate snapshot + accounting.
- **Output:** `APPROVED | AUTO_APPROVED | NEEDS_HUMAN | REJECTED(reason)`; for approved spends, a
  **Spend Authorization** is assembled and signed by the **operator key** (and queued for owner
  co-sign if `amount ≥ humanApprovalThreshold`).
- **Failure conditions:** rejection here saves gas but is **not** a security boundary; the vault
  re-checks everything. A compromised Policy Engine that wrongly "approves" cannot make the vault
  settle anything out of policy.

### Stage 3 — Vault validates (on-chain, AUTHORITATIVE)
- **Input:** a submitted Spend Authorization + (Merkle proof if in Merkle mode). Submittable by
  anyone (relayer/facilitator); the *submitter* is irrelevant — only the *signatures* matter.
- **Checks (ALL must pass; fail closed):**
  1. `state == Active` and `now < validUntil` and `now ≤ deadline`.
  2. EIP-712 domain matches **this vault address and chainId** (no cross-vault/chain replay).
  3. `nonce` unused; mark consumed atomically.
  4. Recovered signer of the operator-signature `== operatorKey` **and** authorization
     `operatorKeyEpoch == current epoch` (rotation invalidates old sigs).
  5. If `amount ≥ humanApprovalThreshold`: a valid **owner** co-signature over the same struct is
     present.
  6. `vendor` ∈ registry with `status == Active` (or valid Merkle proof); `amount ≤
     vendorCap(vendor)` and `amount ≤ perTxCap`.
  7. `S + R + amount ≤ B` (G1) **and** `assetBalance ≥ amount` (solvency).
  8. `windowSpent + amount ≤ windowSpendCap` and `windowCount + 1 ≤ windowCountCap` (G3 velocity).
  9. Every installed module returns *allow* (Core ∧ modules).
- **Output:** validation pass → proceed to settlement; or a categorized revert.
- **Failure conditions / revert reasons:** `NotActive`, `Expired`, `DeadlinePassed`,
  `BadDomain`, `NonceUsed`, `BadOperatorSig`, `StaleKeyEpoch`, `MissingOwnerCosign`,
  `VendorNotApproved`, `OverVendorCap`, `OverPerTxCap`, `OverBudget`, `Insolvent`,
  `OverWindowValue`, `OverWindowCount`, `ModuleDenied`.

### Stage 4 — Settlement executes (on-chain, atomic)
- **Order (checks-effects-interactions, reentrancy-guarded):**
  1. **Effects first:** `S += amount`; update window accounting; consume nonce; record `spendId`.
  2. **Interaction last:** `safeTransfer(settlementAsset, vendor, amount)`.
  3. If post-settlement `available == 0` → state becomes `Exhausted`.
- **Output:** funds delivered to the vendor; accounting updated; ready to attest.
- **Failure conditions:** token transfer revert → whole settlement reverts atomically (no partial
  state, accounting unchanged). Non-standard/fee-on-transfer token → rejected at creation
  (Threat T-13), so transfer amount always equals recorded amount.

**Async / x402 variant (reserve → capture → void):** for flows where authorization precedes
delivery, the vault supports a two-phase path: `reserve(auth)` validates Stage 3 and moves
`amount` into `R` (no transfer yet, `reservationExpiry` set); `capture(reservationId)` performs
the transfer and moves `R → S`; `void(reservationId)` releases `R` back to `available` (callable
by owner/operator anytime, by anyone after expiry). This bounds in-flight exposure and gives
clean failure semantics for undelivered vendor work. Synchronous `settle` is `reserve+capture`
atomically.

### Stage 5 — Attestation recorded (on-chain event + off-chain anchor)
- **Input:** the executed settlement.
- **Output:** a permanent `SettlementExecuted` event carrying
  `{ spendId, vendor, amount, asset, nonce, policyVersion, rubricVersion, reasoningHash,
  receiptHash, timestamp }`; the off-chain LazAI attestation that `reasoningHash`/`receiptHash`
  anchor. Together: G5.
- **Failure conditions:** if the off-chain attestation lags, the on-chain event still exists and
  is authoritative; proofs surface "attestation pending" honestly rather than implying
  completeness. The hashes are committed *in the signed authorization*, so the operator cannot
  retroactively alter the reasoning a settlement claims to be based on.

---

## 7. Revocation

Revocation has two tiers plus a recovery path. The design goal: **the user can always stop a
worker, and the stop is real even if Deputy's backend is hostile.**

### 7.1 Instant freeze (reversible)
- `freeze()` by **owner or guardian**; takes effect the moment it mines (and the backend also
  stops proposing off-chain immediately).
- Effect: `state → Frozen`; all settlements and reservation captures rejected; pending vendor
  additions cannot activate.
- Reversible by **owner** (`unfreeze`) only — a frozen vault cannot be unfrozen by the guardian,
  preventing freeze/unfreeze toggling abuse.

### 7.2 Permanent revoke (terminal)
- `revoke()` by **owner** (or guardian via the delayed-escalation recovery path, §7.4).
- Effect: `state → Revoked`, **absorbing for authority**. The operator key is permanently
  powerless; no settlement can ever execute again; outstanding reservations are voided.
- Revocation is itself receipted (`OperatorRevoked` event: who, when).

### 7.3 Worst-case loss after a revoke request

Let the attacker control **only the operator key** (the realistic backend-compromise case; the
owner key is uncompromised). Between the instant a revoke/freeze is *requested* and the instant
it is *enforced on-chain* (finality window `Δ`), the maximum extractable loss is:

```
L_max  ≤  min(
            available,                       // can't exceed remaining budget        (G1)
            windowSpendCap − windowSpent,    // can't exceed remaining velocity value (G3)
            perTxCap × (windowCountCap − windowCount)   // bounded by per-tx × remaining count (G3)
          )
   and every unit of L_max goes ONLY to an already-Active vendor               (G2)
   and any single amount ≥ humanApprovalThreshold is IMPOSSIBLE without the owner co-sign.
```

So an operator/backend-only attacker is bounded to **sub-threshold, in-policy spend to
already-approved vendors, within remaining velocity, during one finality window** — money that,
by construction, goes to vendors the owner already trusted, not to the attacker. With a
**guardian same-block freeze** (or a private-mempool revoke), `Δ → ~0` and `L_max → ~0`.
Catastrophic loss requires the **owner key**, which is outside this bound and is defended by the
allowlist timelock (an attacker with the owner key *still* cannot add a fresh exfil vendor and
drain within `Δ`).

### 7.4 Recovery path
- **Funds recovery after revoke:** `Revoked → Closed` lets the **owner** withdraw the entire
  remaining `assetBalance` (reservations are voided first). Funds are never trapped by revoke.
- **Operator-key loss (owner intact):** owner rotates `operatorKey` (instant) or revokes — no
  funds at risk.
- **Owner-key loss (optional module):** a **guardian-assisted recovery** module MAY allow the
  guardian to initiate owner transfer to a pre-registered backup address behind a **long
  timelock** (e.g., 7–30 days), vetoable by the original owner during the window. The guardian
  can *never* spend or add vendors via this path — only, after a long public delay, hand
  ownership to the user's designated backup. This is opt-in; vaults without it accept that owner
  key loss means the user must drain and migrate.
- **Migration / upgrade:** because the core is immutable, "upgrading" a vault means deploying a
  new vault and the owner moving funds — never an in-place admin upgrade. Reputation follows the
  ERC-8004 *identity*, not the vault, so migration preserves the track record (Architecture
  ADR-008).

---

## 8. Formal invariants

Notation: `B` = budgetAllocated, `S` = totalSpent, `R` = totalReserved, `bal` = vault balance of
`settlementAsset`, `V` = set of Active vendors, `perTxCap`, `windowSpendCap`, `windowCountCap`,
`threshold` = humanApprovalThreshold. "At settlement" = the block in which a settlement executes.

**Accounting & budget (G1)**
- **INV-1** `S + R ≤ B` at all times.
- **INV-2 (solvency)** `bal ≥ R` at all times (reserved funds are always physically present).
- **INV-3** Every settlement requires `bal ≥ amount` and `S + R + amount ≤ B` *before* effects.
- **INV-4 (monotonic)** `S` is non-decreasing. `B` changes only via owner action and never
  satisfies `B < S`. Reservations only move value between `R` and `S`/`available`, never create it.
- **INV-5 (conservation)** `Σ deposits = bal + Σ settlementsOut + Σ withdrawals` (no asset is
  created or destroyed by the vault).

**Vendors (G2)**
- **INV-6** For every executed settlement with recipient `r` and value `a`: `r ∈ V` at
  settlement **and** `a ≤ vendorCap(r)` **and** `a ≤ perTxCap`.
- **INV-7** `V` is mutated only by the owner. Additions take effect only at/after
  `effectiveAt = proposedAt + vendorAdditionDelay`; removals take effect immediately. The
  operator key and guardian can never add to `V`.
- **INV-8** `vendorAdditionDelay ≥ FLOOR` and is never decreased below `FLOOR`.

**Policy & velocity (G3)**
- **INV-9** A settlement executes only if `state == Active ∧ now < validUntil`.
- **INV-10** `windowSpent + a ≤ windowSpendCap ∧ windowCount + 1 ≤ windowCountCap` for every
  executed settlement.
- **INV-11** Final decision = `Core ∧ (⋀ modules)`. No module can cause acceptance that Core
  rejects; any module revert ⇒ reject (fail closed).

**Authorization, replay, signatures**
- **INV-12 (replay)** Each `nonce` is consumed at most once; a settlement with a used nonce is
  rejected. Each authorization has `now ≤ deadline`.
- **INV-13 (signer)** The recovered operator-signer equals the current `operatorKey` and the
  authorization's `operatorKeyEpoch` equals the current epoch (rotation invalidates all
  outstanding signatures).
- **INV-14 (co-sign)** `a ≥ threshold ⇒` a valid owner co-signature over the identical struct is
  present; otherwise the settlement is rejected.
- **INV-15 (domain binding)** A signature is valid only for the EIP-712 domain
  `{ name, version, chainId, verifyingContract = this vault }`. No signature is replayable across
  vaults or chains.

**Revocation & state (G4)**
- **INV-16 (absorbing revoke)** Once `state == Revoked`, no settlement, reservation, capture,
  vendor change, or unfreeze ever succeeds again; the only outgoing transition is `→ Closed`.
- **INV-17 (freeze)** `state ∈ {Frozen, Expired, Exhausted, Closed}` ⇒ no settlement executes.
- **INV-18 (no operator state control)** No function callable by the operator key changes
  `state`, `B`, `V`, caps, or roles.

**Authority & custody**
- **INV-19 (withdrawal)** Withdrawals are owner-only and limited to `freeBalance = bal − R −
  max(0, B − S)`. To withdraw more, the owner must first lower `B` (never below `S`).
- **INV-20 (guardian bound)** Every guardian-callable function is in `{ freeze,
  cancelPendingAddition, freezeAllowlist, (delayed) recovery-escalation }`. No guardian action
  transfers funds, adds vendors, or raises any limit.
- **INV-21 (immutability)** No code path mutates core invariant logic post-deployment; there is
  no admin/owner function that can disable INV-1…INV-20 or move funds outside a valid settlement.

**Audit (G5)**
- **INV-22 (completeness)** Every executed settlement emits exactly one `SettlementExecuted`
  event with the full field set (§6 Stage 5). No settlement is possible without its event in the
  same transaction.
- **INV-23 (attestation binding)** `reasoningHash` and `receiptHash` are fields of the *signed*
  authorization; the recorded attestation references cannot be altered after signing without
  invalidating the signature.

---

## 9. Threat model

Each: **impact · mitigation · remaining risk.**

| # | Threat | Impact | Mitigation | Remaining risk |
|---|--------|--------|------------|----------------|
| T-1 | **Malicious operator** (jailbroken AI / rogue runtime) | Proposes hostile spends | Operator key cannot add vendors, change policy, or exceed caps; Core re-checks everything on-chain (INV-6…INV-18) | Bounded in-policy waste to already-approved vendors |
| T-2 | **Malicious vendor** (approved payee turns hostile / fails to deliver) | Takes paid funds without value | `perVendorCap` + reserve/capture/void for undelivered work + instant removal; reputation gate at add-time | Loss ≤ `perVendorCap` per tx until owner removes vendor; off-chain outcome verification is the open problem |
| T-3 | **Compromised backend** (proposer key theft, RCE) | Attacker signs in-policy authorizations | Operator key constrained (INV-13/18); per-operator key isolation; co-sign for ≥ threshold (INV-14); guardian freeze; fast revoke | In-policy drain to approved vendors within one velocity window until freeze/revoke (§7.3 bound) |
| T-4 | **Compromised frontend** (XSS/supply-chain) | Shows false data, tries to induce signatures | Vault holds no frontend trust; owner signs in their own wallet over EIP-712 structured data (human-readable); on-chain truth contradicts UI lies | User socially engineered into signing a real owner action (mitigated by allowlist timelock + alerts) |
| T-5 | **Replay attack** (resubmit a settlement) | Double spend | Per-nonce consumption (INV-12); atomic effects-before-interaction; on-chain `S` authoritative | Negligible |
| T-6 | **Signature replay** (reuse a sig on another vault/chain or after key rotation) | Unauthorized settlement | EIP-712 domain binds vault + chainId (INV-15); `operatorKeyEpoch` invalidates rotated keys (INV-13); deadlines | Negligible |
| T-7 | **Allowlist poisoning** (add attacker's address as vendor) | Direct fund exfiltration | Owner-only + timelock + alert + guardian-cancel (INV-7/8, §5); operator/backend cannot add at all | Requires owner-key compromise *and* surviving the timelock veto window |
| T-8 | **Oracle manipulation** (gaming ERC-8004 reputation gate) | Bypass reputation requirement | Reputation evaluated only at slow, owner-reviewed checkpoints (vendor add), never per-settlement; snapshot at add-time; no hot-path oracle (Tenet 5) | A pumped reputation could pass the add-time check; bounded by caps + owner review + timelock |
| T-9 | **Event forgery** (fake an audit trail) | False history / hidden spend | Events are emitted atomically with settlement (INV-22); cannot emit `SettlementExecuted` without funds moving; off-chain attestation hashes are signed (INV-23); chain log is canonical | None at the chain layer; off-chain mirrors that lie are detectable against chain |
| T-10 | **Reentrancy** (malicious vendor contract re-enters on transfer) | Drain via re-entry mid-settlement | Checks-effects-interactions (effects before transfer, INV-3/4) + reentrancy guard; state finalized pre-interaction | Negligible if guard + ordering verified by audit |
| T-11 | **Revoke-race / censorship** (spend during the kill window) | Loss before revoke mines | Dual-path freeze (guardian same-block) + caps bound the window (§7.3); private-mempool revoke option | Small, explicitly bounded `L_max`; → ~0 with guardian freeze |
| T-12 | **Owner-key compromise** | Full mandate control | Allowlist timelock + guardian-cancel + alerts blunt add-and-drain; consider owner = multisig; optional recovery module | Catastrophic if attacker also defeats the timelock/guardian; reduce by multisig ownership |
| T-13 | **Weird ERC-20** (fee-on-transfer, rebasing, reentrant, double-entry) | Accounting drift / drain | Restrict `settlementAsset` to a vetted standard token at creation; reject fee-on-transfer (measure received == sent or disallow); no arbitrary-token settlement | Limited to the vetted asset's own risk (e.g., stablecoin issuer freeze) |
| T-14 | **Module abuse** (malicious/buggy installed module) | Wrongful accept/deny | Modules can only *deny* (INV-11); a buggy module fails closed (rejects); install/remove owner-gated, remove-of-restriction timelocked | A module that wrongly *denies* costs liveness, not safety |
| T-15 | **Gas griefing / DoS** (spam settlements, block submission) | Liveness degradation | Rate limit (`windowCountCap`); permissionless submission so no single relayer is a chokepoint; owner can always freeze/revoke | Degraded throughput; never a safety breach (no spend occurs while stalled) |
| T-16 | **Stuck funds** (vault can't pay, funds trapped) | Capital lock-up | Owner withdrawal of `freeBalance` anytime; full withdrawal after revoke; reservations auto-void on expiry | None for owner; operator simply can't spend |

---

## 10. Audit checklist

A top auditor should be able to verify every item below.

### Access control & authority separation
- [ ] Every state-changing function enforces the role matrix (§2); no function lets the operator
      key change state, budget, vendors, caps, or roles (INV-18).
- [ ] Guardian functions are strictly the freeze/cancel/recovery-escalation set; none move funds
      or expand authority (INV-20).
- [ ] No hidden owner/admin function can move funds outside a valid settlement or disable an
      invariant (INV-21). No `selfdestruct`, no arbitrary `delegatecall`, no upgradeable proxy on
      the invariant core.
- [ ] Owner transfer (and any role change) is correct and, where required, timelocked.

### Budget & accounting (G1)
- [ ] `S + R ≤ B` holds across all paths, including reserve/capture/void and reverts (INV-1/3).
- [ ] `B` cannot be set below `S`; lowering is instant, raising follows policy (INV-4).
- [ ] Solvency `bal ≥ R` is preserved (INV-2); conservation holds (INV-5).
- [ ] No integer overflow/underflow; rounding cannot create or destroy value.

### Vendors (G2)
- [ ] Settlement membership + cap checks are unbypassable (INV-6).
- [ ] Additions strictly obey the timelock and `FLOOR`; cannot be activated early (INV-7/8).
- [ ] Removals/cap-lowering are immediate; cancellation of pending additions works for owner and
      guardian.
- [ ] If Merkle mode: proof verification is sound; root changes obey the same timelock/owner
      rules; no second-preimage / proof-malleability issue.

### Policy & velocity (G3)
- [ ] Per-tx, window-value, and window-count caps are enforced on every settlement (INV-10);
      window accounting is correct across boundaries and cannot be reset by manipulation.
- [ ] Module composition is AND-only and fails closed; a module cannot widen Core (INV-11).
- [ ] Expiry and all non-Active states reject settlement (INV-9/17).

### Signatures, replay, nonces
- [ ] EIP-712 domain binds `chainId` + `verifyingContract`; cross-vault/chain replay impossible
      (INV-15).
- [ ] Nonce consumption is atomic and single-use; no race allows reuse (INV-12).
- [ ] Operator-key rotation invalidates outstanding signatures via epoch (INV-13).
- [ ] High-value co-sign requirement cannot be skipped or satisfied by the operator key (INV-14).
- [ ] Deadlines enforced; no signature is eternally valid.

### Settlement execution
- [ ] Checks-effects-interactions ordering; reentrancy guard on all external-call paths (T-10).
- [ ] `safe` ERC-20 handling; reverts roll back all state atomically; no partial settlement.
- [ ] Fee-on-transfer/rebasing assets are rejected or provably safe (T-13).
- [ ] Reserve/capture/void cannot double-spend, double-release, or strand reservations; expiry
      void is permissionless and correct.

### State machine (G4)
- [ ] All §3 transitions implemented; all §3.3 invalid transitions impossible.
- [ ] `Revoked` and `Closed` are truly absorbing (INV-16); no path restores operator authority.
- [ ] Freeze is instant for owner *and* guardian; unfreeze is owner-only.
- [ ] Worst-case post-revoke loss matches the §7.3 bound under adversarial assumptions.

### Auditability (G5)
- [ ] Every settlement emits the complete `SettlementExecuted` event atomically; no spend without
      its event (INV-22).
- [ ] Reasoning/receipt hashes are part of the signed authorization and cannot be altered post-hoc
      (INV-23).
- [ ] All privileged actions (freeze, revoke, vendor changes, budget changes, role changes,
      withdrawals) emit events sufficient to reconstruct full history.

### Economic & integration
- [ ] x402 binding: the authorization commits to `{vendor, amount, asset, deadline}` so a
      facilitator cannot alter the payment (App E).
- [ ] Factory deploys vaults deterministically with correct, immutable parameters; one vault
      cannot impersonate or drain another.
- [ ] Reputation/oracle reads (if used) are checkpoint-only, snapshotted, and cannot DoS or
      manipulate the hot path (T-8).

---

## Appendix A — Spend Authorization (signed struct fields)

EIP-712 typed data the operator key signs (and the owner co-signs when `amount ≥ threshold`):

```
DeputySpendAuthorization {
  vault:           address     // verifyingContract — domain-bound
  chainId:         uint        // domain-bound
  spendId:         bytes32     // unique work↔settlement↔attestation correlator
  vendor:          address
  amount:          uint
  asset:           address     // must equal settlementAsset
  nonce:           uint        // single-use
  deadline:        uint        // authorization expiry
  operatorKeyEpoch:uint        // must match current epoch
  reasoningHash:   bytes32     // LazAI anchor for the reasoning trace
  receiptHash:     bytes32     // LazAI anchor for the receipt/evidence
  policyVersion:   uint
  rubricVersion:   uint
}
```

## Appendix B — Canonical event catalog

`VaultCreated · BudgetAllocated · BudgetLowered · OperatorActivated · OperatorKeyRotated ·
GuardianChanged · VendorAdditionProposed · VendorAdditionActivated · VendorAdditionCancelled ·
VendorRemoved · VendorCapChanged · CapsChanged · ThresholdChanged · ValidityExtended ·
SpendReserved · SettlementExecuted · ReservationVoided · ModuleInstalled · ModuleRemoved ·
Frozen · Unfrozen · AllowlistFrozen · OperatorRevoked · FundsWithdrawn · VaultClosed`

(`SettlementExecuted` is the G5 backbone; all privileged actions emit events for off-chain alerting and audit.)

## Appendix C — Settlement validation order (normative summary)

`Active/notExpired/notPastDeadline → domain → nonce → operatorSig+epoch → (cosign if ≥threshold)
→ vendor+vendorCap+perTxCap → budget+solvency → velocity(value,count) → modules(AND) → effects →
transfer → event`. Fail closed at the first failing check.

## Appendix D — Launch parameters (to be fixed before deployment, not at implementation time)

| Parameter | Guidance |
|-----------|----------|
| `vendorAdditionDelay` FLOOR | ≥ 24h recommended; the anti-poisoning veto window. |
| Cap/budget-raise timelock | MAY equal `vendorAdditionDelay`; lowering always instant. |
| Owner-transfer timelock | Long (e.g., 48h+); owner-vetoable. |
| Recovery-escalation timelock | 7–30 days; opt-in module only. |
| `humanApprovalThreshold` default | Product decision; below it, in-policy spend auto-settles. |
| Reservation expiry default | Short (minutes–hours) to bound in-flight `R`. |

## Appendix E — Integration bindings

- **x402:** the vendor's `402` payment requirement (recipient, amount, asset) MUST match the
  signed authorization; the facilitator/Payment Engine submits the settlement but cannot alter
  the signed terms. The vault is the payer; funds leave only via a validated settlement.
- **ERC-8004:** the operator's stable identity and reputation live in the registries
  (Architecture ADR-008). Reputation gates, if used, are read at vendor-add checkpoints (not per
  settlement) and snapshotted to keep the hot path oracle-free (T-8). Reputation survives vault
  migration because it follows the identity, not the vault.
- **LazAI:** `reasoningHash`/`receiptHash` in each authorization anchor the immutable attestation;
  the on-chain event + LazAI attestation together constitute the permanent audit record (G5).

---

*End of Policy Vault Protocol Specification v1.0. This document fixes the protocol-level
decisions — states, authority, accounting, signatures, timelocks, and the formal invariants — so
that implementation is a matter of faithful encoding and audit, not further design. The invariant
set in §8 is the contract the implementation must prove it upholds.*
