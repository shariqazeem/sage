# CampaignVault V2 — threat model & design

> The protocol unlock: a founder approves a **finite campaign** — a fixed set of
> missions, each with an exact reward and a maximum number of paid completions, a
> fully-backed total budget, a velocity limit, and an expiry — and appoints Sage
> as operator **once**. After that, Sage can pay a **previously unknown tester
> wallet** for accepted work **without the founder allowlisting each recipient**,
> while the vault holds Sage's authority to exactly the approved mandate.
>
> This is *"configure the mandate once,"* not *"trust the AI with everything."*

> **STATUS: not deployed.** This document + the V2 contracts define the protocol;
> nothing is on-chain. PolicyVault **V1** remains the live, operational path.

---

## 1. The honesty boundary (read this first)

CampaignVault V2 does **NOT** prove that submitted work was genuinely correct, and
it does **NOT** prevent every wrong-recipient payout. A compromised Sage operator
can misallocate the **remaining authorized campaign budget** to unique wallets
while staying inside the approved mission structure.

What the vault **does** guarantee is **bounded financial authority**:

- funds move only for **approved mission IDs**;
- at the **exact pre-approved reward** (the operator cannot choose an amount);
- up to each mission's **fixed completion count**;
- within a **finite total budget** fully backed at activation;
- within a **daily velocity** limit;
- inside a **lifecycle** (active, not paused, not expired, not revoked);
- **never twice** to the same wallet for the same mission;
- **never** on a **replayed intent**.

Accountability for *which* tester was chosen and *why* comes from Sage's
**DecisionCommitmentV2** (the decision receipt on the proof page) — not from the
vault. The vault bounds authority; the commitment records reasoning. Public copy
must never conflate the two, and must never claim V2 proves work quality.

**Compromised-operator maximum loss:** the entire *remaining* campaign budget,
distributed only as valid mission payouts (approved missions, exact rewards,
distinct recipient-per-mission, within completion caps / budget / velocity /
lifecycle). It **cannot**: exceed the budget, invent a mission, change a reward,
exceed a completion cap, pay a wallet twice for one mission, replay an intent,
withdraw funds, or alter governance. The founder retains **pause / revoke / refund**
at all times.

---

## 2. Roles & authority

| | Owner (founder) | Operator (Sage key) | Guardian |
|---|---|---|---|
| fund / activate | ✅ | ❌ | ❌ |
| pause / unpause | ✅ | ❌ | ❌ |
| revoke | ✅ | ❌ | ✅ |
| set guardian | ✅ | ❌ | ❌ |
| withdraw (after revoke/expiry) | ✅ | ❌ | ❌ |
| requestPayout (mission) | ❌ | ✅ | ❌ |
| alter missions / rewards / caps | ❌ (immutable) | ❌ | ❌ |

- **owner ≠ operator is enforced at creation** (constructor/factory revert). This
  is the structural core: the key that *proposes* payments is never the key that
  *governs* the vault.
- **guardian ≠ operator** when guardian is nonzero (so "guardian can revoke" never
  becomes "operator can revoke"). The factory never sets the operator as guardian.
- The owner is a founder wallet; **a Sage server key is never the owner.**

---

## 3. Immutable campaign identity

Stored `immutable` at creation, never changeable:

`owner`, `operator`, `token`, `campaignIdHash` (nonzero), `missionPlanDigest`,
`budgetCeiling`, `dailyVelocityCap`, `duration`.

**`missionPlanDigest` encoding (deterministic, reproducible off-chain):**

```
missionPlanDigest = keccak256(abi.encode(
    bytes32   campaignIdHash,
    bytes32[] missionIds,      // creation order
    uint256[] rewardAmounts,   // creation order
    uint256[] maxCompletions   // creation order
))
```

The contract **computes** this from the exact arrays it stores (never an
independently-supplied value that could disagree). DecisionCommitmentV2 commits to
it, so a proof can prove which mission plan authorized a payout.

---

## 4. Mission policy (immutable)

At creation the vault receives bounded, equal-length arrays: `missionIds:
bytes32[]`, `rewardAmounts: uint256[]`, `maxCompletions: uint256[]`. Enforced:

- **≥ 1** and **≤ 32** missions; equal array lengths;
- each `missionId` nonzero and **unique**;
- each `rewardAmount` nonzero; each `maxCompletions` nonzero;
- `mission total = rewardAmount × maxCompletions` (Solidity 0.8 checked
  arithmetic — overflow reverts);
- **`budgetCeiling = Σ (rewardAmount × maxCompletions)`** — computed from the plan,
  never independently supplied. An independent budget that could disagree is
  rejected by construction.

Each mission stores `{ exists, rewardAmount, maxCompletions, paidCompletions }`.
The plan is **immutable**: the owner cannot add missions, change rewards, or change
completion caps; the operator cannot mutate any field. A founder who needs a
materially different plan **creates a new campaign vault** — the authorized mandate
stays unambiguous, and there is no cross-campaign budget contention.

