/**
 * The Deputy's reasoning about a submission — computed server-side so it can
 * never be client-fabricated. This is what the reviewer sees BEFORE they confirm:
 * the checks the Deputy ran (uniqueness is already DB-enforced), which acceptance
 * criteria the evidence appears to meet, an anti-spam read, the exact payout it
 * computed, and its recommendation.
 *
 * v1 uses honest, transparent heuristics — signals, not verdicts. The shape is
 * LLM-ready: swap `criterionMet` for a semantic model call and everything above
 * it (recommendation, UI) is unchanged. No dependency, no key needed today.
 */

export interface CriterionSignal {
  criterion: string;
  /** true when the submission shows a real signal of meeting it. */
  met: boolean;
}

export type SpamRisk = "low" | "medium" | "high";
export type Recommendation = "pay" | "review" | "hold";

export interface DeputyAssessment {
  evidencePresent: boolean;
  noteQuality: "none" | "brief" | "substantive";
  criteria: CriterionSignal[];
  criteriaMet: number;
  criteriaTotal: number;
  spamRisk: SpamRisk;
  spamReasons: string[];
  /** exact payout in USDC base units (6dp) — deterministic. */
  payoutBase: number;
  recommendation: Recommendation;
}

const STOP = new Set([
  "the", "and", "for", "your", "you", "with", "that", "this", "was", "are",
  "has", "have", "one", "any", "get", "got", "via", "per", "not", "but",
  "into", "from", "our", "all", "how", "who", "its", "his", "her",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

function noteQuality(note: string | null): DeputyAssessment["noteQuality"] {
  const n = (note ?? "").trim();
  if (!n) return "none";
  return n.length < 15 ? "brief" : "substantive";
}

/** Heuristic signal that one criterion is met. Honest, transparent, LLM-swappable. */
function criterionMet(
  criterion: string,
  evidenceUrl: string | null,
  note: string | null,
): boolean {
  const c = criterion.toLowerCase();
  const n = (note ?? "").trim();
  const hasEvidence = !!evidenceUrl;

  // Evidence-type criteria are satisfied by a present link.
  if (
    hasEvidence &&
    /\b(evidence|link|url|proof|screenshot|resolve|explorer|repo|pull request|pr|tx|transaction|on-chain|onchain)\b/.test(
      c,
    )
  ) {
    return true;
  }
  // Note/report-type criteria are satisfied by a substantive note.
  if (
    n.length >= 15 &&
    /\b(note|report|describe|explain|feedback|friction|comment|confirm|issue|broke|what|why)\b/.test(
      c,
    )
  ) {
    return true;
  }
  // Otherwise: meaningful token overlap between the criterion and the submission.
  const need = tokenize(criterion);
  if (need.length === 0) return false;
  const hay = new Set(tokenize(`${n} ${evidenceUrl ?? ""}`));
  const overlap = need.filter((t) => hay.has(t)).length;
  return overlap / need.length >= 0.4;
}

export function assessSubmission(input: {
  criteria: string[];
  rewardAmount: number;
  evidenceUrl: string | null;
  note: string | null;
}): DeputyAssessment {
  const evidencePresent = !!input.evidenceUrl;
  const quality = noteQuality(input.note);

  const criteria: CriterionSignal[] = input.criteria.map((c) => ({
    criterion: c,
    met: criterionMet(c, input.evidenceUrl, input.note),
  }));
  const criteriaMet = criteria.filter((c) => c.met).length;

  const spamReasons: string[] = [];
  if (!evidencePresent) spamReasons.push("no evidence link");
  if (quality === "none") spamReasons.push("no note");
  else if (quality === "brief") spamReasons.push("note is very short");
  const spamRisk: SpamRisk =
    spamReasons.length >= 2 ? "high" : spamReasons.length === 1 ? "medium" : "low";

  let recommendation: Recommendation;
  if (spamRisk === "high") recommendation = "hold";
  else if (criteria.length > 0 && criteriaMet === 0) recommendation = "review";
  else recommendation = "pay";

  return {
    evidencePresent,
    noteQuality: quality,
    criteria,
    criteriaMet,
    criteriaTotal: criteria.length,
    spamRisk,
    spamReasons,
    payoutBase: input.rewardAmount,
    recommendation,
  };
}
