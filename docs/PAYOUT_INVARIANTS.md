# Payout invariants

> The safety contract for moving real USDC. Every payout Sage's Deputy makes is
> **at-most-once**, **bound to the AI decision that authorized it**, and **always
> recorded** — even across a crash. This document is the canonical statement of
> those invariants and the three layers that enforce them. When code and this
> document disagree, treat it as a bug in one of them and reconcile deliberately.

The payout path is defended in depth. No single layer is trusted to be perfect;
each one holds even if the one above it fails.

```
   AI decision  ──►  Decision commitment (P2)  ──►  Durable attempt ledger (P3)  ──►  Policy Vault (P1)
   (advisory)        binds intent to decision       records every attempt            enforces, settles once
```

---

## Layer 1 — the Policy Vault (on-chain, the last word)

The vault is the only thing that can move money, and it is the ultimate backstop.
The AI proposes (`requestSpend`); the chain disposes. `requestSpend` runs seven
checks in a fixed order and **soft-rejects** (returns `false` + emits
`SpendRejected(failedCheckIndex)`) on the first failure — it never reverts on a
policy failure, so the caller always learns which check stopped it.

| # | Check          | Rejects when …                                            |
| - | -------------- | --------------------------------------------------------- |
| 1 | Vault state    | paused, expired, or revoked                               |
| 2 | Authorized caller | caller is not the operator                             |
| 3 | Approved recipient | recipient is not on the allowlist                    |
| 4 | Per-payout cap | amount exceeds the per-transaction cap                    |
| 5 | Remaining budget | payout would exceed the budget ceiling                  |
| 6 | 24h velocity cap | payout would exceed the rolling daily cap               |
| 7 | **Replay guard** | **this exact committed intent has already settled**     |

**Invariant 1 — an intent settles at most once.** Check 7 reads a
`mapping(bytes32 intentHash => bool) _usedIntents`. It is evaluated **after**
checks 1–6 and **before** any state change or transfer:

- _After 1–6_ so a payout rejected for a *policy* reason (1–6) is **never
  consumed** and stays retryable once its condition is resolved (budget freed, a
  recipient allowlisted, a pause lifted). Only checks that would otherwise let the
  money move reach the replay guard.
- _Before effects_ (Checks-Effects-Interactions): the intent is marked used, then
  the running total is updated, then `safeTransfer` runs. A used intent can never
  reach the transfer a second time, even under reentrancy (the vault also holds a
  `nonReentrant` guard).

**Invariant 2 — a settlement is locatable by its intent.** `SpendSettled` and
`SpendRejected` both carry an **indexed** `intentHash`, so any settlement can be
found on-chain by the intent that produced it — the basis for crash reconciliation
(Layer 3). `isIntentUsed(bytes32) view returns (bool)` exposes the guard for reads.

Consumed-intent state has **no setter**: neither the owner nor the operator can
clear a used intent. Once settled, always settled.

_Enforced by:_ `contracts/src/PolicyVault.sol`,
`contracts/src/interfaces/IPolicyVault.sol`. _Proven by:_ the replay suite in
`contracts/test/PolicyVault.t.sol` (one intent settles once; a replay moves zero
tokens and rejects with index 7; a policy-rejected intent is not consumed and can
later settle; two distinct intents pay the same recipient; replay holds across
pause/unpause; consumed state is immutable).

---

## Layer 2 — the decision commitment (P2, off-chain, canonical)

The value that moves money is not an opaque nonce — it is a **function of the exact
AI decision that authorized the payout**. `computeDecisionCommitment` hashes the
decision into a `decisionDigest` via canonical ABI encoding (`encodeAbiParameters`
+ `keccak256`, **never `JSON.stringify`**), and derives the on-chain
`payoutIntentHash` from that digest with a domain separator.

The digest commits to, in a fixed order:

- domain tag + version, `chainId`, vault address;
- campaign / submission / decision ids (hashed);
- recipient and amount (base units);
- the evidence SHA-256 (or zero when none was fetched);
- the recommendation, the machine-gradable `reasonCode`, and confidence at
  **basis-point** resolution;
