/**
 * THE WORK, NOT THE WEBSITE AROUND IT.
 *
 * A copied-deliverable check that fingerprints the whole page fingerprints the host: two different
 * dev.to articles by two different people measured 92% alike on raw HTML and 55% on visible text —
 * dev.to's navigation, sidebar and footer are most of both pages — while their article bodies were 8%
 * alike. Measured 2026-09-04 on the first Starknet gig, after that 92% had held an honest worker's
 * payout as "possible copied work". A gate that cannot tell the shell from the article punishes
 * everyone who publishes on the same site, which is exactly where honest workers publish.
 *
 * So the fingerprint (and the word count, and the source-overlap check) read CONTENT elements only:
 * paragraphs, headings, list items, quotes, code, table cells — with navigation, header, footer,
 * aside, script and style regions removed first. The marker check still reads the whole page: a
 * wallet address in a byline or a footer is the worker's, wherever the site puts it.
 */

const DROP_REGIONS = /<(nav|header|footer|aside|script|style|noscript|template|svg|head|form|button|select)\b[\s\S]*?<\/\1>/gi;
const CONTENT_ELEMENTS = /<(p|h[1-6]|li|blockquote|pre|td|th|dd|dt|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/gi;

function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Every tag gone, entities decoded — the visible text of a fragment. */
export function textOf(html: string): string {
  return collapse(decode(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")));
}

export const MIN_CONTENT_WORDS = 30;

/**
 * The text of a page's content elements, chrome removed. Falls back to the whole visible text when
 * the page has too little content markup to read (a plain .txt paste, a page built from bare divs),
 * so a page never fingerprints as empty just because of how it was built.
 */
export function contentTextFromHtml(html: string): string {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, " ").replace(DROP_REGIONS, " ");
  const parts: string[] = [];
  for (const m of stripped.matchAll(CONTENT_ELEMENTS)) {
    const t = textOf(m[2] ?? "");
    if (t) parts.push(t);
  }
  const content = parts.join("\n");
  if (wordCount(content) >= MIN_CONTENT_WORDS) return content;
  return textOf(stripped);
}

/** The DOM-side twin of `contentTextFromHtml`, for the headless renderer: same regions, same elements. */
export const CONTENT_TEXT_IN_PAGE = `(() => {
  const drop = ["nav","header","footer","aside","script","style","noscript","template","svg","form","button","select"];
  const root = document.body ? document.body.cloneNode(true) : null;
  if (!root) return "";
  for (const sel of drop) for (const el of Array.from(root.querySelectorAll(sel))) el.remove();
  const parts = [];
  for (const el of Array.from(root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,dd,dt,figcaption"))) {
    const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    if (t) parts.push(t);
  }
  const content = parts.join("\\n");
  const words = content.split(/\\s+/).filter(Boolean).length;
  return words >= ${MIN_CONTENT_WORDS} ? content : (root.innerText || root.textContent || "").replace(/\\s+/g, " ").trim();
})()`;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
