import { describe, expect, it } from "vitest";
import { artifactFingerprint, fingerprintSimilarity } from "./fingerprint";
import { contentTextFromHtml, wordCount } from "./content-text";

// A dev.to-shaped page: a large shared shell around a small, different article. The shell is the
// same bytes on every page of the site; only the article differs.
const SHELL_TOP = `<html><head><title>x</title><script>var a=${"x".repeat(400)}</script></head><body>
<header><nav><ul>${Array.from({ length: 40 }, (_, i) => `<li><a href="/t/${i}">Tag number ${i} trending weekly</a></li>`).join("")}</ul></nav></header>
<aside><h3>Trending on the site this week</h3><ul>${Array.from({ length: 30 }, (_, i) => `<li>Popular post ${i} about frameworks and build tools and deployment ${i}</li>`).join("")}</ul></aside>
<main><article id="article-body">`;
const SHELL_BOTTOM = `</article></main>
<footer><p>Built with love by the community. Terms, privacy, code of conduct, about, contact, sponsors, tags, FAQ, guides.</p>
<ul>${Array.from({ length: 30 }, (_, i) => `<li><a href="/f/${i}">Footer link ${i} to a section of the site</a></li>`).join("")}</ul></footer></body></html>`;

const ARTICLE_A = `<h1>Sage private payout explanation</h1><p>I went to sagepays.xyz and read the privacy part. They release the funds from a Cairo vault first. After that the money is hidden behind a Poseidon commitment. You collect it with a one-time link and have the option to put it straight into a shielded note. Gas is paid by Sage so the worker never needs a funded wallet to claim.</p><p>My wallet: 0x04a4e04babb1234567890abcdef</p>`;
const ARTICLE_B = `<h1>Understanding Sage's private payment method on Starknet</h1><p>I read the full privacy section on sagepays.xyz. The page starts by explaining the issue with regular blockchain payouts. Every payment leaves a permanent, searchable record of who earned what and when. Sage sees this as a serious privacy problem for workers and solves it with a two step release.</p><p>What confused me at first was how a claim link can be spent only once without the vault learning who spent it.</p><p>My wallet: 0x07036396a891234567890abcdef</p>`;

describe("contentTextFromHtml — the article, not the site", () => {
  it("drops navigation, sidebar and footer text and keeps the paragraphs", () => {
    const t = contentTextFromHtml(SHELL_TOP + ARTICLE_A + SHELL_BOTTOM);
    expect(t).toContain("Cairo vault");
    expect(t).not.toMatch(/trending weekly|Footer link|Popular post/);
  });

  it("two different articles in the same shell are NOT near-duplicates by content, though they are by page", () => {
    const pageA = SHELL_TOP + ARTICLE_A + SHELL_BOTTOM;
    const pageB = SHELL_TOP + ARTICLE_B + SHELL_BOTTOM;
    const wholePage = fingerprintSimilarity(artifactFingerprint(pageA), artifactFingerprint(pageB));
    const content = fingerprintSimilarity(artifactFingerprint(contentTextFromHtml(pageA)), artifactFingerprint(contentTextFromHtml(pageB)));
    expect(wholePage).toBeGreaterThan(0.6); // the false positive, reproduced
    expect(content).toBeLessThan(0.3);
  });

  it("the same article republished in a different shell, with the marker swapped, IS a near-duplicate", () => {
    const other = `<html><body><div class="site"><h2>Some other blog</h2></div><main>${ARTICLE_B.replace("0x07036396a891234567890abcdef", "0x0999999999999999999999999999")}</main></body></html>`;
    const sim = fingerprintSimilarity(artifactFingerprint(contentTextFromHtml(SHELL_TOP + ARTICLE_B + SHELL_BOTTOM)), artifactFingerprint(contentTextFromHtml(other)));
    expect(sim).toBeGreaterThan(0.6);
  });

  it("a plain-text page with no content markup falls back to its whole visible text", () => {
    const txt = "just words on a page ".repeat(20);
    expect(contentTextFromHtml(txt)).toContain("just words on a page");
    expect(wordCount(contentTextFromHtml(txt))).toBe(100);
  });

  it("wordCount counts words, not punctuation or bare symbols", () => {
    expect(wordCount("one two, three — 0x1234 · ...")).toBe(4);
  });
});
