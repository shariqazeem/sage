import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY MODEL CALL GOES THROUGH THE WIRE (wire.ts).
 *
 * Eight call sites once built their own provider requests. Each one sent `temperature`, picked its
 * own `response_format`, and queued behind its own lock. So a provider switch broke them one at a
 * time: Anthropic's endpoint refused both parameters on the first try (5 Nov 2026), and the payout
 * judge, the concierge, vision and entailment would each have failed separately.
 *
 * This holds the line: a file that builds a chat-completions endpoint may not POST it with its own
 * fetch. It hands the request to `postChat`, which shapes it for the provider, learns what the
 * provider refuses, and queues it per key with the waiting person first.
 */
const ROOT = join(process.cwd(), "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("one wire for every model call", () => {
  it("no file outside the wire POSTs a chat completion with its own fetch", () => {
    const offenders = sources(ROOT)
      .filter((f) => !f.endsWith(join("lib", "llm", "wire.ts")))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return src.includes("chat/completions") && /\b(?:await\s+fetch|fetchImpl)\s*\(/.test(src);
      })
      .map((f) => relative(process.cwd(), f));
    expect(offenders).toEqual([]);
  });
});
