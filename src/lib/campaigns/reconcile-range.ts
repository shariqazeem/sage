/**
 * Pure block-window planning for the journal reconciler. No I/O, no `server-only`
 * — so it unit-tests directly and the server reconciler imports it.
 */

/** Max blocks scanned per reconcile call — a cold vault can't stall a page load. */
export const RECONCILE_RANGE = 50_000;

export interface ReconcilePlan {
  fromBlock: number;
  toBlock: number;
  /** true when the range was capped and more remains for the next call. */
  capped: boolean;
}

/**
 * The block window to scan next. `null` when nothing new. Caps the span so a
 * vault far behind reconciles incrementally across calls rather than all at once.
 */
export function reconcileRange(
  lastBlock: number,
  latest: number,
  range = RECONCILE_RANGE,
): ReconcilePlan | null {
  const from = lastBlock + 1;
  if (from > latest) return null;
  const span = latest - from + 1;
  const capped = span > range;
  const toBlock = capped ? from + range - 1 : latest;
  return { fromBlock: from, toBlock, capped };
}
