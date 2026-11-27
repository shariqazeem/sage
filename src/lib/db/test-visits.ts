import "server-only";
import { createHash } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { testVisits, type TestVisitRow } from "@/lib/db/schema";
import { founderStorageKey } from "@/lib/auth/founder";
import type { SourceKey } from "@/lib/test-page/funnel";

/**
 * WHO CAME TO A TEST (27 Nov 2026). The rows behind the owner's funnel: one per test and visitor.
 *
 * A visitor is the hash of a random first-party cookie, so the table holds no IP address, no user agent and
 * nothing that names a person. The source is the FIRST touch and is never overwritten; "signed in" and
 * "opened the product" are each written the first time and never again.
 */

/** A page that re-reads every few seconds must not become a write every few seconds. */
export const VISIT_WRITE_GAP_SEC = 30;

/** The most visitors one test keeps: a ceiling on what a script that drops its cookie can write. */
export const MAX_VISITORS_PER_TEST = 20_000;

/** The visitor id kept for a cookie value: the first 32 hex characters of its sha256. */
export function visitorId(cookieValue: string): string {
  return createHash("sha256").update(cookieValue).digest("hex").slice(0, 32);
}

export interface VisitInput {
  campaignId: string;
  visitor: string;
  /** decided by the caller for this request; kept only when this is the visitor's first row */
  source: SourceKey;
  /** the signed-in wallet, when there is a session */
  wallet: string | null;
  step: "view" | "opened";
  now: number;
}

/**
 * Record one visit. Returns whether anything was written.
 *
 * At most one VIEW is written per test and visitor every 30 seconds. A first sign-in and a first click
 * through to the product are facts that happen once each, so they are written when they happen even inside
 * that gap (a person who opens the product five seconds after the page must not be lost).
 */
export function recordVisit(input: VisitInput): boolean {
  const { campaignId, visitor, now } = input;
  const wallet = input.wallet ? founderStorageKey(input.wallet) : null;
  const where = and(eq(testVisits.campaignId, campaignId), eq(testVisits.visitor, visitor));
  const row = db.select().from(testVisits).where(where).get();
  if (!row) {
    db.insert(testVisits)
      .values({
        campaignId,
        visitor,
        source: input.source,
        wallet,
        firstAt: now,
        lastAt: now,
        views: 1,
        signedInAt: wallet ? now : null,
        openedAt: input.step === "opened" ? now : null,
      })
      .onConflictDoNothing()
      .run();
    return true;
  }
  const firstSignIn = wallet !== null && row.signedInAt === null;
  const firstOpen = input.step === "opened" && row.openedAt === null;
  const viewDue = input.step === "view" && now - row.lastAt >= VISIT_WRITE_GAP_SEC;
  if (!firstSignIn && !firstOpen && !viewDue) return false;
  db.update(testVisits)
    .set({
      lastAt: now,
      views: viewDue ? row.views + 1 : row.views,
      ...(firstSignIn ? { wallet, signedInAt: now } : {}),
      ...(firstOpen ? { openedAt: now } : {}),
    })
    .where(where)
    .run();
  return true;
}

/** Every visit to a test, oldest first. */
export function listVisits(campaignId: string): TestVisitRow[] {
  return db.select().from(testVisits).where(eq(testVisits.campaignId, campaignId)).all().sort((a, b) => a.firstAt - b.firstAt);
}

export function countVisits(campaignId: string): number {
  return db.select({ n: count() }).from(testVisits).where(eq(testVisits.campaignId, campaignId)).get()?.n ?? 0;
}
