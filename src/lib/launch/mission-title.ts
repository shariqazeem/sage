/**
 * A MISSION TITLE FROM THE FOUNDER'S OWN SENTENCE.
 *
 * The composer has no title field: the "what must be true" sentence became the title verbatim and
 * the compiler cut it at 80 characters mid-word — measured on the first public gig of launch week,
 * whose card read "Read sagepays.xyz/#privacy, then write a public page (blog, dev.to, gist, Notion".
 * The founder's sentence stays the criterion; the title is its first clause, capitalised, cut at a
 * word boundary. A founder who wants a different title types one (the optional field beside it).
 */
const MAX = 60;
const BOUNDARIES = [" — ", " – ", ": ", "; ", ". ", ", then ", ", and ", ", plus ", " and one ", ", with "];

export function missionTitleFrom(deliverable: string, index = 0): string {
  let s = deliverable.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  let cut = s.length;
  for (const b of BOUNDARIES) {
    const i = s.indexOf(b);
    if (i > 8 && i < cut) cut = i; // a boundary in the first few words is a false one ("e.g. this")
  }
  s = s.slice(0, cut).trim();
  if (s.length > MAX) {
    const head = s.slice(0, MAX + 1);
    const sp = head.lastIndexOf(" ");
    s = (sp > 24 ? head.slice(0, sp) : head.slice(0, MAX)).replace(/[,;:(—–-]+$/, "").trim();
  }
  s = s.replace(/[.\s]+$/, "");
  if (s.length < 4) return `Milestone ${index + 1}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