---

## 5. Payout entrypoint & the ten checks

```
requestPayout(bytes32 missionId, address recipient, bytes32 decisionDigest, bytes32 intentHash)
    external nonReentrant returns (bool)
```

The operator supplies **no amount** — the vault derives the exact reward from the
immutable mission. Soft-rejection order (emit `PayoutRejected(failedCheckIndex)`,
move zero tokens; never revert on a policy failure):

1. **Active & not expired**
2. **Caller is the operator**
3. **Mission exists**
4. **Recipient is nonzero**
5. **decisionDigest and intentHash are nonzero**
6. **Recipient has not already completed this mission**
7. **Mission has remaining completions** (`paidCompletions < maxCompletions`)
8. **Intent not already consumed** (replay guard)
9. **Total budget sufficient** (`totalSpent + reward ≤ budgetCeiling`)
10. **Daily velocity sufficient** (`windowSpend + reward ≤ dailyVelocityCap`)

On success (**checks-effects-interactions**): mark recipient paid for the mission →
consume the intent → increment `paidCompletions` → increment payout count →
`totalSpent += reward` → update velocity window → **then** `safeTransfer(recipient,
reward)` → emit `PayoutSettled`. Effects precede the transfer, so the replay +
recipient-uniqueness guards hold even under reentrancy.

A policy-rejected intent (checks 1–7, 9, 10) is **not consumed** and its recipient
slot is **not** taken — it stays retryable once the condition is resolved. Only a
successful settlement consumes the intent and the recipient/mission slot.

---

## 6. Replay & recipient uniqueness

Views: `isIntentUsed(bytes32)`, `hasRecipientCompleted(bytes32 missionId, address)`.

- one **intent** settles at most once;
- one **recipient** is paid at most once **per mission**;
- the same recipient **may** be paid for a *different* mission;
- **multiple** recipients may complete the same mission until `maxCompletions`;
- a **rejected** attempt consumes neither its intent nor a recipient slot.

---

## 7. Lifecycle

`Created → Funded → Active → (Paused | Revoked)` — same enum ordinals as V1 for app
compatibility.

- funding only before activation;
- `activate()` requires `balance ≥ budgetCeiling` (fully backed — no fractional
  reserve); accidental excess balance never raises `budgetCeiling`;
- `pause` does not extend expiry (duration runs from activation);
- `revoke` is terminal + idempotent; owner **or** guardian may revoke;
- `withdrawRemaining` only after revoke or expiry, owner-only;
- `budgetCeiling` is immutable throughout.

## 8. Velocity

A gas-cheap **fixed-reset window**: if more than 24h have elapsed since the last
settled payout, the window resets to 0; otherwise the current window accumulates.
It never permits window spend above `dailyVelocityCap`. (Same semantics as V1 —
documented as an approximation, not a precise rolling sum.)

---

## 9. V1 vs V2

| | PolicyVault **V1** | CampaignVault **V2** |
|---|---|---|
| recipient model | **allowlist** — owner approves each vendor | **mission** — owner pre-approves missions; any wallet paid once per mission |
| amount | operator-supplied, bounded by per-tx cap | **derived** from the immutable mission reward |
| budget | independently set ceiling | **Σ mission (reward × maxCompletions)** |
| new tester | requires owner allowlist tx | **no owner intervention** |
| owner == operator | allowed (Sage-owned vaults) | **forbidden** (must be distinct) |
| checks | 7 | 10 |
| commitment | DecisionCommitmentV1 | **DecisionCommitmentV2** (binds missionPlanDigest + missionIdHash + on-chain reward) |

**Legacy compatibility:** V1 (`PolicyVault` + `PolicyVaultFactory`) and every
legacy campaign / proof path stay fully operational. The app carries a
`vaultKind` (`policy_v1 | campaign_v2`) resolved from the campaign row (never
inferred from unreliable reverts). Old rows default to `policy_v1`; old proofs
render unchanged. Commitment version is explicit per vault kind.

## 10. Why one vault per campaign

Each campaign is its own vault, so its budget can only pay its own missions —
there is **no cross-campaign budget contention**, and a compromised operator's
maximum loss is bounded to the *one* campaign's remaining budget, not a shared
pool. The immutable per-vault mission plan makes the founder's authorized mandate
unambiguous and independently checkable.

---

## 02D — Mission domain, protected setup, and V2 proof

This layer turns the V2 settlement core into an operable, inspectable product. It
does **not** include the AI Mission Brain, public founder onboarding, or any live
deployment.

### Mission lifecycle

`draft` → `active` (locked) → `paused` → `closed`.

