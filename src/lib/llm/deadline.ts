import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * ONE CLOCK FOR A WHOLE PIECE OF WORK (22 Nov 2026).
 *
 * Every model call had its own timeout and nothing bounded their sum. Measured 21 Nov 2026 on a staging
 * P-GEN run: mission design sat at "generating_missions" for 1,500 s on two products, because five architect
 * attempts of up to 384 s to 655 s each are all individually "inside their timeout".
 *
 * `withDeadline` gives the work inside it one wall clock. `llmCompleteJson` reads it: a call started inside
 * gets at most the time that is left, and a call started after the clock ran out is refused at once
 * (`llm_deadline`) without touching the network. Every ladder already treats a failed call as "use what is
 * ready", so the deadline needs no plumbing through their signatures; it travels with the async context.
 * A nested deadline can only shorten the outer one.
 */
interface Clock {
  /** epoch ms the work must be done by */
  at: number;
}
const g = globalThis as typeof globalThis & { __sageLlmDeadline?: AsyncLocalStorage<Clock> };
const als: AsyncLocalStorage<Clock> = (g.__sageLlmDeadline ??= new AsyncLocalStorage<Clock>());

/** Run `fn` with at most `ms` of wall clock for all the model calls inside it. */
export function withDeadline<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const outer = als.getStore();
  const at = Math.min(Date.now() + Math.max(0, ms), outer?.at ?? Number.POSITIVE_INFINITY);
  return als.run({ at }, fn);
}

/** Milliseconds left on the surrounding deadline, or null when the work has none. Never negative. */
export function deadlineRemainingMs(): number | null {
  const c = als.getStore();
  return c ? Math.max(0, c.at - Date.now()) : null;
}

/** Has the surrounding deadline (if any) less than `ms` left? False when there is no deadline. */
export function deadlineWithin(ms: number): boolean {
  const left = deadlineRemainingMs();
  return left !== null && left < ms;
}

/** The code a call refused by the deadline carries (never retried, never a provider's fault). */
export const DEADLINE_CODE = "llm_deadline";
export function isDeadlineError(e: unknown): boolean {
  return (e instanceof Error ? e.message : String(e)).includes(DEADLINE_CODE);
}
