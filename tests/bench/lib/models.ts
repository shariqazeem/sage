import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Which model a bench run points a LANE at, using production's own lane configuration
 * (`<LANE>_API_KEY` / `_BASE_URL` / `_MODEL`, all three, src/lib/llm/complete.ts). The bench never
 * builds a request itself: it sets the lane and calls production's code, so what it measures is what a
 * founder gets. A candidate is "provider:model":
 *   anthropic:claude-sonnet-5-5   Anthropic's own OpenAI-compatible endpoint, with the eval key
 *   env:anthropic/claude-haiku-4-5 whatever LLM_API_KEY / LLM_BASE_URL point at (CommonStack on the VM)
 */
export interface Candidate {
  id: string;
  provider: "anthropic" | "env";
  model: string;
}

export function parseCandidates(spec: string | undefined, fallback: string): Candidate[] {
  return (spec?.trim() || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      const provider = s.slice(0, i) as Candidate["provider"];
      const model = s.slice(i + 1);
      if (provider !== "anthropic" && provider !== "env") throw new Error(`unknown provider in ${s}`);
      return { id: s, provider, model };
    });
}

function anthropicKey(): string {
  const fromEnv = process.env.ANTHROPIC_EVAL_KEY?.trim();
  if (fromEnv) return fromEnv;
  const p = join(homedir(), ".config/sage/anthropic.env");
  if (!existsSync(p)) throw new Error("no eval key: set ANTHROPIC_EVAL_KEY or ~/.config/sage/anthropic.env");
  const m = /^ANTHROPIC_EVAL_KEY=(\S+)$/m.exec(readFileSync(p, "utf8"));
  if (!m) throw new Error("no ANTHROPIC_EVAL_KEY in ~/.config/sage/anthropic.env");
  return m[1];
}

/** Point `lane` at the candidate, exactly as an operator would configure it in .env. */
export function pointLane(lane: string, c: Candidate): void {
  if (c.provider === "anthropic") {
    process.env[`${lane}_API_KEY`] = anthropicKey();
    process.env[`${lane}_BASE_URL`] = "https://api.anthropic.com/v1";
    process.env[`${lane}_MODEL`] = c.model;
  } else {
    const key = process.env.LLM_API_KEY?.trim() || process.env.COMMONSTACK_API_KEY?.trim();
    const base = process.env.LLM_BASE_URL?.trim() || process.env.COMMONSTACK_BASE_URL?.trim() || "https://api.commonstack.ai/v1";
    if (!key) throw new Error("env provider needs LLM_API_KEY (run on the VM)");
    process.env[`${lane}_API_KEY`] = key;
    process.env[`${lane}_BASE_URL`] = base;
    process.env[`${lane}_MODEL`] = c.model;
  }
}

/** USD per million tokens, for the models a bench may point a lane at (first-party list prices). */
const PRICE: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "anthropic/claude-opus-5-5": [4, 20],
  "anthropic/claude-sonnet-5-5": [2, 10],
  "anthropic/claude-haiku-4-5": [1, 5],
};
export function usd(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICE[model];
  return p ? (promptTokens * p[0] + completionTokens * p[1]) / 1_000_000 : 0;
}

/** Run `fn` over `items` with at most `n` in flight; results keep the input order. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
