/**
 * Mission-DESIGN-only model override.
 *
 * The Mission Brain (architect + critic, `mission-brain.ts`) resolves its model through
 * this helper by passing the result into `llmCompleteJson({ model })` → `resolveLlm`.
 * The payout/JUDGMENT brain (`brain.ts::deputyModel`) is SEPARATE code that never calls
 * `resolveLlm`, so nothing here can change judgment's resolved model.
 *
 * When `MISSION_MODEL` is unset this returns `undefined`, so `resolveLlm(undefined)` falls
 * through to the exact shared chain, unchanged: `LLM_MODEL → DEPUTY_MODEL → default`. When
 * set, the mission chain becomes `MISSION_MODEL → LLM_MODEL → DEPUTY_MODEL → default` —
 * mirroring the `CONCIERGE_MODEL` per-role pattern so mission design can run a different
 * model than the red-team-validated judgment model.
 */
export function missionModel(): string | undefined {
  return process.env.MISSION_MODEL?.trim() || undefined;
}
