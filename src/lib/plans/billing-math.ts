import { PERIOD_SECONDS, PLAN_ORDER, PLANS, type PlanId } from "./catalog";

/**
 * WHAT A PAYMENT BUYS. Pure: the billing routes ask this, and the tests hold it.
 *
 * - The same plan again extends from the later of now and the current end: paying early never loses
 *   a day.
 * - Moving UP starts a fresh period now and credits the days left on the old plan at its price, so
 *   nobody pays twice for the same days (20 days of Pro at $29 become ~3.9 days of Team at $149).
 * - Moving DOWN while a higher plan runs is refused: the higher plan already covers it, and taking
 *   the money would buy nothing.
 */
export function planPriceUsd(plan: PlanId, env: Record<string, string | undefined> = process.env): number | null {
  const base = PLANS[plan].priceUsd;
  if (base === null || base === 0) return base;
  const raw = env[`SAGE_${plan.toUpperCase()}_PRICE_USD`]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : base;
}

/** USD to 6-decimal USDC base units, exactly (no float drift past the cent). */
export function usdToBase(usd: number): bigint {
  return BigInt(Math.round(usd * 100)) * BigInt(10_000);
}

export type NextPeriod = { ok: true; until: number } | { ok: false; reason: string };

export function nextPeriod(input: {
  current: PlanId;
  currentUntil: number | null;
  next: PlanId;
  now: number;
  prices?: Partial<Record<PlanId, number | null>>;
}): NextPeriod {
  const { current, next, now } = input;
  const price = (p: PlanId) => input.prices?.[p] ?? planPriceUsd(p);
  const nextPrice = price(next);
  if (!nextPrice) return { ok: false, reason: `${PLANS[next].name} isn't bought here.` };
  const until = input.currentUntil ?? 0;
  const running = current !== "free" && until > now;
  if (!running || current === next) return { ok: true, until: Math.max(until, now) + PERIOD_SECONDS };
  const up = PLAN_ORDER.indexOf(next) > PLAN_ORDER.indexOf(current);
  if (!up) {
    const date = new Date(until * 1000).toISOString().slice(0, 10);
    return { ok: false, reason: `You're on ${PLANS[current].name} until ${date}. ${PLANS[next].name} can start once it ends.` };
  }
  const curPrice = price(current) ?? 0;
  const credit = Math.floor(((until - now) * curPrice) / nextPrice);
  return { ok: true, until: now + PERIOD_SECONDS + Math.max(0, credit) };
}
