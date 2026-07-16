/**
 * Telegram message chunking. Telegram rejects any sendMessage over 4096 chars, and
 * `sendTelegram` sends one message — so a long concierge reply or notice would be
 * truncated/refused. `splitForTelegram` breaks text into ordered chunks that each fit,
 * preferring paragraph (\n\n) > line (\n) > word boundaries, and NEVER splitting inside a
 * URL (a URL token always stays whole, even in the pathological case where it alone
 * exceeds the limit). Pure + deterministic so it can be unit-tested in isolation.
 */

/** Stay safely under Telegram's hard 4096 limit (room for any wrapper the caller adds). */
export const TELEGRAM_MAX = 4000;

/** Greedily pack units (each already <= max) into chunks joined by `sep`. */
function pack(units: string[], sep: string, max: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const u of units) {
    if (!buf) buf = u;
    else if (buf.length + sep.length + u.length <= max) buf += sep + u;
    else {
      out.push(buf);
      buf = u;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** Break ONE oversized unit into <= max pieces: lines → words (URLs kept whole) → hard slice. */
function breakUnit(unit: string, max: number): string[] {
  if (unit.length <= max) return [unit];
  if (unit.includes("\n")) {
    const lines = unit.split("\n").flatMap((l) => breakUnit(l, max));
    return pack(lines, "\n", max);
  }
  // A line with no newline and > max: break on spaces, keeping URL tokens whole.
  const pieces: string[] = [];
  for (const word of unit.split(" ")) {
    if (word.length <= max) {
      pieces.push(word);
    } else if (/^https?:\/\//i.test(word)) {
      pieces.push(word); // NEVER split a URL — accept a lone oversized URL as its own piece
    } else {
      for (let i = 0; i < word.length; i += max) pieces.push(word.slice(i, i + max));
    }
  }
  return pack(pieces, " ", max);
}

/**
 * Split `text` into Telegram-safe ordered chunks (each length <= max). A short message is
 * returned as a single chunk unchanged. URLs are never broken across a chunk boundary.
 */
export function splitForTelegram(text: string, max: number = TELEGRAM_MAX): string[] {
  if (text.length <= max) return [text];
  const units = text.split("\n\n").flatMap((p) => breakUnit(p, max));
  const chunks = pack(units, "\n\n", max);
  // A degenerate max (<= 0) or an all-empty split still yields something bounded.
  return chunks.length ? chunks : [text.slice(0, Math.max(1, max))];
}
