import "server-only";

import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { nowSeconds } from "@/lib/db/keys";
import { programmeRounds, programmes, type Programme, type ProgrammeRound } from "@/lib/db/schema";

/**
 * TIME: THE DURABLE STATE OF A PROGRAMME (6 Nov 2026). The rules that decide WHEN a round opens live in
 * rounds.ts; this file only reads and writes rows. Every write that precedes money (a round's `opening`
 * row) is keyed by (programme, round), so a round can be opened once, whatever retries do.
 */

export const DAY = 86_400;

export function getProgramme(id: string): Programme | null {
  return db.select().from(programmes).where(eq(programmes.id, id)).get() ?? null;
}

export function listRounds(programmeId: string): ProgrammeRound[] {
  return db.select().from(programmeRounds).where(eq(programmeRounds.programmeId, programmeId)).orderBy(asc(programmeRounds.round)).all();
}

export function getRound(programmeId: string, round: number): ProgrammeRound | null {
  return db.select().from(programmeRounds).where(and(eq(programmeRounds.programmeId, programmeId), eq(programmeRounds.round, round))).get() ?? null;
}

/** A programme is created with its first round's job already compiled; it stays a draft until that job is live. */
export function createProgramme(input: {
  founderWallet: string;
  chainId: number;
  title: string;
  spec: Record<string, unknown>;
  roundBudgetBase: bigint;
  everyDays: number;
  roundsTotal: number;
  round1JobId: string;
  now?: number;
}): Programme {
  const now = input.now ?? nowSeconds();
  const row: Programme = {
    id: `prg_${nanoid(12)}`,
    founderWallet: input.founderWallet.toLowerCase(),
    chainId: input.chainId,
    title: input.title,
    spec: input.spec,
    roundBudgetBase: Number(input.roundBudgetBase),
    everyDays: input.everyDays,
    roundsTotal: input.roundsTotal,
    nextRoundAt: null,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  db.insert(programmes).values(row).run();
  db.insert(programmeRounds).values({ programmeId: row.id, round: 1, status: "opening", jobId: input.round1JobId, createdAt: now, updatedAt: now }).run();
  return row;
}

/** The programme whose round `round` was compiled as `jobId`. */
export function roundForJob(jobId: string): ProgrammeRound | null {
  return db.select().from(programmeRounds).where(eq(programmeRounds.jobId, jobId)).get() ?? null;
}

export function roundForCampaign(campaignId: string): ProgrammeRound | null {
  return db.select().from(programmeRounds).where(eq(programmeRounds.campaignId, campaignId)).get() ?? null;
}

/** The round open right now (its campaign), or null between rounds; `ended` once nothing more will open. */
export function currentRound(programmeId: string): { campaignId: string | null; ended: boolean; round: number | null } {
  const p = getProgramme(programmeId);
  if (!p) return { campaignId: null, ended: true, round: null };
  const live = db
    .select()
    .from(programmeRounds)
    .where(and(eq(programmeRounds.programmeId, programmeId), eq(programmeRounds.status, "live")))
    .orderBy(desc(programmeRounds.round))
    .get();
  const open = live && !live.closedAt ? live : null;
  return { campaignId: open?.campaignId ?? null, ended: (p.status === "ended" || p.status === "stopped") && !open, round: open?.round ?? null };
}

/** A round's job went live: the round is open, and the next one is scheduled one period on. */
export function markRoundLive(programmeId: string, round: number, campaignId: string, now = nowSeconds()): void {
  const p = getProgramme(programmeId);
  if (!p) return;
  db.update(programmeRounds)
    .set({ status: "live", campaignId, openedAt: now, error: null, updatedAt: now })
    .where(and(eq(programmeRounds.programmeId, programmeId), eq(programmeRounds.round, round)))
    .run();
  // The next round opens one period on, and the LAST round closes then: either way the sweep comes back.
  db.update(programmes)
    .set({ status: "active", nextRoundAt: now + p.everyDays * DAY, updatedAt: now })
    .where(eq(programmes.id, programmeId))
    .run();
}

/** Every round has opened and the last one has had its period: nothing more will open. */
export function endProgramme(programmeId: string, now = nowSeconds()): void {
  db.update(programmes).set({ status: "ended", nextRoundAt: null, updatedAt: now }).where(eq(programmes.id, programmeId)).run();
}

/** Write the next round's row BEFORE anything is sent. True when this caller owns the attempt. */
export function beginRound(programmeId: string, round: number, now = nowSeconds()): ProgrammeRound | null {
  db.insert(programmeRounds).values({ programmeId, round, status: "opening", createdAt: now, updatedAt: now }).onConflictDoNothing().run();
  return getRound(programmeId, round);
}

export function noteRoundAttempt(programmeId: string, round: number, patch: { jobId?: string | null; error?: string | null; status?: ProgrammeRound["status"] }, now = nowSeconds()): void {
  const cur = getRound(programmeId, round);
  if (!cur) return;
  db.update(programmeRounds)
    .set({ ...patch, attempts: cur.attempts + 1, lastAttemptAt: now, updatedAt: now })
    .where(and(eq(programmeRounds.programmeId, programmeId), eq(programmeRounds.round, round)))
    .run();
}

export function markRoundClosed(programmeId: string, round: number, now = nowSeconds()): void {
  db.update(programmeRounds)
    .set({ closedAt: now, updatedAt: now })
    .where(and(eq(programmeRounds.programmeId, programmeId), eq(programmeRounds.round, round)))
    .run();
}

/** A round that could not open in its window is skipped; the schedule moves on to the next. */
export function skipRound(programmeId: string, round: number, reason: string, now = nowSeconds()): void {
  const p = getProgramme(programmeId);
  if (!p) return;
  db.update(programmeRounds)
    .set({ status: "skipped", error: reason, updatedAt: now })
    .where(and(eq(programmeRounds.programmeId, programmeId), eq(programmeRounds.round, round)))
    .run();
  const more = round < p.roundsTotal;
  db.update(programmes)
    .set({ status: more ? "active" : "ended", nextRoundAt: more ? (p.nextRoundAt ?? now) + p.everyDays * DAY : null, updatedAt: now })
    .where(eq(programmes.id, programmeId))
    .run();
}

export function stopProgramme(programmeId: string, now = nowSeconds()): void {
  db.update(programmes).set({ status: "stopped", nextRoundAt: null, updatedAt: now }).where(eq(programmes.id, programmeId)).run();
}

/** Programmes with a round due now. */
export function dueProgrammes(now = nowSeconds()): Programme[] {
  return db
    .select()
    .from(programmes)
    .where(and(eq(programmes.status, "active"), lte(programmes.nextRoundAt, now)))
    .all();
}

export function programmesOf(founderWallet: string): Programme[] {
  return db.select().from(programmes).where(eq(programmes.founderWallet, founderWallet.toLowerCase())).orderBy(desc(programmes.createdAt)).all();
}

export function roundsOfCampaigns(campaignIds: string[]): ProgrammeRound[] {
  if (campaignIds.length === 0) return [];
  return db.select().from(programmeRounds).where(inArray(programmeRounds.campaignId, campaignIds)).all();
}
