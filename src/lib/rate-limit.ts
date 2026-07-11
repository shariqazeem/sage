/**
 * A tiny in-memory fixed-window rate limiter. Per-process only — good enough to
 * blunt abuse of the public submit/create/auth routes on a single instance, and
 * deliberately behind one function so a deploy swaps it for Redis/Upstash without
 * touching call sites. The clock is injectable so the window logic unit-tests
 * without real time.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Requests remaining in the current window. */
  remaining: number;
  /** Unix ms when the current window resets. */
  resetAt: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export type Clock = () => number;

const realClock: Clock = () => Date.now();

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock = realClock,
  ) {}

  /** Count one hit against `key`. `ok:false` once the window's limit is exceeded. */
  hit(key: string): RateLimitResult {
    const now = this.clock();
    const existing = this.buckets.get(key);
    if (!existing || now >= existing.resetAt) {
      const resetAt = now + this.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { ok: true, remaining: this.limit - 1, resetAt };
    }
    existing.count += 1;
    const remaining = this.limit - existing.count;
    return { ok: remaining >= 0, remaining: Math.max(0, remaining), resetAt: existing.resetAt };
  }

  /** Drop expired buckets (opportunistic; keeps the map from growing unbounded). */
  sweep(): void {
    const now = this.clock();
    for (const [key, b] of this.buckets) {
      if (now >= b.resetAt) this.buckets.delete(key);
    }
  }

  reset(): void {
    this.buckets.clear();
  }
}

/* ─────────────────────────────────── shared limiters (per runtime) ──────
 * Memoized on globalThis so Next's dev HMR / route re-eval doesn't reset the
 * windows on every request. Tunables are conservative; adjust as real traffic
 * appears.
 */

interface LimiterStore {
  submit: RateLimiter;
  create: RateLimiter;
  auth: RateLimiter;
  telegram: RateLimiter;
  /** public "try to jailbreak the Deputy" attempts, per IP. */
  redteam: RateLimiter;
  /** ONE global daily budget for jailbreak attempts (each runs the real paid pipeline). */
  redteamDaily: RateLimiter;
}

const g = globalThis as typeof globalThis & { __sageLimiters?: LimiterStore };

function limiters(): LimiterStore {
  if (!g.__sageLimiters) {
    g.__sageLimiters = {
      submit: new RateLimiter(8, 60_000), // 8 submissions / min / ip
      create: new RateLimiter(5, 60_000), // 5 campaign creates / min / ip
      auth: new RateLimiter(20, 60_000), // 20 nonce+verify / min / ip
      telegram: new RateLimiter(20, 60_000), // 20 bot commands / min / chat
      redteam: new RateLimiter(6, 60_000), // 6 jailbreak attempts / min / ip
      // one global daily cap so the public box can't become a free LLM proxy.
      redteamDaily: new RateLimiter(
        Math.max(1, Number(process.env.REDTEAM_DAILY_CAP) || 200),
        86_400_000,
      ),
    };
  }
  return g.__sageLimiters;
}

export function rateLimit(
  kind: keyof LimiterStore,
  key: string,
): RateLimitResult {
  return limiters()[kind].hit(`${kind}:${key}`);
}

/** Best-effort client IP from proxy headers (Vercel/Cloudflare/std). */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return (
    headers.get("x-real-ip") ??
    headers.get("cf-connecting-ip") ??
    "unknown"
  );
}
