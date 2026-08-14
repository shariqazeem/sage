/**
 * P17 — ONE plain-language sentence per held/decision reason class, used IDENTICALLY across the
 * chat held-list, the held DM, the activity feed, the campaign console, and the ops script. Human
 * words first; the class token stays in the technical register in parentheses. Pure + safe: the
 * input is a fixed reason token (never model free-text, never submitter content).
 *
 * The tokens are the union of the brain's `BriefReasonCode` (evidence_mismatch, no_evidence, …) and
 * the autopilot/settlement gate reasons (below_threshold, mainnet_manual, velocity_cap, duplicate,
 * observation_review). An unknown/absent token degrades honestly, never contradicts a confidence.
 */

import { RETRY_RESERVATION_MINUTES } from "@/lib/campaigns/slot-reservation";

const SENTENCE: Record<string, string> = {
  // brain reason codes
  all_criteria_met: "all criteria were met (all_criteria_met)",
  partial_criteria: "only part of the mission was confirmed (partial_criteria)",
  no_evidence: "the submitted link had no usable evidence (no_evidence)",
  evidence_mismatch: "the public page couldn't confirm this work (evidence_mismatch)",
  contradiction: "the account contradicts what the page shows (contradiction)",
  spam: "the submission looks like spam (spam)",
  prompt_injection: "the submission tried to manipulate the reviewer (prompt_injection)",
  // gate / settlement reasons
  below_threshold: "confidence was below the auto-pay bar (below_threshold)",
  mainnet_manual: "mainnet payouts wait for your approval (mainnet_manual)",
  velocity_cap: "the campaign's payout-velocity cap was reached (velocity_cap)",
  duplicate: "this account already submitted for this mission (duplicate)",
  duplicate_account: "the report closely matches another submission — possible multi-wallet farming (duplicate_account)",
  observation_review: "observation-based work that needs your judgment (observation_review)",
  observation_retry: "the tester is refining thin-but-genuine work; Sage is re-judging (observation_retry)",
  // A submission that PASSED the whole observation bar while autopay is unarmed. It must never read
  // as a verdict on the work — Sage verified it; only the release switch is off.
  observation_verified:
    "Sage verified this account against its own private observations — it's ready to pay and only awaits release (observation autopay is off) (observation_verified)",
  // settlement-covenant reasons. These say the CAMPAIGN could not be settled — they are never a
  // verdict on the tester's work, and the wording must not read like one. The first real tester on the
  // yara campaign passed the bar and was shown "the submitted link had no usable evidence"; a sentence
  // that blames the worker for a configuration fault is worse than an opaque one.
  action_replay_permit_denied:
    "the campaign's settlement covenant is in an inconsistent state — this is a campaign configuration fault, not a problem with the submitted work (action_replay_permit_denied)",
  covenant_frozen: "the campaign's settlement covenant is frozen by operator configuration (covenant_frozen)",
  covenant_metadata_incomplete:
    "the campaign's settlement covenant is missing metadata it requires (covenant_metadata_incomplete)",
};

/** The reason CLASS — everything before the first colon. `action_replay_permit_denied:inconsistent:…`
 *  carries operator detail after the class, which belongs in logs rather than in a tester's face. */
function reasonClassOf(code: string): string {
  const head = code.split(":")[0]?.trim();
  return head && SENTENCE[head] ? head : code;
}

/**
 * P20 — leak-safe coaching for a RETRYABLE observation hold, shown to the TESTER (never the founder log).
 * Counts + attempts only: it names HOW MANY of Sage's own observations the account matched and how many
 * remain, but NEVER which corpus items exist, which matched, or any corpus text. That invariant (the P16
 * leak rule) is what lets us coach a tester without handing them the answer key. Pure: the only inputs are
 * two integers already published as counts.
 */
export function observationCoaching(distinctMatched: number, keySources: number, attemptsLeft: number): string {
  const left = attemptsLeft === 1 ? "1 attempt left" : `${attemptsLeft} attempts left`;
  return (
    `You matched ${distinctMatched} of the ${keySources} things Sage saw for itself. ` +
    `To clear it, describe more of what you actually did and saw — the specific screens you opened, ` +
    `the exact labels and text you read, what happened when you clicked. Then resubmit (${left}). ` +
    `Your slot is held while you do — nobody else can take it for the next ${RETRY_RESERVATION_MINUTES} minutes.`
  );
}

/**
 * P-CRIT — coaching that names WHICH REQUIREMENT is still unmet, instead of a running total.
 *
 * "You matched 2 of 9 things Sage saw" tells a tester they are short without telling them of what, so
 * the only strategy it suggests is "write more", which is exactly how a genuine tester ends up padding.
 * Once a mission carries a criterion contract, Sage knows precisely which requirement has no evidence
 * yet — and naming it leaks NOTHING: the criteria are printed on the mission card the tester is reading.
 *
 * The no-oracle rule still holds absolutely. This says WHICH requirement is outstanding; it never says
 * what would satisfy it, never hints at a corpus item, and never reveals whether a phrase was close.
 */
export function observationCriteriaCoaching(
  missingCriteria: readonly number[],
  criteria: readonly string[],
  attemptsLeft: number,
): string | null {
  const named = missingCriteria
    .map((i) => criteria[i])
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  if (named.length === 0) return null;
  const left = attemptsLeft === 1 ? "1 attempt left" : `${attemptsLeft} attempts left`;
  const list = named.map((c) => `• ${c.trim()}`).join("\n");
  return (
    `Your account covers part of this mission, but Sage can't yet see evidence for:\n${list}\n\n` +
    `Add what you actually did for that part and what you saw happen — the screen you were on, the ` +
    `exact text that appeared, what changed after you acted. Then resubmit (${left}).\n\n` +
    `Your slot is held while you do — nobody else can take it for the next ${RETRY_RESERVATION_MINUTES} minutes.`
  );
}

/** The founder-facing one-liner for a still-retryable observation hold (no DM fires; this is log-only). */
export function observationRetryLine(attempt: number, maxAttempts: number): string {
  return `Held for the tester to refine — attempt ${attempt} of ${maxAttempts}, no action needed yet (observation_retry)`;
}

/** The plain-language sentence for a reason token. Unknown/absent → an honest fallback. */
export function reasonSentence(code: string | null | undefined): string {
  if (!code) return "Sage couldn't reach a confident decision (unknown)";
  const key = reasonClassOf(code);
  return SENTENCE[key] ?? `Sage couldn't reach a confident decision (${code})`;
}

/** A held headline line for the feed / chat / DM: "Held: <sentence>". */
export function heldLine(code: string | null | undefined): string {
  return `Held: ${reasonSentence(code)}`;
}

/** The feed/console verb + detail for a decision outcome, so no surface implies a verification that
 *  did not happen. pay/verified → "Verified"; hold → "Held: <reason>"; blocked → "Blocked: <reason>". */
export function decisionLabel(kind: "verified" | "paid" | "held" | "blocked" | "received", code?: string | null): string {
  switch (kind) {
    case "received":
      return "Received";
    case "verified":
      return "Verified";
    case "paid":
      return "Paid";
    case "held":
      return heldLine(code);
    case "blocked":
      return `Blocked: ${reasonSentence(code)}`;
  }
}
