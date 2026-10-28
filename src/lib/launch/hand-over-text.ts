/**
 * HAND IT TO SAGE — what the founder pasted, read as text (28 Oct 2026). Pure and client-safe: the box,
 * the server and the tests all read a hand-over the same way.
 *
 * A hand-over is a link (an issue, a doc, a page), the message they'd send someone, or both. Money and
 * headcount are only ever read from the founder's own words, never from a link inside them: "issues/42"
 * is not 42 people.
 */
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}]+$/;

/** Hosts where a link names a task or a document, never a product to test. */
const TASK_HOSTS = ["github.com", "gist.github.com", "gitlab.com", "docs.google.com", "drive.google.com", "notion.so", "notion.site", "linear.app", "trello.com", "airtable.com", "x.com", "twitter.com", "t.me"];

/** The first link in the text, without the punctuation a sentence put after it. */
export function firstUrl(text: string): string | null {
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(TRAILING, "");
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
    } catch {
      /* not a link after all */
    }
  }
  return null;
}

/** "github.com/acme/app/issues/42": a link named back to the founder the way they would say it. */
export function labelFor(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    const label = `${u.host.replace(/^www\./, "")}${path}`;
    return label.length > 64 ? `${label.slice(0, 63)}…` : label;
  } catch {
    return url.slice(0, 64);
  }
}

/** The founder's words with every link taken out: where money and headcount are read from. */
export function wordsOnly(text: string): string {
  return text.replace(URL_RE, " ").replace(/\s+/g, " ").trim();
}

/**
 * A link to the front page of a site, handed over alone: that is a product to try, not a task to pay
 * for, so the box offers a product test before writing a job nobody asked for.
 */
export function looksLikeProductHome(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  const url = firstUrl(t);
  if (!url) return false;
  const u = new URL(url);
  const host = u.host.replace(/^www\./, "").toLowerCase();
  if (TASK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return false;
  return (u.pathname === "/" || u.pathname === "" || /^\/index\.html?$/i.test(u.pathname)) && !u.search;
}
