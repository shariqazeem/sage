import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * STRUCTURAL GUARD — a model override and its lane must travel together.
 *
 * This is not hypothetical tidiness. When mission design moved to its own provider, three call
 * sites (the goal-journey compiler and the grounding shadow's architect + critic) kept passing
 * `missionModel()` with NO lane. They resolved to the mission lane's MODEL NAME on the SHARED
 * chain's key — which happened to work only because that gateway proxies the same model, so it
 * silently billed the metered key instead of the sponsored one, and would have broken outright
 * against any provider the shared gateway does not proxy.
 *
 * Nothing in the type system pairs them, so the pairing is asserted here instead.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

/** The call expression starting at `from`, matched to its closing brace. */
function callAt(src: string, from: number): string {
  const open = src.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

describe("lane wiring", () => {
  it("every llmCompleteJson call that uses missionModel() also declares the MISSION lane", () => {
    const offenders: string[] = [];
    for (const file of walk("src/lib")) {
      const src = readFileSync(file, "utf8");
      let i = src.indexOf("llmCompleteJson(");
      while (i >= 0) {
        const call = callAt(src, i);
        if (call.includes("missionModel()") && !call.includes('lane: "MISSION"')) {
          offenders.push(`${file}:${src.slice(0, i).split("\n").length}`);
        }
        i = src.indexOf("llmCompleteJson(", i + 1);
      }
    }
    expect(offenders, `mission-design calls missing lane: "MISSION" — these bill the shared key`).toEqual([]);
  });
});
