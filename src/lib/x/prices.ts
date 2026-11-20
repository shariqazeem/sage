/**
 * WHAT X CHARGES, AND HOW X COUNTS (pay-per-use, the April 2026 rate card).
 *
 * One table, in millionths of a dollar, so the meter adds integers. Nothing else in the product names
 * a price for X.
 */
export const X_PRICES_MICROS = {
  /** creating a post with no link */
  post: 15_000,
  /** creating a post that contains a URL */
  postWithUrl: 200_000,
  /** each post a read returns */
  postRead: 5_000,
  /** each user a read returns */
  userRead: 10_000,
  /** a read of the account's own resources */
  ownedRead: 1_000,
} as const;

/** A post is at most this long, by X's own count. */
export const X_POST_MAX = 280;
/** Every link is shortened to t.co and counts as this many characters, whatever its real length. */
export const X_URL_LENGTH = 23;

/**
 * A link as X sees one: a URL with a scheme, or a bare domain X turns into a link by itself
 * ("example.com"). Deliberately generous: a text wrongly priced as carrying a link costs the meter a few
 * cents of headroom, while a link priced as plain text would spend past the ceiling unseen.
 */
const URL_RE = /https?:\/\/[^\s]+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}\b(?:\/[^\s]*)?/gi;

export function containsUrl(text: string): boolean {
  URL_RE.lastIndex = 0;
  return URL_RE.test(text);
}

/** X's weighting: most Latin text and general punctuation count 1, everything else 2. */
function weight(codePoint: number): number {
  if (codePoint <= 4351) return 1;
  if (codePoint >= 8192 && codePoint <= 8205) return 1;
  if (codePoint >= 8208 && codePoint <= 8223) return 1;
  if (codePoint >= 8242 && codePoint <= 8247) return 1;
  return 2;
}

/** The length X will count for this text: each link is 23, the rest is weighted by character. */
export function xLength(text: string): number {
  URL_RE.lastIndex = 0;
  let total = 0;
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    total += plainLength(text.slice(last, m.index)) + X_URL_LENGTH;
    last = (m.index ?? 0) + m[0].length;
  }
  return total + plainLength(text.slice(last));
}

function plainLength(s: string): number {
  let n = 0;
  for (const ch of s.normalize("NFC")) n += weight(ch.codePointAt(0) ?? 0);
  return n;
}

/** What creating this post costs. */
export function postCostMicros(text: string): number {
  return containsUrl(text) ? X_PRICES_MICROS.postWithUrl : X_PRICES_MICROS.post;
}

/** What a read cost, from what it returned. A read that returned nothing is still counted as one owned read. */
export function readCostMicros(returned: { posts?: number; users?: number }): number {
  const cost = (returned.posts ?? 0) * X_PRICES_MICROS.postRead + (returned.users ?? 0) * X_PRICES_MICROS.userRead;
  return cost > 0 ? cost : X_PRICES_MICROS.ownedRead;
}
