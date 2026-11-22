import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NOTHING THE BROWSER RUNS MAY REACH SERVER CODE (22 Nov 2026).
 *
 * The findings report's component (`report.tsx`, "use client") imported one constant from
 * `report/changed.ts`. That module imports `report/core.ts`, which imports the drafter, and through it the
 * model wire, the spend meter and the database: `next build` refused the client bundle with 166 errors
 * (`'server-only' cannot be imported from a Client Component`, `Can't resolve 'fs'`). Type checks and every
 * unit test passed, because neither bundles for the browser. It was found only by building a staging copy.
 *
 * This walks every "use client" file's VALUE imports (type-only imports are erased and never bundled),
 * follows `@/` and relative paths through the repo, and fails with the chain when one reaches a module that
 * imports "server-only" or a Node built-in. It is the build's own rule, made fast.
 */
const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const NODE_ONLY = /^(?:node:|fs$|fs\/|path$|child_process$|net$|tls$|dns$|http2$|async_hooks$|worker_threads$|readline$|inspector$|module$|better-sqlite3$|playwright(?:-core)?$)/;

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walkFiles(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(p);
  }
  return out;
}

/** The value imports and re-exports of a module (type-only ones are left out: they are erased). */
export function valueImports(code: string): string[] {
  const out: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(statement)) {
    if (m[2]) continue; // `import type …` / `export type …`
    const clause = m[3]!.trim();
    if (m[1] === "export" && !clause.startsWith("{") && !clause.startsWith("*")) continue; // not a re-export
    const braces = /^\{([\s\S]*)\}$/.exec(clause);
    if (braces) {
      const names = braces[1]!.split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => n.startsWith("type "))) continue; // `{ type A, type B }`
    }
    out.push(m[4]!);
  }
  for (const m of code.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) out.push(m[1]!); // side-effect imports
  return out;
}

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // a package: only the Node-only list above is checked
  for (const p of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** The first chain from `start` to server code, or null when there is none. */
export function serverChain(start: string): string[] | null {
  const seen = new Set<string>();
  const stack: { file: string; path: string[] }[] = [{ file: start, path: [start] }];
  while (stack.length > 0) {
    const { file, path } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const spec of valueImports(code)) {
      if (spec === "server-only" || NODE_ONLY.test(spec)) return [...path, spec];
      const next = resolveSpec(file, spec);
      if (next && !seen.has(next)) stack.push({ file: next, path: [...path, next] });
    }
  }
  return null;
}

const rel = (p: string) => (p.startsWith("/") ? relative(ROOT, p) : p);

describe("the client boundary", () => {
  it("the walker sees a real server chain (so a pass below means something)", () => {
    const chain = serverChain(join(SRC, "lib/report/changed.ts"));
    expect(chain, "report/changed.ts reaches the model wire through report/core.ts").not.toBeNull();
    expect(valueImports(`import type { A } from "x";\nimport { type B, type C } from "y";\nimport { D } from "z";\nimport "server-only";`)).toEqual(["z", "server-only"]);
  });

  it('no "use client" file reaches "server-only" or a Node built-in through its value imports', () => {
    const clients = walkFiles(SRC).filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
    expect(clients.length).toBeGreaterThan(20);
    const broken = clients.map((f) => serverChain(f)).filter((c): c is string[] => c !== null).map((c) => c.map(rel).join(" → "));
    expect(broken).toEqual([]);
  });
});
