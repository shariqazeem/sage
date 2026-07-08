/**
 * Pure state logic for the owner-signed allowlist flow — no wallet, no I/O, so
 * it unit-tests directly. The client orchestrator (vendor-add.ts) reads the
 * chain and feeds these classifiers; the review UI renders from them.
 *
 * The vault only pays pre-approved recipients, and additions are timelocked by
 * design. That is the security model, so "waiting" is a feature to display, not
 * an error to hide.
 */
export type AllowlistPhase = "approved" | "ready" | "waiting" | "unqueued";

export interface AllowlistItemState {
  phase: AllowlistPhase;
  /** seconds until executable (only meaningful for "waiting"), else 0. */
  secondsLeft: number;
}

/**
 * Classify one recipient from its on-chain reads.
 * - approved: already on the allowlist (nothing to do)
 * - unqueued: not approved, no pending add (needs queueing)
 * - waiting: queued, still inside the timelock (show a countdown)
 * - ready: queued and mature (can execute now)
 */
export function allowlistItemState(input: {
  approved: boolean;
  /** getPendingVendorReadyAt — 0 means nothing queued. */
  pendingReadyAt: number;
  now: number;
}): AllowlistItemState {
  if (input.approved) return { phase: "approved", secondsLeft: 0 };
  if (input.pendingReadyAt === 0) return { phase: "unqueued", secondsLeft: 0 };
  const left = input.pendingReadyAt - input.now;
  if (left <= 0) return { phase: "ready", secondsLeft: 0 };
  return { phase: "waiting", secondsLeft: left };
}

/** The single status a batch presents, folded from its items' phases. */
export function batchAllowlistPhase(phases: AllowlistPhase[]): AllowlistPhase {
  if (phases.length === 0) return "approved";
  if (phases.every((p) => p === "approved")) return "approved";
  if (phases.some((p) => p === "waiting")) return "waiting";
  if (phases.some((p) => p === "ready")) return "ready";
  return "unqueued";
}

/** Compact countdown label: "9m 58s" / "45s". */
export function formatCountdown(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}
