/**
 * Shared display formatters for the Deputy surfaces. Pure + framework-agnostic
 * so server and client components share one source of truth (no per-component
 * re-definitions that can drift).
 */

/**
 * USD money. Whole amounts read clean ($500); fractional amounts always show
 * full cents ($459.40, never a dangling $459.4). Rounds to cents first to shed
 * floating-point dust before deciding whether the value is whole.
 */
export const usd = (n: number): string => {
  const v = Math.round(n * 100) / 100;
  // Pin the locale so a US server and a non-US client render the SAME string
  // (undefined → the runtime locale → "$1,000" vs "$1.000" → hydration mismatch).
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

/** Shorten an address for display: 0x1234…ABCD. */
export const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Testnet-aware token truth. A testnet payout is a REAL on-chain transaction but the token
// (mUSDC) has NO value — so it must never be rendered as dollars or described as valuable.
import { chainConfig } from "@/lib/deputy/networks";

export const isTestnetChain = (chainId: number): boolean => !chainConfig(chainId).isMainnet;
export const tokenSymbol = (chainId: number): string => (isTestnetChain(chainId) ? "mUSDC" : "USDC");
export const networkLabel = (chainId: number): string =>
  `${chainConfig(chainId).chipLabel}${isTestnetChain(chainId) ? " · Testnet" : ""}`;

/**
 * Reward amount, network-truthful. Mainnet USDC renders as money ("$3.75"); a testnet
 * payout renders as the valueless test token ("3.75 test mUSDC") — never as dollars.
 * `base` is token base units (6dp).
 */
export const reward = (base: number, chainId: number): string => {
  const v = Math.round((base / 1e6) * 100) / 100;
  const n = v.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return isTestnetChain(chainId) ? `${n} test mUSDC` : `$${n}`;
};

/**
 * Network-truthful money from a display-scale number (token base ÷ 1e6). Mainnet USDC
 * renders as dollars ("$3.75"); a testnet payout renders as the valueless test token
 * ("3.75 test mUSDC") — never as dollars. The already-scaled sibling of {@link reward},
 * for surfaces (proof page, share cards) that already hold the ÷1e6 value.
 */
export const money = (v: number, chainId: number): string => {
  if (!isTestnetChain(chainId)) return usd(v);
  const r = Math.round(v * 100) / 100;
  const n = r.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(r) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${n} test mUSDC`;
};

/** Capitalize the first letter. */
export const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * A deterministic short date ("Jul 1" or "Jul 1, 2026") — fixed month names +
 * UTC, so a US-locale server and a client in any locale render the SAME string.
 * Use this for any SSR-ed date instead of toLocaleDateString.
 */
export const shortDateUTC = (unixSeconds: number, withYear = false): string => {
  const d = new Date(unixSeconds * 1000);
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return withYear ? `${base}, ${d.getUTCFullYear()}` : base;
};

/**
 * Compact relative time from a unix-seconds timestamp ("just now", "12m",
 * "3h", "2d", else a short date). `now` is injectable for deterministic tests.
 *
 * The absolute-date fallback is formatted deterministically (fixed month names,
 * UTC) — NOT `toLocaleDateString`, which renders "Jul 1" on a US server and
 * "1 Jul" in a user's locale and so causes React hydration mismatches on any
 * SSR-ed date. Same input → same string on server and client, always.
 */
export const since = (unixSeconds: number, now: number = Date.now()): string => {
  const secs = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return shortDateUTC(unixSeconds);
};
