import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LIVE_FLAGS } from "../vitest.setup";

/**
 * A battery whose gate is missing from LIVE_FLAGS runs with NO credentials: vitest does not load
 * .env, the brain degrades to the keyword heuristic, and every row reads as a quality failure —
 * indistinguishable from a real regression, and the reason P-JUDGE once reported 57 provider
 * failures that were nothing of the kind.
 *
 * The list was hand-written and immediately wrong. This is what keeps it honest.
 */
function liveTests(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) liveTests(p, out);
    else if (e.endsWith(".live.test.ts")) out.push(p);
  }
  return out;
}

describe("every live battery's gate is covered", () => {
  const files = ["src", "tests"].flatMap((d) => {
    try { return liveTests(d); } catch { return []; }
  });

  it("scans something — a scan that finds no files always passes", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("covers every process.env.X === \"1\" gate", () => {
    const gates = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)\s*===\s*"1"/g)) {
        gates.add(m[1]);
      }
    }
    const missing = [...gates].filter((g) => !LIVE_FLAGS.includes(g)).sort();
    expect(
      missing,
      `these batteries would run with NO credentials — add to LIVE_FLAGS in vitest.setup.ts:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
