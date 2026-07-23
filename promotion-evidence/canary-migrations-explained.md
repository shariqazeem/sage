# Phase 0 — migrations 0026 & 0027 explained (self-canary release candidate)

Both are **additive, nullable, and NOT applied to production** this sprint. Neither touches an on-chain
commitment; both only enable the off-chain VerificationPolicy / replay-journal machinery, which can only
*subtract* settlement eligibility.

## 0026_simple_ben_grimm — campaign policy binding
- **Adds** to `campaigns`: `verification_policy` (text, JSON mode, **nullable**, no default) and
  `verification_policy_digest` (text, **nullable**). No index.
- **Why:** the deputy must load the immutable `VerificationPolicyV1` (one `MissionProbeV1` per action mission)
  by campaign at settlement, and re-verify its digest.
- **Nullable/default:** every campaign starts `NULL` → not a canary campaign → payout replay **skips** →
  byte-identical existing behaviour.
- **Clean install:** columns present, all `NULL`.
- **Upgrade:** every existing row gets `NULL`; no back-fill; unaffected.
- **Runtime BEFORE migration:** the columns do not exist, so any Drizzle read that selects them errors. This is
  exactly why the Phase 2 **release preflight refuses `PAYOUT_ACTION_REPLAY_MODE=canary` when the columns are
  missing** — it fails before a submission is processed, never after a PAY decision.
- **Rollback:** dropping the two columns loses any **policy binding** (campaigns revert to "no policy" → replay
  skips). It loses **no decision/settlement record** and no replay journal.

## 0027_glossy_omega_flight — payout replay idempotency journal
- **Adds** table `payout_replay_journal` (id PK; submissionId; policyDigest; probeDigest; decision; outcomeCode;
  startedAt; completedAt nullable; latencyMs nullable; attempt default 1; probeVersion default "mission-probe-v1")
  + **unique index** `prj_key_unq (submission_id, policy_digest, probe_digest)`.
- **Why:** idempotency — a completed replay result for the exact (submission, policy, probe) is reused on a
  payout retry; an in-flight row (crash) is reconciled by re-running (replay is read-only).
- **Nullable/default:** `completedAt` NULL = in-flight; `attempt`/`probeVersion` defaulted.
- **Clean install / upgrade:** empty table created; no back-fill.
- **Runtime BEFORE migration:** the table is missing → journal reads/writes error → the Phase 2 preflight
  refuses canary mode (fails before processing a submission).
- **Rollback:** dropping the table loses the **replay idempotency journal** (cached replay outcomes) only. It
  loses **no** policy binding and **no** settlement record. A payout retry would simply re-run the read-only
  replay; settlement idempotency (vault intentHash + the `pending→settling` CAS) is separate and still prevents
  any duplicate payout.
