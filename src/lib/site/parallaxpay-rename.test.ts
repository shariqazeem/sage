import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_REDIRECTS } from "./redirects";

/**
 * THE SECOND PRODUCT IS PARALLAXPAY AGAIN (25 Oct 2026). Its page lives at /parallaxpay; /called, its
 * name for a few days, keeps working as a redirect, because an address someone holds is never removed;
 * and no company page still says "Called".
 */
const root = process.cwd();

describe("ParallaxPay by Sage", () => {
  it("has its page, and /called lands on it", () => {
    expect(existsSync(join(root, "src/app/parallaxpay/page.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/app/called/page.tsx"))).toBe(false);
    expect(SITE_REDIRECTS).toContainEqual({ source: "/called", destination: "/parallaxpay", permanent: true });
    expect(SITE_REDIRECTS.some((r) => r.source === "/parallaxpay")).toBe(false);
  });

  it("is named ParallaxPay on every company surface", () => {
    for (const f of ["src/app/page.tsx", "src/app/company/page.tsx", "src/components/site/site-footer.tsx", "src/app/sitemap.ts", "src/app/parallaxpay/page.tsx"]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src, f).not.toMatch(/Called by Sage|Learn about Called|Open Called|href="\/called"/);
    }
    expect(readFileSync(join(root, "src/components/site/site-footer.tsx"), "utf8")).toContain('"/parallaxpay"');
    expect(readFileSync(join(root, "src/app/sitemap.ts"), "utf8")).toContain("/parallaxpay");
  });
});
