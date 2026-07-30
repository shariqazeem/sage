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
/** Total wall-clock a retry sequence may spend. Generous enough to outlast a per-minute rate-limit
 *  window — an inspection already takes minutes, so waiting beats failing the founder outright. */
export const RETRY_BUDGET_MS = 90_000;

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
/** An operator ceiling on any single retry wait (ms). Also what keeps the suite from genuinely
 *  sleeping through a 35-second rate-limit ladder while asserting how a 429 is classified. */
function maxWaitMs(): number {
  const raw = Number(process.env.LLM_RETRY_MAX_WAIT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : Number.POSITIVE_INFINITY;
}

export function backoffMs(attempt: number, e: unknown, rand = Math.random): number {
  const cap = maxWaitMs();
  const bounded = (n: number) => Math.min(n, cap);
  if (!isTransientLlmError(e))
    return attempt === 0 ? 0 : bounded(250 * attempt + Math.floor(rand() * 200));
  const after = retryAfterMs(e);
  if (after !== null) return bounded(after);
  // A RATE LIMIT is not a network blip and must not be retried like one. The gateway caps the key
  // over a WINDOW ("Access key quota exceeded (cap 5)"), so 1s/3s/7s simply lands three more calls
  // inside the same window and burns the attempts — measured: two inspections of commonstack.ai
  // failed `provider_transient` this way while the key recovered on its own in under 30s.
  if (isRateLimited(e)) {
    const base = [10_000, 25_000, 45_000][Math.min(attempt, 2)]!;
    return bounded(base + Math.floor(rand() * 2_000));
  }
  const base = [1_000, 3_000, 7_000][Math.min(attempt, 2)]!;
  return bounded(base + Math.floor(rand() * 400));
}

/** A 429 / explicit quota rejection, as opposed to a timeout or a dropped socket. */
export function isRateLimited(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /llm_status_429|rate.?limit|quota exceeded|too many requests/i.test(m);
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
