/**
 * Long text cut to `max` at the last line or sentence end, never mid-word: a worker who reads "Make sure
 * `pnpm test` an" has lost the step (Sage Bench, 5 Nov 2026).
 *
 * A list marker ("15. ") is not a sentence end: cutting there would leave a step that is only its number.
 */
export function cutAtBoundary(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const line = cut.lastIndexOf("\n");
  let sentence = -1;
  const ends = /\.(?=\s)/g;
  for (let m = ends.exec(cut); m; m = ends.exec(cut)) {
    if (m.index <= line) continue;
    const before = cut.slice(line + 1, m.index).trim();
    if (/^[\dA-Za-z]{1,3}$/.test(before)) continue; // "15." or "b.": a marker, not a sentence
    sentence = m.index + 1;
  }
  const at = Math.max(line, sentence);
  if (at > max * 0.6) return cut.slice(0, at).trimEnd();
  const space = cut.lastIndexOf(" ");
  return cut.slice(0, space > 0 ? space : max).trimEnd();
}
