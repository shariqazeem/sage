import "server-only";
import { fallbackLlm, type llmCompleteJson } from "./complete";
import { isTransientLlmError, withTransientRetry } from "./retry";

type Opts = Parameters<typeof llmCompleteJson>[0];

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
 */
export async function completeSteadily<T>(
  complete: (opts: Opts) => Promise<T>,
  opts: Opts,
  how: { attempts?: number; budgetMs?: number; label?: string } = {},
): Promise<T> {
  try {
    return await withTransientRetry(() => complete(opts), { attempts: how.attempts ?? 3, budgetMs: how.budgetMs ?? 75_000 });
  } catch (e) {
    if (!isTransientLlmError(e) || opts.useFallback || fallbackLlm() === null) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[${how.label ?? "llm"}] the provider kept failing (${msg.slice(0, 80)}); asking the fallback provider once`);
    // an explicit model names the PRIMARY's model: it is never carried onto the fallback
    return complete({ ...opts, model: undefined, useFallback: true });
  }
}
