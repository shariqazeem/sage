import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { coreAnswers } from "@/lib/db/schema";
import { getMissionByKey } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import { CORE_MISSION_KEY, type Again, type Reached } from "./shape";

/**
 * WHAT A TESTER TAPPED on the core mission (the core, 21 Nov 2026): how far they got, and whether
 * they would use it again. Stored apart from their written answer, so the words Sage judges stay the
 * tester's own. Read only by the report, which counts rows; never by a model, and never by the judge.
 */
export interface CoreAnswer {
  submissionId: string;
  reached: Reached;
  again: Again;
  at: number;
}

export function getCoreAnswer(submissionId: string): CoreAnswer | null {
  const r = db.select().from(coreAnswers).where(eq(coreAnswers.submissionId, submissionId)).get();
  return r ? { submissionId: r.submissionId, reached: r.reached, again: r.again, at: r.createdAt } : null;
}

/** Save the taps for one answer. A revised answer may revise its taps: the last one stands. */
export function setCoreAnswer(input: { submissionId: string; campaignId: string; reached: Reached; again: Again }, now = nowSeconds()): CoreAnswer {
  const set = { campaignId: input.campaignId, reached: input.reached, again: input.again, createdAt: now };
  db.insert(coreAnswers)
    .values({ submissionId: input.submissionId, ...set })
    .onConflictDoUpdate({ target: coreAnswers.submissionId, set })
    .run();
  return { submissionId: input.submissionId, reached: input.reached, again: input.again, at: now };
}

export function listCoreAnswers(campaignId: string): Map<string, CoreAnswer> {
  const rows = db.select().from(coreAnswers).where(eq(coreAnswers.campaignId, campaignId)).all();
  return new Map(rows.map((r) => [r.submissionId, { submissionId: r.submissionId, reached: r.reached, again: r.again, at: r.createdAt }]));
}

/** This test's core mission id (the bytes32 a submission carries), or null when it has none. */
export function coreMissionHash(campaignId: string): string | null {
  return getMissionByKey(campaignId, CORE_MISSION_KEY)?.missionIdHash ?? null;
}
