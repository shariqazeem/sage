/**
 * The Claude client the BENCH uses for its own work: writing scenarios and grading drafts.
 *
 * Production never imports this. Sage's own model calls go through its provider-neutral wire
 * (src/lib/llm/wire.ts), so the bench can measure any provider the same way. The key is read from the
 * founder's private config file (never the repo, never printed) and passed explicitly, so nothing else
 * on this machine starts billing it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function evalKey(): string {
  const fromEnv = process.env.ANTHROPIC_EVAL_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = readFileSync(join(homedir(), ".config/sage/anthropic.env"), "utf8");
  const m = /^ANTHROPIC_EVAL_KEY=(\S+)$/m.exec(file);
  if (!m) throw new Error("no ANTHROPIC_EVAL_KEY in ~/.config/sage/anthropic.env");
  return m[1];
}

export function evalClient(): Anthropic {
  return new Anthropic({ apiKey: evalKey(), maxRetries: 4, timeout: 15 * 60 * 1000 });
}

/** USD per million tokens (first-party, 5 Nov 2026). Batch is half. */
export const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
};

export function costUsd(model: string, usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }, batch = false): number {
  const p = PRICES[model];
  if (!p) return 0;
  const usd =
    ((usage.input_tokens ?? 0) * p.in + (usage.cache_creation_input_tokens ?? 0) * p.in * 1.25 + (usage.cache_read_input_tokens ?? 0) * p.cacheRead + (usage.output_tokens ?? 0) * p.out) / 1_000_000;
  return batch ? usd / 2 : usd;
}
