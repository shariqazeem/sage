# Gate A–C release candidate — three configurations

Gate A–C is a **dark engineering checkpoint**. Nothing here is deployed. This document is the exact
proposed configuration for the release candidate and the two later states it unlocks. The code is
identical across all three; only the environment flags and the approved-identity registry differ.

## The three configurations

| Flag / registry | DARK (release now) | SHADOW (after a clean promotion run + egress review) | ENFORCE (later) |
| --- | --- | --- | --- |
| `RENDERED_EVIDENCE_MODE` | `off` | `shadow` | `enforce` |
| `ENTAILMENT_MODE` | `off` | `shadow` | `enforce` |
| `DEPUTY_AUTOPILOT_MAINNET` | unchanged (off unless the founder already set it) | unchanged | unchanged |
| autopay approved-identity registry | **EMPTY** (payout-parse-v3 is a CANDIDATE) | the evaluated identity registered after a conclusive P-JUDGE | (unchanged) |
| judge model | `google/gemini-3.1-flash-lite-preview` (as deployed) | (unchanged; a Haiku promotion is a separate decision) | (unchanged) |
| action probes | none | none | none |

`OBSERVATION_AUTOPAY` and the observation path are **out of scope** for this gate and are not changed
by any row above.

## DARK — what would change if this code were deployed today

- **Money path is stricter (subtract-only).** A payout is admitted only on an explicit normal completion
  (`stop`); an absent/abnormal finish, a truncation, or a refusal fails closed. The money parse is strict
  (no repair). Both can only *reduce* autopay recall, never increase it.
- **Url-verifiable autopay HOLDS for manual review.** The approved-identity registry is empty, so the
  identity gate blocks every would-be autopay (`judge_identity_unapproved`) and it becomes a review. This
  is the intended fail-safe until a conclusive promotion run registers an identity.
- **The entailment veto does not run** (`ENTAILMENT_MODE=off`).
- **Rendered evidence does not run** (`RENDERED_EVIDENCE_MODE=off`); the payout path is byte-identical to
  pre-W2 static evidence.
- **The Field Test, if enabled, routes through the guarded egress proxy.** Any attacker-controlled product
  URL it browses is resolved/validated/pinned by the proxy; private/loopback/metadata destinations are
  refused. (Inspection behaviour is otherwise unchanged.)

### What stays DARK

- Rendered evidence capture (off); rendered shadow is **prohibited for untrusted URLs** until the egress
  boundary is reviewed.
- The entailment veto (off).
- Autopay on the url-verifiable path (held — empty registry).
- `payout-parse-v3` approval (candidate only).
- Any Haiku promotion, action probes, vision/model-routing.

## SHADOW — the next state, and its preconditions

Move here **only after**: (1) a *conclusive* live P-JUDGE run (the resumable runner collected the required
number of valid responses from the candidate model with zero unexpected wrong-autopay) registers an
`ApprovalRecord`; and (2) the browser egress boundary has been reviewed and signed off.

- Autopay resumes **only** for the registered identity.
- `ENTAILMENT_MODE=shadow`: the veto runs on would-be autopays and journals its verdicts (digests only) —
  the payout is **unchanged**.
- `RENDERED_EVIDENCE_MODE=shadow`: the renderer runs behind the egress proxy and a static-vs-rendered
  comparison is recorded — the payout is **unchanged** (static evidence still reaches the judge).

## ENFORCE — later, per-subsystem, each after its own shadow bake

- `ENTAILMENT_MODE=enforce`: a not_entailed/uncertain/failure downgrades a would-be autopay to review.
- `RENDERED_EVIDENCE_MODE=enforce`: rendered text may reach the judge (with the same untrusted markers +
  caps as static). Requires the egress boundary review to have passed.

Each enforce flip is independent and reversible, and none of them is part of this gate.
