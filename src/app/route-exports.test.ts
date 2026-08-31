import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A Next route file may export only the HTTP handlers and route config. Any other named export
 * makes the module fail Next's own route contract.
 *
 * This built anyway, for a long time, because the project builds with `--turbopack`, which does not
 * enforce the rule — so two helpers sat in route files as a latent landmine that would surface the
 * day that flag changed or turbopack tightened. Found 2026-08-31 by running the webpack build by
 * accident, which is not a thing to rely on.
 */
const ALLOWED = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
  "runtime", "dynamic", "revalidate", "fetchCache", "dynamicParams",
  "preferredRegion", "maxDuration", "generateStaticParams", "config",
]);

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (e === "route.ts" || e === "route.tsx") out.push(p);
  }
  return out;
}

describe("route files export only what Next allows", () => {
  it("finds no illegal named exports", () => {
    const bad: string[] = [];
    for (const f of routeFiles("src/app")) {
      const src = readFileSync(f, "utf8");
      const value = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
      const type = /^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm;
      for (const m of src.matchAll(value)) if (!ALLOWED.has(m[1])) bad.push(`${f} → ${m[1]}`);
      for (const m of src.matchAll(type)) bad.push(`${f} → ${m[1]} (type)`);
    }
    expect(bad, `move these into a lib module:\n${bad.join("\n")}`).toEqual([]);
  });

  it("actually scans something — a scan that finds no files always passes", () => {
    expect(routeFiles("src/app").length).toBeGreaterThan(20);
  });
});
