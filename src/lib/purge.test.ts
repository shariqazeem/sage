import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A standing guard for the real-only pass: the fixture/mock/demo modules are
 * gone, and nothing may quietly import them back. If this fails, a deleted
 * surface has been resurrected.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

const FILES = sourceFiles(join(process.cwd(), "src")).filter(
  (f) => !f.endsWith("purge.test.ts"),
);

describe("fixtures purged (real-only)", () => {
  it("no source imports the deleted bounties fixtures", () => {
    const offenders = FILES.filter((f) =>
      /["'@/.]*lib\/deputy\/bounties/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("no source imports the deleted lead-gen agent or its routes", () => {
    const offenders = FILES.filter((f) => {
      const t = readFileSync(f, "utf8");
      return /lib\/agent\/|api\/operate/.test(t);
    });
    expect(offenders).toEqual([]);
  });

  it("no source imports the deleted x402 demo (only the facilitator seam remains)", () => {
    const offenders = FILES.filter((f) =>
      /lib\/x402\/(client|vendor|types)|components\/x402/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("legacy campaign routes redirect to the canonical journey (07-B)", () => {
  // Generic create/browse intents are config redirects now (src/lib/site/redirects.ts): browsing
  // goes to Jobs, creating goes to Post. A specific V1 campaign review still goes to the preserved
  // legacy console (/app?legacy=1). None render a surface.
  it("generic poster routes redirect: browsing to Jobs, creating to Post", async () => {
    const { SITE_REDIRECTS } = await import("@/lib/site/redirects");
    const to = (source: string) => SITE_REDIRECTS.find((r) => r.source === source)?.destination;
    expect(to("/campaigns")).toBe("/workspace/jobs");
    expect(to("/campaigns/new")).toBe("/launch");
    for (const rel of ["src/app/(campaigns)/campaigns/page.tsx", "src/app/(campaigns)/campaigns/new/page.tsx"]) {
      expect(existsSync(join(process.cwd(), rel)), `${rel} must not render a surface`).toBe(false);
    }
  });

  it("the legacy V1 review route redirects to the preserved legacy console", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/(campaigns)/campaigns/[id]/review/page.tsx"),
      "utf8",
    );
    expect(src).toContain('redirect("/app?legacy=1")');
    expect(src.includes("ReviewPanel")).toBe(false);
  });
});