- the model and provider (hashed);
- the ordered criteria results (each: criterion, met, confidence-bps, quote hash);
- the ordered accepted-quote hashes and the ordered fraud-signal digests.

**Invariant 3 — the payout is bound to its decision.** Change any committed field
— a criterion's result, a quote, the confidence, the recipient, the amount, the
model — and `payoutIntentHash` changes. A payout therefore cannot be silently
re-pointed at a different recipient, amount, or a weaker judgment than the one on
record. A third party can recompute the commitment from the stored decision and
confirm it matches what settled on-chain.

Confidence is committed at basis-point resolution so a float that re-serializes
with a different tail commits to the same value; addresses are checksum-validated
and a malformed address is a hard failure, never a silent zero.

When no decision exists on record, the path falls back to the legacy
per-(campaign, submission) intent (`decisionDigest = null`) — still deterministic,
just not decision-bound. Such payouts render as "legacy" in the proof.

_Enforced by:_ `src/lib/deputy/payout-commitment.ts`,
`src/lib/campaigns/settle.ts` (`derivePayoutIntent`). _Proven by:_
`payout-commitment.test.ts` (determinism, a golden-pinned encoding, and a
sensitivity matrix asserting every committed field is load-bearing).

---

## Layer 3 — the durable attempt ledger (P3, off-chain, crash-safe)

The chain guarantees an intent settles at most once. The ledger guarantees the app
always **learns which way an attempt went** — even if the process dies between
broadcasting the tx and reading its receipt. Exactly one row exists per
`payoutIntentHash` (a unique index), moving through
`prepared → broadcast → settled | rejected | failed`.

The settle path (`settleWithRecovery`) is:

1. **prepare** — write the attempt row *before* anything is broadcast.
2. **plan** — `planResume(attempt)` decides the next move from persisted state.
3. **broadcast** — send `requestSpend`; the `onBroadcast` hook persists the
   txHash **the instant it is sent**, before the receipt is awaited (the
   crash-critical write).
4. **record** — decode the vault's own event and mark `settled` / `rejected`.

**Invariant 4 — never a blind resend.** `planResume` is a pure function of the
attempt row:

| Persisted state              | Resume action                                             |
| ---------------------------- | --------------------------------------------------------- |
| no row / `prepared`, no tx   | **broadcast** a fresh tx                                  |
| `broadcast` (tx on record)   | **await** that tx's receipt — never re-send               |
| `settled` / `rejected`       | return the **recorded outcome** — never touch the chain   |
| `failed` / anomalous         | **verify** `isIntentUsed` on-chain *before* any resend    |

A re-trigger of a completed payout returns the recorded result. A crash mid-flight
resumes by reading the persisted tx. An errored attempt checks the chain first: if
the intent already settled it reconciles the settle tx via the indexed
`intentHash`; only if the intent truly did not settle does it broadcast again. A
policy-rejected result that produced no tx (e.g. recipient not yet allowlisted)
leaves the attempt `prepared` so a later re-fire can resume it.

_Enforced by:_ `src/lib/db/settlement-attempts.ts`,
`src/lib/campaigns/settle.ts`, `src/lib/deputy/signer.ts`
(`submitRequestSpend` / `awaitSpendOutcome`), `src/lib/deputy/chain.ts`
(`isIntentUsed` / `findSettleTxByIntent`). _Proven by:_
`settlement-attempts.test.ts` (ledger + `planResume`) and
`settle-recovery.test.ts` (decision-binding, settle-once, no re-pay on re-trigger,
resume-by-read on crash, chain-reconcile on error, no re-charge on reject).

---

## How the layers compose

- A **double-trigger** (two workers, a cron + a manual click): the DB `casSubmissionStatus`
  serializes to one settle; the attempt ledger's unique intent serializes further;
  and even if both reached the chain, check 7 lets only one move money.
- A **crash between broadcast and receipt**: the txHash is on disk (step 3), so the
  resume reads that tx instead of re-sending; if the hash itself was lost, the
  `verify` path finds the settle via the indexed intent before ever resending.
- A **tampered payout** (different recipient/amount than the decision): the intent
  hash changes (Invariant 3), so it is a *different* intent — it does not inherit
  the original's settled/authorized state.

