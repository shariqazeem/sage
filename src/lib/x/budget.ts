import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { xSpend } from "@/lib/db/schema";
import { xDailyBudgetMicros } from "./config";

/**
 * A DAY'S SPEND ON X, AND ITS CEILING.
 *
 * X is pay-per-use: a post costs cents and a post with a link costs twenty of them. The meter books
 * every charge against its UTC day (`x_spend`), reads included, and `canSpend` answers before anything
 * is sent. At the ceiling the agent skips with the reason below; the next UTC day is a new row, so it
 * resumes by itself with nothing to reset.
 */
export const BUDGET_REACHED = "daily X budget reached";

/** The UTC day a moment (epoch seconds) belongs to, as `YYYY-MM-DD`. */
export function utcDay(nowSec: number): string {
  return new Date(nowSec * 1000).toISOString().slice(0, 10);
}

/** The first second of that UTC day. */
export function utcDayStart(nowSec: number): number {
  return Math.floor(nowSec / 86_400) * 86_400;
}

export function spentMicros(nowSec: number): number {
  return db.select().from(xSpend).where(eq(xSpend.day, utcDay(nowSec))).get()?.costMicros ?? 0;
}

/** Would this charge stay inside today's ceiling? */
export function canSpend(costMicros: number, nowSec: number, ceilingMicros = xDailyBudgetMicros()): boolean {
  return spentMicros(nowSec) + costMicros <= ceilingMicros;
}

/** Book a charge X has made. */
export function bookSpend(costMicros: number, nowSec: number): void {
  if (costMicros <= 0) return;
  db.insert(xSpend)
    .values({ day: utcDay(nowSec), costMicros, calls: 1, updatedAt: nowSec })
    .onConflictDoUpdate({
      target: xSpend.day,
      set: { costMicros: sql`${xSpend.costMicros} + ${costMicros}`, calls: sql`${xSpend.calls} + 1`, updatedAt: nowSec },
    })
    .run();
}
