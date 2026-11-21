import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANES } from "@/lib/llm/complete";

/**
 * `scripts/vm/llm-route.mjs` moves every lane at once, prints where each goes, and probes each model. It is plain
 * Node with no imports from the app, so it keeps its own copy of the lane list, and that copy had drifted: the
 * REPORT lane (20 Nov 2026) was missing, so `status` never showed it and a move never set it. This holds the two
 * lists together.
 */
describe("the route script knows every lane the app has", () => {
  const script = readFileSync(join(process.cwd(), "scripts/vm/llm-route.mjs"), "utf8");
  const m = /const LANES = \[([^\]]*)\];/.exec(script);

  it("declares its lane list in one place", () => {
    expect(m).not.toBeNull();
  });

  it("lists exactly the app's lanes, in the app's order", () => {
    const lanes = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
    expect(lanes).toEqual([...LANES]);
  });

  it("probes through the same resolution `status` prints, and never prints a key", () => {
    expect(script).toMatch(/function targets\(env\)/);
    expect(script).toMatch(/for \(const r of targets\(env\)\)/);
    expect(script).toMatch(/for \(const t of targets\(env\)\)/);
    // the key goes into the Authorization header and a hash for grouping, and nowhere a person reads
    expect(script).not.toMatch(/console\.(log|error)\([^)]*\.key\b/);
  });
});