## The sandbox exclusion

The public "try to jailbreak the Deputy" sandbox campaign can **never** settle:
`settleSubmission` and `settleWithRecovery` both **throw** on `campaign.sandbox`
before any DB or chain call. Payment is structurally unreachable, not merely gated,
and sandbox activity is excluded from the reputation record.

_Proven by:_ `src/lib/redteam/isolation.test.ts`.

---

## Layer 0 — legacy-vault capability gate (before autonomy, off-chain)

Replay protection (Layer 1) only exists on vaults deployed from the **upgraded**
`PolicyVault`. Vaults deployed before that upgrade lack `isIntentUsed` / check 7,
so the app must not present them as replay-safe or auto-pay real money from them.

`supportsIntentReplayProtection(vault, chainId)` probes `isIntentUsed` with a
harmless deterministic value and returns a **three-state** result — never a
boolean:

- **supported** — a boolean answer proves the guard exists.
- **legacy** — the call returns no data / reverts (the function is absent): a
  CONFIRMED pre-upgrade vault.
- **unreadable** — a transport error (RPC down): NOT proof of legacy status.

**Invariant 5 — no autonomous real-money payout from an unproven vault.** On a
mainnet chain the autopilot preflight HOLDS unless the vault is `supported`:
a `legacy` vault holds with *"Legacy vault — replay-protected autonomy requires an
upgraded vault."*, and an `unreadable` capability also holds (uncertainty is never
resolved in favour of paying). Testnet vaults are exempt (test USDC). Manual
approval remains available; the UI warns that a legacy vault predates on-chain
intent replay protection. Definitive answers are cached briefly; `unreadable` is
never cached.

_Enforced by:_ `src/lib/deputy/vault-capability.ts`, `src/lib/deputy/pipeline.ts`.
_Proven by:_ `vault-capability.test.ts` (supported / legacy / unreadable, cache
behaviour, mainnet predicate, exact hold reasons).

## The public proof: what "verified" means

`composeProof(tx)` (`src/lib/deputy/proof.ts`) is the ONE server-side join behind
the proof page, the JSON API, the OG image, and the agent profile. It returns an
explicit **state**, never a lone boolean:

`committed_settlement` · `committed_rejection` · `legacy_settlement` ·
`legacy_rejection` · `commitment_mismatch` · `incomplete_local_record` ·
`not_found`.

For a decision-committed payout it recomputes the digest from the stored brief and
compares **three** independent sources — the recomputed `payoutIntentHash`, the
`settlement_attempt.payoutIntentHash`, and the on-chain event `intentHash`. It
shows *"Decision committed on-chain"* only when all three agree. If they diverge it
renders a `commitment_mismatch` **integrity warning** with a machine-readable
reason — a mismatch can NEVER be presented as verified. A payout with no
decision-commitment record is a valid **payment** proof, honestly labelled
*"Legacy payout — this transaction predates decision commitment v1."* — not a
decision-commitment proof.

_Proven by:_ `proof.test.ts` (all seven states; a mismatch never renders committed).

## Language discipline (public copy)

These are DIFFERENT claims and the UI keeps them apart:

- **Configure the mandate once** ≠ one wallet signature per payout.
- **Registered ERC-8004 identity** ≠ an on-chain reputation score. The identity
  links *who*; the record is *derived from* the verifiable transaction journal.
- **Tested attack resistance** (15/15 adversarial cases held) ≠ mathematical
  impossibility.
- **Application-ledger recovery** (Layer 3, this app) ≠ **contract replay
  protection** (Layer 1, the upgraded vault). A pre-upgrade vault has the former,
  not the latter.
- **A successful transaction receipt** ≠ a committed AI decision unless the three
  intent hashes match.
- **Test USDC** (Metis Sepolia) ≠ **real mainnet USDC** (GOAT). Combined totals
  say they are combined and are split per chain; a mainnet figure never silently
  includes testnet.

## Quality gates for this path

Any change to the payout path must keep all of these green:

```bash
forge test --root contracts     # the vault + replay invariants
npm run typecheck               # strict TS
npm run test                    # unit/component (commitment, ledger, recovery, isolation)
npm run lint
npm run build
```
