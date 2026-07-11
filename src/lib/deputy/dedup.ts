/**
 * Sybil / farming defense — a PURE, deterministic pre-check that never touches
 * the frozen brain. The vault already caps total loss (budget + per-payout +
 * velocity), so a farmer can never drain more than a campaign is funded; this
 * layer stops one person taking multiple SEATS by submitting the same work from
 * many wallets. It flags a submission that duplicates one ALREADY PAID on the
 * campaign — same evidence bytes (contentSha256) or the same report text.
 *
 * Exact-match only for now: it catches copy-paste farming with near-zero false
 * positives. Semantic near-duplicate detection (paraphrases) and wallet
 * clustering are later layers; this is the cheap, high-precision first cut.
 */

/** Trivially short notes are ignored for text-dedup so genuine one-liners
 *  ("nice app") can't collide by accident. */
const MIN_NOTE_LEN = 24;

export interface DedupCandidate {
  /** the submitter's written report, or null. */
  note: string | null;
  /** sha256 of the fetched evidence bytes, or null when there was no evidence. */
  contentSha256: string | null;
}

export type DuplicateHit = { reason: string };

/** Normalize report text for exact-match comparison (case + whitespace). */
export function normalizeNote(s: string | null): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Is `current` a duplicate of any already-paid entry in `prior`? Returns the
 * first match (with a human reason) or null. A match is the same evidence bytes,
 * OR the same normalized report text above a minimum length.
 */
export function findDuplicate(
  current: DedupCandidate,
  prior: DedupCandidate[],
): DuplicateHit | null {
  const curNote = normalizeNote(current.note);
  for (const p of prior) {
    if (
      current.contentSha256 &&
      p.contentSha256 &&
      current.contentSha256 === p.contentSha256
    ) {
      return { reason: "same evidence as an entry already paid" };
    }
    if (curNote.length >= MIN_NOTE_LEN && curNote === normalizeNote(p.note)) {
      return { reason: "same report text as an entry already paid" };
    }
  }
  return null;
}
