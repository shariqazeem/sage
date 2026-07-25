import "server-only";

/**
 * Surviving a provider hiccup.
 *
 * A real inspection spends minutes in a browser gathering evidence, and then asks a model to design
 * the missions. When that one call caught a 503, the founder was told "Sage couldn't finish this
 * one" and every bit of that work was thrown away. The mission brain did retry — five times over
 * about three seconds — which is far too fast to outlive an outage measured in seconds.
 *
 * So: transient failures wait properly (seconds, growing, jittered, honouring `Retry-After`), and
 * non-transient ones don't wait at all — a malformed response is not going to fix itself in seven
 * seconds, and the founder should not be kept waiting for it.
 *
 * This changes only HOW LONG Sage is willing to wait. It never softens what it accepts.
 */

/** Wall-clock ceiling for one retry ladder. Long enough to outlive a blip, short enough that a
 *  genuine outage still fails honestly rather than hanging the founder's inspection. */
export const RETRY_BUDGET_MS = 20_000;

/** Is this failure worth waiting for — a rate limit, a 5xx, a timeout, a dropped connection? */
export function isTransientLlmError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  if (/llm_status_(408|409|425|429|5\d\d)/.test(m)) return true;
  if (/abort|timeout|etimedout|econnreset|econnrefused|socket hang up|fetch failed|network/i.test(m)) {
    return true;
  }
  return false;
}

/** A provider-supplied Retry-After, when the error carries one. */
function retryAfterMs(e: unknown): number | null {
  const v = (e as { detail?: { retryAfterMs?: unknown }; retryAfterMs?: unknown } | null)?.retryAfterMs
    ?? (e as { detail?: { retryAfterMs?: unknown } } | null)?.detail?.retryAfterMs;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(v, RETRY_BUDGET_MS) : null;
}

/**
 * How long to wait before attempt N+1.
 *   · transient  → 1s, 3s, 7s (+ up to 400ms jitter), or the provider's own Retry-After
 *   · everything else → a short jitter, exactly as before (a shape failure is not a wait problem)
 */
export function backoffMs(attempt: number, e: unknown, rand = Math.random): number {
  if (!isTransientLlmError(e)) return attempt === 0 ? 0 : 250 * attempt + Math.floor(rand() * 200);
  const after = retryAfterMs(e);
  if (after !== null) return after;
  const base = [1_000, 3_000, 7_000][Math.min(attempt, 2)]!;
  return base + Math.floor(rand() * 400);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying TRANSIENT failures with real backoff until the attempts or the time budget run
 * out. A non-transient failure is rethrown immediately — waiting cannot help it. The last error is
 * always what surfaces, so the founder-facing reason stays truthful.
 */
export async function withTransientRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; budgetMs?: number; now?: () => number } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const budget = opts.budgetMs ?? RETRY_BUDGET_MS;
  const now = opts.now ?? (() => Date.now());
  const started = now();
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (!isTransientLlmError(e) || i === attempts - 1) throw e;
      const wait = backoffMs(i, e);
      if (now() - started + wait > budget) throw e;
      await sleep(wait);
    }
  }
  throw last;
}
