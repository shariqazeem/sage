import "server-only";
import { AsyncResource } from "node:async_hooks";
import { fallbackLlm, resolveLlm, type llmCompleteJson, type ResolvedProvider } from "./complete";
import { isDeadlineError } from "./deadline";
import { thinksOnly } from "./model-health";
import { isTransientLlmError, withTransientRetry } from "./retry";
import { isModelBroken } from "./wire";

type Opts = Parameters<typeof llmCompleteJson>[0];

/** The model spent its budget thinking and answered nothing (complete.ts, `thoughtOnly`). */
export function isThinkOnlyError(e: unknown): boolean {
  return (e as { thinkOnly?: unknown } | null)?.thinkOnly === true || /llm_think_only/.test(e instanceof Error ? e.message : String(e));
}

const isTimeout = (e: unknown) => /abort|timeout/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));

/** The wire is passing this model over: it answered 5xx to every recent call (wire.ts, section 4b). */
export function isModelBrokenError(e: unknown): boolean {
  return (e as { modelBroken?: unknown } | null)?.modelBroken === true;
}

/**
 * Is the fallback a DIFFERENT thing to ask than this primary? On prod the shared chain and the fallback are
 * the same model on the same account, and "falling back" there is asking the same question again: it is
 * never done to route around a model that is known to be unwell.
 */
export function distinctFallback(primary: ResolvedProvider | null): ResolvedProvider | null {
  const fb = fallbackLlm();
  if (!fb || !primary) return fb;
  return fb.endpoint === primary.endpoint && fb.model === primary.model && fb.key === primary.key ? null : fb;
}

/**
 * Should this job skip its primary and ask the fallback first? Only when a different fallback exists and the
 * primary is known to be unwell RIGHT NOW: the wire is passing it over (5xx to every call), or it thought its
 * whole budget away on this very job within the cooling period (model-health.ts). Both expire by themselves,
 * and the first job after that asks the primary again.
 */
export function primaryUnwell(opts: Pick<Opts, "model" | "lane" | "tag">): boolean {
  const primary = resolveLlm(opts.model, opts.lane);
  if (!primary || !distinctFallback(primary)) return false;
  return isModelBroken(primary) || thinksOnly(primary, opts.lane, opts.tag);
}

/** A failure another model can fix and the same model cannot: worth ONE ask of the fallback. */
export function fallbackCanHelp(e: unknown): boolean {
  if (isDeadlineError(e)) return false;
  return isThinkOnlyError(e) || isModelBrokenError(e) || isTransientLlmError(e);
}

/**
 * FIRST VALID ANSWER OF TWO (22 Nov 2026). `primary` starts now. If it has not settled after `afterMs`,
 * `secondary` starts beside it, and whichever answers first wins; the other is aborted through its signal
 * and its answer, if one still arrives, is dropped. If the primary FAILS before the mark, the secondary
 * starts at once when `onFailure` says another model can help. Both failing rejects with the primary's
 * error. Never more than one call of each: the extra cost of a hedge is one secondary call, and only on the
 * slow tail.
 */
export function hedged<T>(
  primary: (signal: AbortSignal) => Promise<T>,
  secondary: ((signal: AbortSignal) => Promise<T>) | null,
  afterMs: number,
  onFailure: (e: unknown) => boolean = () => false,
): Promise<T> {
  if (!secondary) return primary(new AbortController().signal);
  return new Promise<T>((resolve, reject) => {
    const a = new AbortController();
    const b = new AbortController();
    let done = false;
    let primaryError: unknown;
    let primaryFailed = false;
    let secondaryStarted = false;
    let secondaryFailed = false;
    const win = (v: T, loser: AbortController) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      loser.abort();
      resolve(v);
    };
    const lose = () => {
      if (done || !primaryFailed || (secondaryStarted && !secondaryFailed)) return;
      done = true;
      clearTimeout(timer);
      reject(primaryError);
    };
    const startSecondary = () => {
      if (done || secondaryStarted) return;
      secondaryStarted = true;
      secondary(b.signal).then(
        (v) => win(v, a),
        () => {
          secondaryFailed = true;
          lose();
        },
      );
    };
    // bound to THIS async context, so the secondary runs under the same deadline (deadline.ts) as the primary
    const timer = setTimeout(AsyncResource.bind(startSecondary), Math.max(0, afterMs));
    primary(a.signal).then(
      (v) => win(v, b),
      (e) => {
        primaryFailed = true;
        primaryError = e;
        if (!secondaryStarted && !done && onFailure(e)) startSecondary();
        lose();
      },
    );
  });
}

