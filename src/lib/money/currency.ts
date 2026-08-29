/**
 * MULTI-CURRENCY QUOTING — say the money in the currency the person actually thinks in.
 *
 * A grant to a shop in Kingston is 5,000 JMD in the founder's head, not 31.60 USDC. Sage settles in
 * USDC because that is what the vault holds and what the chain moves, but every amount a human
 * reads should be in their own currency, with the rate that produced it stamped alongside so the
 * conversion is checkable rather than trusted.
 *
 * THE ARCHITECTURE RULE THAT KEEPS THIS SAFE: conversion happens ONCE, at funding, producing the
 * USDC base-unit total. `allocateBudget` — which is frozen, and whose invariant is
 * Σ(rewardBase × maxCompletions) === totalBudgetBase in 6-decimal base units — then runs completely
 * unchanged on that USDC figure. Local currency is a QUOTE layer over settlement, never an input to
 * it. Money math stays in integers; only the display is converted.
 *
 * A quote is a QUOTE: once stamped on a campaign it never moves, even if the market does. The
 * founder funded a specific number of dollars for a specific number of JMD, and re-reading that
 * later at today's rate would rewrite history.
 */

/** USDC and the vault work in 6-decimal base units. Never convert through floats at settlement. */
export const USD_BASE = BigInt(1_000_000);

export type Region = "caribbean" | "sender" | "global";

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  region: Region;
  /** minor units a human writes — JMD is quoted to 2dp, JPY to 0. */
  decimals: number;
}

/**
 * The corridors this product exists for: Caribbean receivers, and the diaspora that sends to them.
 * Ordered so a picker shows receiving currencies first — the person being PAID is the one whose
 * currency matters most, and they are the one the track is about.
 */
export const CURRENCIES: readonly Currency[] = [
  { code: "USD", name: "US Dollar", symbol: "$", region: "global", decimals: 2 },
  // Caribbean receivers
  { code: "JMD", name: "Jamaican Dollar", symbol: "J$", region: "caribbean", decimals: 2 },
  { code: "TTD", name: "Trinidad & Tobago Dollar", symbol: "TT$", region: "caribbean", decimals: 2 },
  { code: "XCD", name: "East Caribbean Dollar", symbol: "EC$", region: "caribbean", decimals: 2 },
  { code: "BBD", name: "Barbadian Dollar", symbol: "Bds$", region: "caribbean", decimals: 2 },
  { code: "HTG", name: "Haitian Gourde", symbol: "G", region: "caribbean", decimals: 2 },
  { code: "DOP", name: "Dominican Peso", symbol: "RD$", region: "caribbean", decimals: 2 },
  { code: "GYD", name: "Guyanese Dollar", symbol: "G$", region: "caribbean", decimals: 2 },
  { code: "BSD", name: "Bahamian Dollar", symbol: "B$", region: "caribbean", decimals: 2 },
  { code: "BZD", name: "Belize Dollar", symbol: "BZ$", region: "caribbean", decimals: 2 },
  { code: "SRD", name: "Surinamese Dollar", symbol: "SRD", region: "caribbean", decimals: 2 },
  // Diaspora senders
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", region: "sender", decimals: 2 },
  { code: "GBP", name: "Pound Sterling", symbol: "£", region: "sender", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", region: "sender", decimals: 2 },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));
export const currencyOf = (code: string): Currency | null => BY_CODE.get(code.trim().toUpperCase()) ?? null;
export const isSupportedCurrency = (code: string): boolean => BY_CODE.has(code.trim().toUpperCase());

/**
 * A rate, and where it came from. Provenance is not decoration: an amount a person is paid on the
 * strength of a conversion must be re-checkable by them later, and "trust us" is not a rate.
 */
export interface RateQuote {
  /** always "USD" — the settlement asset is a USD stablecoin, so USD is the pivot. */
  base: "USD";
  currency: string;
  /** units of `currency` per 1 USD. */
  rate: number;
  source: string;
  /** unix seconds when the provider published it (not when we read it). */
  asOf: number;
}

/** How stale a quote may be before it must be refreshed. FX does not move much in a day, but a
 *  quote older than this is not something to price new money against. */
export const RATE_MAX_AGE_SEC = 24 * 60 * 60;

export const isQuoteFresh = (q: RateQuote, nowSec: number): boolean =>
  nowSec - q.asOf <= RATE_MAX_AGE_SEC && q.rate > 0;

/**
 * Local amount → USDC base units. PURE, integer-exact at the boundary.
 *
 * Rounds DOWN, always. The rounded-off fraction is worth less than one millionth of a dollar, and
 * the direction is chosen so a conversion can never mint base units the founder did not fund — the
 * vault must always hold at least what the quote promised.
 */
export function toUsdBase(localAmount: number, quote: RateQuote): bigint {
  if (!(localAmount > 0) || !(quote.rate > 0)) return BigInt(0);
  const usd = localAmount / quote.rate;
  return BigInt(Math.floor(usd * 1_000_000));
}

/** USDC base units → local amount, for display. Never used to decide a payment. */
export function fromUsdBase(base: bigint, quote: RateQuote): number {
  const usd = Number(base) / 1_000_000;
  return usd * quote.rate;
}

/** Human-readable, in the currency's own convention. */
export function formatLocal(amount: number, code: string): string {
  const c = currencyOf(code);
  if (!c) return `${amount.toFixed(2)} ${code.toUpperCase()}`;
  return `${c.symbol}${amount.toLocaleString("en-US", { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals })}`;
}

/**
 * WHAT THIS CORRIDOR COSTS TODAY, AND WHAT IT COSTS THROUGH SAGE.
 *
 * The track names the number it wants beaten: remittance fees averaging 7–9%. Quoting a saving is
 * only honest if both sides are real, so this takes the benchmark as an explicit input rather than
 * burying a flattering constant, and computes Sage's side from the fee actually charged plus the
 * gas actually paid. A recipient pays no gas — Sage covers it — but it is still a real cost of the
 * transfer and pretending otherwise would be the same dishonesty this whole product exists against.
 */
export interface CorridorCost {
  amountUsd: number;
  /** the comparison rail's total cost, as a fraction (0.08 = 8%). */
  benchmarkRate: number;
  benchmarkCostUsd: number;
  sageCostUsd: number;
  savedUsd: number;
  /** null when the amount is zero — a percentage of nothing is not a saving. */
  savedPct: number | null;
}

export function corridorCost(amountUsd: number, benchmarkRate: number, sageCostUsd: number): CorridorCost {
  const benchmarkCostUsd = Math.max(0, amountUsd) * Math.max(0, benchmarkRate);
  const saved = benchmarkCostUsd - Math.max(0, sageCostUsd);
  return {
    amountUsd,
    benchmarkRate,
    benchmarkCostUsd,
    sageCostUsd: Math.max(0, sageCostUsd),
    savedUsd: saved,
    savedPct: amountUsd > 0 ? (saved / amountUsd) * 100 : null,
  };
}
