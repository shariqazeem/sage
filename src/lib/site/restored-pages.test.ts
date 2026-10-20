import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAppRoute } from "@/components/shell/routes";
import { SITE_REDIRECTS } from "./redirects";
import { DOCS_REDIRECTS } from "./redirects-docs";
import { LEDGER_REDIRECTS } from "./redirects-ledger";

/**
 * THE FOLDED PAGES ARE PAGES (20 Oct 2026). The rule after the company rebuild: no old address is
 * removed, and the pages worth reading (the Caribbean, outcomes, the comparisons, the case study, the
 * FAQ) are pages again, with the records' own page beside them, reachable from every company page.
 *
 * A redirect left on one of these sources would silently shadow its page (Next runs redirects before
 * it looks for a route), and the build would still be green. So this holds both sides: the page
 * exists in the company frame, nothing redirects away from it, and the footer and the sitemap list it.
 */
const PAGES = [
  "/caribbean",
  "/outcomes",
  "/record",
  "/faq",
  "/vs/beta-testers",
  "/vs/bug-bounty",
  "/case-studies/autonomous-paid-testing",
];
const root = process.cwd();
const pageFile = (route: string) => join(root, "src/app", route, "page.tsx");

/** Whether a Next redirect source would catch this path: a literal, or a `/:path*` prefix. */
function catches(source: string, path: string): boolean {
  const pattern = source
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\/:[a-zA-Z]+\*$/, "(?:/.*)?")
    .replace(/:[a-zA-Z]+/g, "[^/]+");
  return new RegExp(`^${pattern}$`).test(path);
}

describe("the restored pages", () => {
  it("exist in the company frame, with no inline styles", () => {
    for (const p of PAGES) {
      expect(existsSync(pageFile(p)), p).toBe(true);
      const src = readFileSync(pageFile(p), "utf8");
      expect(src, p).toMatch(/<ReadPage/);
      expect(src, p).not.toMatch(/style=\{/);
      expect(isAppRoute(p), p).toBe(false);
    }
  });

  it("are never shadowed by a redirect", () => {
    expect(catches("/vs/:path*", "/vs/beta-testers")).toBe(true); // the matcher itself, checked
    expect(catches("/caribbean", "/caribbean")).toBe(true);
    const all = [...SITE_REDIRECTS, ...DOCS_REDIRECTS, ...LEDGER_REDIRECTS];
    for (const p of PAGES) for (const r of all) expect(catches(r.source, p), `${r.source} shadows ${p}`).toBe(false);
  });

  it("are one click from every company page, and listed in the sitemap", () => {
    const footer = readFileSync(join(root, "src/components/site/site-footer.tsx"), "utf8");
    const sitemap = readFileSync(join(root, "src/app/sitemap.ts"), "utf8");
    for (const p of PAGES) {
      expect(footer, p).toContain(`href: "${p}"`);
      expect(sitemap, p).toContain("${base}" + p + "`");
    }
  });

  it("the records page keeps the lookup working without JavaScript", () => {
    const src = readFileSync(pageFile("/record"), "utf8");
    expect(src).toMatch(/<form className="read-lookup" action="\/record" method="get">/);
    expect(src).toMatch(/redirect\(`\/record\/\$\{raw\}`\)/);
  });
});
