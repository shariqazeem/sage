import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
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

describe("poster campaign routes redirect into /app (Pass 10 — one surface)", () => {
  const posterPages = [
    "src/app/(campaigns)/campaigns/page.tsx",
    "src/app/(campaigns)/campaigns/new/page.tsx",
    "src/app/(campaigns)/campaigns/[id]/review/page.tsx",
  ];

  it("each old poster page only redirects — the surfaces moved into the shell", () => {
    for (const rel of posterPages) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src, rel).toContain('redirect("/app")');
      // the review queue + create form now live in the app shell, not here
      expect(src.includes("ReviewPanel"), rel).toBe(false);
      expect(src.includes("NewCampaignForm"), rel).toBe(false);
    }
  });
});
