/**
 * WHAT A POLLING AGENT SEES WHILE IT WAITS.
 *
 * `sage_start_inspection` returns in about a second, then real browsing runs for minutes. Until now
 * the poll response carried only `stage: "generating_missions"` with `pagesInspected: 0` and
 * `plan: null` — indistinguishable from a hung job. Measured on prod: a bot-walled SaaS site took
 * **633 seconds** and produced a good plan from 12 browser states, but for the first ten minutes a
 * caller had no way to tell it apart from a failure, and would reasonably have given up.
 *
 * That is the async contract, not a cosmetic detail: an agent that cannot tell "working" from
 * "stuck" will report the tool as broken. So every non-terminal poll now says what Sage is doing,
 * how long it has been doing it, and when to ask again.
 *
 * Pure — no clock, no DB. The caller supplies elapsed seconds.
 */

/**
 * THE ONE ESTIMATE. Every place the service quotes how long an inspection takes reads this: the
 * `asyncContract` on sage_start_inspection, the `progress` object on every poll, and the marketplace
 * listing text. Measured on prod — notion.so 231s, linear.app 633s (bot-walled).
 *
 * It is a shared constant rather than three literals because it already drifted once: `progress`
 * shipped 120-660 while the contract and the listing said 240-660, and one service quoting two
 * different waits is exactly what "results don't match the description" means.
 */
export const START_INSPECTION_ESTIMATE = { typical: 240, upTo: 660 } as const;

/** The inspection lifecycle, in the order the pipeline stamps them. */
const ORDER = [
  "queued",
  "fetching",
  "field_test",
  "mapping",
  "analyzing",
  "generating_missions",
  "reviewing",
] as const;

const NOTES: Record<string, string> = {
  queued: "Queued. Sage is about to open the product.",
  fetching: "Reading the product's pages.",
  field_test:
    "Browsing the product in a real browser, like a first-time user would — clicking through screens and filling forms. This is the long part, and it is longer on sites that challenge automated visitors.",
  mapping: "Working out what the product actually is from what it saw.",
  analyzing: "Deciding which parts of the product a tester can meaningfully verify.",
  generating_missions: "Writing the testing missions and splitting the budget across them.",
  reviewing: "Checking each mission against what it actually observed, and dropping any it cannot back with evidence.",
};

/**
 * How long to wait before polling again. Short while the job is starting (it may finish fast on a
 * simple page), longer once it is inside the browser stage where nothing changes for minutes.
 */
function pollSeconds(stage: string, elapsedSeconds: number): number {
  if (stage === "queued" || stage === "fetching") return 10;
  if (elapsedSeconds < 60) return 15;
  return 30;
}

export interface InspectionProgress {
  /** Plain sentence: what Sage is doing right now. */
  note: string;
  /** Seconds since the inspection was started. */
  elapsedSeconds: number;
  /** Poll again after this many seconds. */
  nextPollSeconds: number;
  /** 1-based position in the lifecycle, so a caller can show "step 3 of 7" without parsing names. */
  step: number;
  totalSteps: number;
  /**
   * Honest expectation, stated once rather than implied. A simple page finishes in a couple of
   * minutes; a site that blocks automated visitors pushes Sage onto the slow browser path.
   *
   * MUST equal the range `sage_start_inspection` advertises in `asyncContract.estimatedSeconds` and
   * the range the marketplace listing states. Three numbers for one wait is precisely the kind of
   * self-contradiction a conformance reviewer reads as "the service does not do what it says" — this
   * field said 120-660 while the other two said 240-660.
   */
  typicalTotalSeconds: string;
}

/** Progress for a non-terminal stage; null for ready/needs_input/failed/superseded (nothing to wait for). */
export function inspectionProgress(
  stage: string,
  elapsedSeconds: number,
): InspectionProgress | null {
  const idx = (ORDER as readonly string[]).indexOf(stage);
  if (idx === -1) return null;
  const elapsed = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? Math.floor(elapsedSeconds) : 0;
  return {
    note: NOTES[stage] ?? "Working.",
    elapsedSeconds: elapsed,
    nextPollSeconds: pollSeconds(stage, elapsed),
    step: idx + 1,
    totalSteps: ORDER.length,
    typicalTotalSeconds: `${START_INSPECTION_ESTIMATE.typical}-${START_INSPECTION_ESTIMATE.upTo}`,
  };
}
