import { describe, expect, it } from "vitest";
import { isStaticAsset } from "./inspect";

/**
 * A FILE IS NOT A PAGE, AND THE PAGE BUDGET IS SMALL.
 *
 * Measured on clawup.org: the crawl returned `/`, `/brand-assets`, `/terms`, `/privacy` and FOUR
 * logo SVGs, each counted as a route. Nothing about a product flow lives inside
 * `clawup-logo-dark.svg`, and those four crowded out whatever the budget could otherwise have
 * reached. The plan Sage built from that crawl was a mission about the logo's safety zone — on a
 * $400 budget, for a founder who had asked about launching an agent. It was the only thing Sage
 * had actually looked at.
 */

describe("files that can never contain a product flow", () => {
  it.each([
    "https://x.test/brand-assets/logos/clawup-logo-dark.svg",
    "https://x.test/img/hero.png",
    "https://x.test/photo.JPEG",
    "https://x.test/fonts/inter.woff2",
    "https://x.test/demo.mp4",
    "https://x.test/whitepaper.pdf",
    "https://x.test/build/app.js",
    "https://x.test/styles/main.css",
    "https://x.test/data/config.json",
    "https://x.test/sitemap.xml",
    "https://x.test/download/app.dmg",
    "https://x.test/export.csv",
    "https://x.test/logo.svg?v=2",
  ])("skips %s", (url) => {
    expect(isStaticAsset(url)).toBe(true);
  });
});

describe("pages it must never mistake for files", () => {
  it.each([
    "https://x.test/",
    "https://x.test/pricing",
    "https://x.test/sign-up",
    "https://x.test/dashboard",
    "https://x.test/docs/quickstart",
    "https://x.test/index.html",
    "https://x.test/product.php",
    "https://x.test/Default.aspx",
    "https://x.test/brand-assets",
    // A path that merely CONTAINS an extension-like word is still a page.
    "https://x.test/blog/why-css-is-hard",
    "https://x.test/features?tab=json",
  ])("keeps %s", (url) => {
    expect(isStaticAsset(url)).toBe(false);
  });

  it("does not throw on a malformed url", () => {
    expect(() => isStaticAsset("not a url at all")).not.toThrow();
    expect(() => isStaticAsset("")).not.toThrow();
  });
});
