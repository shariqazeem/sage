/**
 * Pure control logic for the live investigation feed — polling only, no SSE.
 * The UI (review-panel, submit-panel, public-feed) polls a light endpoint and
 * feeds the raw rows through these helpers. Keeping the decisions here (no React,
 * no I/O) means the start/stop conditions and the change-detection are unit-tested
 * directly, and the components stay thin.
 *
 * The honesty contract (CLAUDE.md §5): the feed reflects real server state. These
 * helpers only *observe* state transitions — they never invent one.
 */

/** The minimal projection of a submission the poll logic needs. */
export interface PollSub {
  id: string;
  status: string;
  /** whether a real decision brief has landed (a placeholder is NOT a brief). */
  hasBrief: boolean;
  /** a compact fingerprint of the brief so an upgrade (heuristic→llm, conf change) is seen. */
  briefFingerprint: string;
  autopayState: "settled" | "held" | null;
  payoutTx: string | null;
}

/** Statuses a submission can no longer leave — nothing left to poll for. */
const TERMINAL = new Set(["paid", "rejected", "blocked"]);

/** Is this submission in a terminal state (from the poster's queue view)? */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

/**
 * Should the poster's review queue keep polling? Yes while the Deputy still has
 * async work that will change the screen:
 *   · a pending submission whose real brief hasn't landed yet, OR
 *   · (autopilot campaign) any pending submission — the Deputy may settle/hold it, OR
 *   · a submission mid-settle.
 * When every submission is terminal / approved-awaiting-manual / already-briefed on
 * a manual campaign, there is nothing left to observe — stop.
 */
export function shouldKeepPolling(subs: PollSub[], autonomy: string): boolean {
  return subs.some((s) => {
    if (s.status === "settling") return true;
    if (s.status === "pending" && !s.hasBrief) return true;
    if (s.status === "pending" && autonomy === "autopilot") return true;
    return false;
  });
}

/** Should the worker keep polling their own submission? While it isn't terminal. */
export function workerShouldPoll(status: string): boolean {
  return !isTerminalStatus(status);
}

/**
 * A compact version string for the whole set — the client compares it to the last
 * one and skips re-rendering when nothing meaningful changed (no re-render storms).
 * Captures every field the UI renders off of, so a real change is never missed and
 * an identical payload is always a no-op.
 */
export function payloadVersion(subs: PollSub[]): string {
  return subs
    .map(
      (s) =>
        `${s.id}:${s.status}:${s.hasBrief ? 1 : 0}:${s.briefFingerprint}:${s.autopayState ?? "-"}:${s.payoutTx ?? "-"}`,
    )
    .join("|");
}

/**
 * Diff two poll snapshots to find the two transitions that drive animation:
 *   · briefArrived — a submission that gained its real brief (null → present),
 *     which fires the receipt "materialize".
 *   · settled — a submission that just reached paid with a real tx, which drives
 *     the SettleRail cascade + payout count-up + ring drain.
 * Only forward transitions are reported; a resend of the same state yields neither.
 */
export function diffLive(
  prev: PollSub[],
  next: PollSub[],
): { briefArrived: string[]; settled: string[] } {
  const prevById = new Map(prev.map((s) => [s.id, s]));
  const briefArrived: string[] = [];
  const settled: string[] = [];
  for (const s of next) {
    const p = prevById.get(s.id);
    if (s.hasBrief && !(p?.hasBrief ?? false)) briefArrived.push(s.id);
    if (s.status === "paid" && s.payoutTx && p?.status !== "paid") settled.push(s.id);
  }
  return { briefArrived, settled };
}

/** A stable fingerprint of a brief (or its absence) for the version string. */
export function briefFingerprint(
  brief:
    | { engine: string; recommendation: string; reasonCode?: string; confidence: number }
    | null
    | undefined,
): string {
  if (!brief) return "0";
  const conf = Math.round((Number.isFinite(brief.confidence) ? brief.confidence : 0) * 100);
  return `${brief.engine}:${brief.recommendation}:${brief.reasonCode ?? "?"}:${conf}`;
}
