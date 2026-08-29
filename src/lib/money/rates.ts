import "server-only";

import { CURRENCIES, type RateQuote } from "./currency";

/**
 * WHERE A RATE COMES FROM — fetched, cached, and stamped, never guessed.
 *
 * A hardcoded rate table is the obvious shortcut and the wrong one: it is wrong the day after it is
 * written, and it would be wrong invisibly, inside numbers people are paid against. So rates are
 * fetched from a published source, carry that source and the provider's own publication time, and
 * when the fetch fails Sage REFUSES to quote in that currency rather than inventing one.
 *
 * Refusing is the honest degradation: the founder is told the corridor is unavailable right now and
 * can fund in USD, which always works. A guessed rate would silently mis-size someone's grant.
 */

const SOURCE_URL = "https://open.er-api.com/v6/latest/USD";
const SOURCE_NAME = "exchangerate-api.com (open access)";
const FETCH_TIMEOUT_MS = 10_000;
/** Re-fetch at most this often. The provider publishes daily; this keeps a burst of launches on one
 *  read without pinning a rate for longer than it should live. */
const CACHE_TTL_MS = 60 * 60 * 1000;

interface Cached {
  at: number;
  quotes: Map<string, RateQuote>;
}
let cache: Cached | null = null;

interface ErApiResponse {
  result?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
}

/**
 * Every supported currency's rate against USD, or null when the source cannot be reached.
 *
 * Null is a real answer here, not an error to swallow: the caller must decide to fall back to USD
 * rather than receive a number Sage cannot stand behind.
 */
export async function fetchRates(
  deps: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<Map<string, RateQuote> | null> {
  const now = deps.now?.() ?? Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.quotes;

  const f = deps.fetchImpl ?? fetch;
  try {
    const res = await f(SOURCE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return cache?.quotes ?? null;
    const data = (await res.json()) as ErApiResponse;
    if (data.result !== "success" || !data.rates) return cache?.quotes ?? null;

    const asOf = data.time_last_update_unix ?? Math.floor(now / 1000);
    const quotes = new Map<string, RateQuote>();
    for (const c of CURRENCIES) {
      const rate = c.code === "USD" ? 1 : data.rates[c.code];
      // A currency the provider does not publish is simply unavailable — never approximated from
      // a neighbouring one, however tempting the peg looks.
      if (typeof rate === "number" && rate > 0) {
        quotes.set(c.code, { base: "USD", currency: c.code, rate, source: SOURCE_NAME, asOf });
      }
    }
    if (quotes.size === 0) return cache?.quotes ?? null;
    cache = { at: now, quotes };
    return quotes;
  } catch {
    // A stale cached quote beats no quote, and it still carries its own asOf so the caller can see
    // exactly how old it is. With no cache at all, the answer is honestly nothing.
    return cache?.quotes ?? null;
  }
}

/** One currency's quote, or null when unavailable. USD always resolves — it is the settlement asset. */
export async function quoteFor(
  code: string,
  deps: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<RateQuote | null> {
  const c = code.trim().toUpperCase();
  if (c === "USD") {
    return { base: "USD", currency: "USD", rate: 1, source: "settlement asset", asOf: Math.floor((deps.now?.() ?? Date.now()) / 1000) };
  }
  const all = await fetchRates(deps);
  return all?.get(c) ?? null;
}

/** Test seam — the module-level cache would otherwise leak between cases. */
export function __clearRateCache(): void {
  cache = null;
}
