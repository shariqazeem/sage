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
  observation_review: "observation-based work that needs your judgment (observation_review)",
};

/** The plain-language sentence for a reason token. Unknown/absent → an honest fallback. */
export function reasonSentence(code: string | null | undefined): string {
  if (!code) return "Sage couldn't reach a confident decision (unknown)";
  return SENTENCE[code] ?? `Sage couldn't reach a confident decision (${code})`;
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
