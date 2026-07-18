/**
 * Sybil / farming defense — a PURE, deterministic pre-check that never touches
 * the frozen brain. The vault already caps total loss (budget + per-payout +
 * velocity), so a farmer can never drain more than a campaign is funded; this
 * layer stops one person taking multiple SEATS by submitting the same work from
 * many wallets. It flags a submission that duplicates one ALREADY PAID on the
 * campaign — same evidence bytes (contentSha256) or the same report text —
 * AND (P18) a submission whose written report is a PARAPHRASE of another one on
 * the campaign (near-duplicate), which is the cheap multi-wallet farm vector.
 *
 * Both are HELD signals, never auto-rejects: a false "you copied" is worse than a
 * miss, so the near-dup threshold is deliberately high and a human reviews every
 * hold. Wallet clustering is a later layer; this is the high-precision core.
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

// ── Near-duplicate detection (paraphrase-tolerant), P18 ──────────────────────────────────────
// Exact-match (above) catches copy-paste. This catches the SAME report lightly reworded across
// many wallets — the cheap way to farm multiple seats. Calibrated on farm-vs-honest report pairs:
// word BIGRAMS + Jaccard ≥ 0.5 flags verbatim/light-paraphrase/reordered farm text (~0.67–1.0) with
// a ~6× margin over honest reports of the same mission (~0.08). It is a HELD signal (a human reviews),
// never an auto-reject — a false "you copied" is worse than a miss, so the bar stays deliberately high.

/** Bigrams — the more paraphrase-tolerant shingle size in calibration, and it still respects local
 *  word order (a full unigram bag does not). Shorter than k words → the single normalized string. */
const SHINGLE_K = 2;
/** Below this many shingles a note is too short for a stable Jaccard (small sets swing wildly), so
 *  near-dup is skipped and only the exact-match path applies — protecting terse honest one-liners. */
const MIN_SHINGLES = 5;
/** Deliberately high: catches the realistic farm vectors, never a legitimately-similar honest report. */
export const NEAR_DUP_THRESHOLD = 0.5;

/** Word k-shingle set of normalized text (punctuation folded to spaces). */
export function shingleSet(text: string | null, k = SHINGLE_K): Set<string> {
  const words = normalizeNote(text).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return new Set();
  if (words.length < k) return new Set([words.join(" ")]);
  const out = new Set<string>();
  for (let i = 0; i + k <= words.length; i++) out.add(words.slice(i, i + k).join(" "));
  return out;
}

/** Jaccard similarity |A∩B| / |A∪B| of two shingle sets (0..1; either empty → 0). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Is `current`'s report a paraphrase of any prior submission's report at or above `threshold`?
 * Compares only notes long enough to be meaningful (>= MIN_NOTE_LEN and >= MIN_SHINGLES shingles),
 * so a short honest one-liner can never trip it. Returns the STRONGEST hit (with its similarity) or
 * null. `prior` is every OTHER submission on the campaign — farming shows as a cluster, paid or not.
 */
export function findNearDuplicate(
  current: DedupCandidate,
  prior: DedupCandidate[],
  threshold = NEAR_DUP_THRESHOLD,
): (DuplicateHit & { similarity: number }) | null {
  const curNote = normalizeNote(current.note);
  if (curNote.length < MIN_NOTE_LEN) return null;
  const curShingles = shingleSet(current.note);
  if (curShingles.size < MIN_SHINGLES) return null;
  let bestSim = 0;
  for (const p of prior) {
    const pNote = normalizeNote(p.note);
    if (pNote.length < MIN_NOTE_LEN) continue;
    const pShingles = shingleSet(p.note);
    if (pShingles.size < MIN_SHINGLES) continue;
    const sim = jaccard(curShingles, pShingles);
    if (sim >= threshold && sim > bestSim) bestSim = sim;
  }
  if (bestSim === 0) return null;
  return {
    reason: `near-identical report to another submission (${Math.round(bestSim * 100)}% match) — possible multi-wallet farming`,
    similarity: bestSim,
  };
}
