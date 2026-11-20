import "server-only";
import { and, count, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspectionJobs } from "@/lib/db/schema";
import { isOwnWallet } from "@/lib/campaigns/settled-ledger";

/**
 * A FAIR SHARE OF SAGE'S DAY (relaunch, 20 Nov 2026).
 *
 * Every test Sage starts (a real browser run, then the missions) costs model spend from one daily budget
 * shared by every builder (`LLM_DAILY_BUDGET_USD`). One person pasting links all day would stop everyone
 * else's tests for the rest of it. So the web's front door starts at most `WEB_INSPECTION_DAILY_CAP`
 * (default 5) new tests per person in any 24 hours. A retry of the same form is not a new test, and
 * Sage's own wallets are not limited. Telegram and tags on X have their own caps.
 */
export const DEFAULT_WEB_TESTS_PER_DAY = 5;

export function webTestsPerDay(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.WEB_INSPECTION_DAILY_CAP?.trim());
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_WEB_TESTS_PER_DAY;
}

/** Tests this person started since then, whatever spelling their address was stored in. */
export function testsStartedSince(founder: string, sinceSec: number): number {
  return (
    db
      .select({ n: count() })
      .from(inspectionJobs)
      .where(and(sql`lower(${inspectionJobs.founderWallet}) = ${founder.trim().toLowerCase()}`, gte(inspectionJobs.createdAt, sinceSec)))
      .get()?.n ?? 0
  );
}

export type DailyTestCheck = { ok: true } | { ok: false; cap: number; message: string };

export function dailyTestLimit(founder: string, nowSec: number, env: Record<string, string | undefined> = process.env): DailyTestCheck {
  if (isOwnWallet(founder)) return { ok: true };
  const cap = webTestsPerDay(env);
  if (testsStartedSince(founder, nowSec - 86_400) < cap) return { ok: true };
  return {
    ok: false,
    cap,
    message: `You've started ${cap} tests in the last day, the most Sage runs for one person. Your tests are saved, and you can start another tomorrow.`,
  };
}
