-- REPAIR: a VACUOUS verification policy froze settlement on every observation-only campaign.
--
-- `policyRequired` is `actionCriteria.length > 0`, but the pipeline attached the compiled policy
-- regardless. A plan with zero action criteria therefore stored `{"actionCriteria":[],"probes":[]}`
-- alongside `verification_policy_required = 0`, and `verifyReplayPermit` refuses exactly that
-- combination — "a policy exists while required=false" is an inconsistent covenant, and it fails
-- closed because it cannot tell a deliberate state from a corrupted one.
--
-- A client-side product has no safe GET transitions to replay, so it compiles precisely this empty
-- policy. The result: campaigns that could never pay anyone, silently, forever. Observed on
-- launch-yara-garden-cerk8k, where a real tester's account PASSED the observation bar (5 of 9
-- distinct sources, against a bar of 3) and was held on every sweep regardless.
--
-- The attach path is fixed in code (a policy is stored if and only if it is required). This repairs
-- rows already written, moving them to the consistent "no policy, not required" state the fixed code
-- produces — the same state every other campaign is already in.
--
-- DELIBERATELY NARROW. It touches a row only when ALL of these hold:
--   * the covenant is NOT marked required (so no live covenant is ever weakened), and
--   * a policy is attached, and
--   * that policy governs nothing — no action criteria AND no probes.
-- A policy carrying real action criteria, or any campaign with required=1, is left untouched.
-- Idempotent: re-running matches nothing once repaired.

UPDATE campaigns
SET verification_policy = NULL,
    verification_policy_digest = NULL,
    verification_policy_version = NULL,
    policy_source_revision_number = NULL
WHERE COALESCE(verification_policy_required, 0) = 0
  AND verification_policy IS NOT NULL
  AND json_valid(verification_policy)
  AND json_array_length(json_extract(verification_policy, '$.actionCriteria')) = 0
  AND json_array_length(json_extract(verification_policy, '$.probes')) = 0;
