/**
 * Page text without a parser dependency: the one HTML-to-text reduction shared by the judge's evidence
 * fetch (deputy/evidence.ts) and the page reader (read/page-reader.ts). Defensive, not perfect.
 */
export function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Strip HTML to readable text without a parser dep (defensive, not perfect). */
export function stripHtml(html: string): string {
  return collapse(
    html
      .replace(/<(script|style|noscript|template|svg|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, " ")
      // Surface link targets as text BEFORE stripping tags — otherwise every href is lost and a
      // criterion like "contains a functional link to a block explorer" can never be verified.
      .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi, " $1 ")
      // An image is part of the work ("a screenshot of each step"). A text-only reader dropped them, and the
      // judge held honest write-ups for "no screenshot appears" (Sage Bench, 5 Nov 2026), so each one is
      // named, with its alt text when it has one.
      .replace(/<img\b[^>]*?(?:\balt\s*=\s*["']([^"']*)["'])?[^>]*>/gi, (_m, alt?: string) => ` [image${alt && alt.trim() ? `: ${alt.trim()}` : ""}] `)
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