- A mission is created as a **draft** (fully editable via `updateMissionDraft`).
- `lockMissionPlan(campaignId, campaignIdHash)` freezes each draft: it computes and
  stores the `MissionSpecV1` digest, stamps `lockedAt`, and moves it to `active`.
  After that, **economics (reward, cap, id hashes) and prose are immutable** —
  `updateMissionDraft` refuses a locked mission. A material change must become a
  **new mission revision** (a new `missionKey`/`missionIdHash`, with `revisionOf`
  pointing at the prior public id). Historical submissions keep the exact mission
  (and `missionSpecDigest`) they were judged against.
- `displayOrder` is presentation-only and may change at any time; it never affects a
  commitment or the spec digest.

### What is on-chain vs application-recorded

- **On-chain (CampaignVault enforces):** `missionIdHash`, exact reward, completion
  cap, total budget, 24h velocity, lifecycle, per-recipient uniqueness, replay
  protection. The vault does **not** store or judge human-language mission prose.
- **Application-recorded (`MissionSpecV1`):** title, objective, instructions, target
  surface, ordered criteria, ordered evidence requirements. Its digest
  (`missionSpecDigest`, golden `0x2b7c5f36…`) is an app-level integrity record — it
  proves the prose Sage evaluated was not silently changed. It is **not** something
  "the chain verified."

### Submission uniqueness

One wallet may be paid **at most once per mission** (not per campaign). Enforced
durably by the DB unique index on `dedupe_key`: V2 submissions use a mission-scoped
key (`missionDedupeKey`), V1 use the campaign-scoped key — one index, keys that never
collide, so V1 semantics are unchanged. Wallet identity is case-insensitive.

### Protected founder/developer setup (`POST /api/campaigns/v2/setup`)

- `{ preview: true }` → **pure** preview (all hashes + budgets). No auth, no writes.
- Otherwise → verify the **deployed** vault with the SAME `evaluateCampaignAgreement`
  the pipeline uses, then persist the campaign + locked missions **atomically** (a DB
  transaction — a failure leaves no active campaign and no partial mission rows).
- **Authorization fails closed:** in production only the SIWE-authenticated founder
  (session wallet == owner) may attach; dev/staging is permitted for the controlled
  exercise. An unprotected query param/button is never authorization.
- The setup mutation **never** accepts a private key, and **never** deploys or funds.
- The **expected settlement token** comes only from the founder's input (persisted as
  `campaigns.settlementToken`) — never read back from the vault being validated.

### V2 proof verification algorithm (`buildProofV2`, never trusts a stored boolean)

For a V2 tx the composer decodes the on-chain `PayoutSettled`/`PayoutRejected` event,
reads the vault snapshot, and **recomputes** the DecisionCommitmentV2, payout intent,
`campaignIdHash`, `missionIdHash`, and `missionSpecDigest` from the stored record. It
is `verified` only when **every** applicable check agrees: receipt chain == campaign
chain; log address == campaign vault; factory provenance; attempt `vaultKind`/
`commitmentVersion`; stored == recomputed == on-chain `campaignIdHash`; stored ==
recomputed == emitted `missionIdHash`; stored == on-chain `missionPlanDigest`;
independent token; emitted recipient == submission wallet; recomputed == emitted ==
stored decision digest; attempt == recomputed == emitted intent; DB == on-chain ==
emitted reward (settlements only); `missionSpecDigest` recomputes and matches the
submission's captured digest. Any mismatch → `commitment_mismatch`; a missing/
uncommitted record → `incomplete_local_record`. **A rejection is never a payment**
(amount 0, `verified` false, V2 mission reason shown); a replay rejection never
overrides a canonical settlement (see 02C.1 `resolveCanonicalOutcome`).

### Dedicated-operator requirement (deployment invariant)

The broadcast-recovery nonce proof (02C.1) is sound **only** because Sage's operator
key is dedicated: no other actor sends transactions from it. This must hold for any
vault Sage settles from.

### Checklist before a controlled Metis Sepolia V2 exercise

1. `forge build` produced `contracts/out/CampaignVault*.json` (checked-in ABIs).
2. A CampaignVault + factory are deployed on 59902; `METIS_CAMPAIGN_FACTORY_ADDRESS`
   (or `CAMPAIGN_VAULT_FACTORY_ADDRESS`) is set (else provenance fails closed → HOLD).
3. Operator key configured (`OPERATOR_PRIVATE_KEY`), funded, and **dedicated**.
4. Vault activated with balance ≥ budget; mission plan matches the DB plan exactly.
5. Attach via `POST /api/campaigns/v2/setup` (founder-authenticated) — it persists
   only if the agreement passes; verify the returned `campaignIdHash`/`missionPlanDigest`.
6. Reuse the exercise MockUSDC as `expectedToken`.
7. Submit real work from a second wallet → Deputy decides → autopilot (or manual)
   settles → grab the settle tx → `GET /api/proof/<tx>` shows `verified: true`,
   `vaultKind: "campaign_v2"`, and the full recomputed `v2` block.

Planned tx sequence (user-run, not in this pass): deploy factory+vault → fund →
activate → attach (DB only) → tester submits → `requestPayout` settles → proof.