/**
 * ONE ANSWER FOR WORK THAT CAN WAIT A MINUTE (21 Nov 2026).
 *
 * The first look and the findings asked their model once. Measured that day on CommonStack, the shared
 * chain's model answered 500 to 4 of 9 calls, each after about 24 s, so nearly half the builders would
 * have seen the plain first look when a second try would have answered.
 *
 * So a hiccup (a 5xx, a timeout, a dropped connection, a rate limit) is retried with real backoff inside a
 * budget (`withTransientRetry`), and when the provider keeps failing, the fallback provider (`LLM_FALLBACK_*`)
 * is asked once, if one is configured. Anything else (a shape miss, an empty account or a spent day, which
 * arrive as 402, a refusal) is thrown at once, exactly as before, so each caller's own plain version still
 * stands behind it. This changes only how long Sage waits for a wording, never what it accepts.
 *
 * Since 22 Nov 2026 it also knows what is already known:
 *  - a primary the wire is passing over, or that thought its whole budget away on this job within the
 *    cooling period, is skipped: the (different) fallback is asked first and the primary not at all;
 *  - a think-only answer or a model found broken mid-call goes to the fallback at once, without the retries
 *    that cannot help;
 *  - with `hedgeAfterMs`, a primary still silent at that mark is joined by the fallback and the first answer
 *    wins (for paths where a person is waiting; one extra call at most).
 */
export async function completeSteadily<T>(
  complete: (opts: Opts) => Promise<T>,
  opts: Opts,
  how: { attempts?: number; budgetMs?: number; label?: string; hedgeAfterMs?: number } = {},
): Promise<T> {
  const label = how.label ?? "llm";
  // an explicit model names the PRIMARY's model: it is never carried onto the fallback
  const onFallback = (signal?: AbortSignal) => complete({ ...opts, model: undefined, useFallback: true, ...(signal ? { signal } : {}) });
  const canFallBack = !opts.useFallback && fallbackLlm() !== null;
  if (canFallBack && primaryUnwell(opts)) {
    console.warn(`[${label}] the primary is being passed over; asking the fallback provider`);
    return onFallback();
  }
  const differentFallback = canFallBack && distinctFallback(resolveLlm(opts.model, opts.lane)) !== null;
  const steady = (signal?: AbortSignal) =>
    withTransientRetry(() => complete(signal ? { ...opts, signal } : opts), {
      attempts: how.attempts ?? 3,
      budgetMs: how.budgetMs ?? 75_000,
      // what asking the same model again cannot fix. A TIMEOUT is one of them when a different fallback is
      // waiting: the retry would spend the same long timeout again before the fallback is even asked.
      giveUp: (e) => isModelBrokenError(e) || isThinkOnlyError(e) || (differentFallback && isTimeout(e)),
    });
  const hedgeWith = differentFallback && how.hedgeAfterMs !== undefined;
  if (hedgeWith) return hedged(steady, onFallback, how.hedgeAfterMs!, fallbackCanHelp);
  try {
    return await steady();
  } catch (e) {
    if (!fallbackCanHelp(e) || !canFallBack) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[${label}] the provider kept failing (${msg.slice(0, 80)}); asking the fallback provider once`);
    return onFallback();
  }
}
