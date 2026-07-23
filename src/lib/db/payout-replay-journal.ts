import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import { nowSeconds } from "./keys";
import { payoutReplayJournal } from "./schema";

/**
 * Phase 5 — durable idempotency journal for payout action replay, keyed by (submissionId, policyDigest,
 * probeDigest). A COMPLETED row is reused on a payout retry with the SAME digests; a changed policy/probe is a
 * new key → a fresh replay; an in-flight row (completedAt null) is an ambiguous crash to reconcile (re-run —
 * replay is read-only). Persists ONLY identifiers/digests + a bounded outcome + timings; never raw content.
 */

export interface ReplayJournalLookup {
  decision: "allow" | "hold";
  code: string;
  completed: boolean;
  attempt: number;
}

/** The interface the replay runner uses; the DB implementation is `dbReplayJournal`, a fake is used in tests. */
export interface ReplayJournalHandle {
  lookup(submissionId: string, policyDigest: string, probeDigest: string): ReplayJournalLookup | null;
  begin(submissionId: string, policyDigest: string, probeDigest: string): void;
  complete(submissionId: string, policyDigest: string, probeDigest: string, outcome: { decision: "allow" | "hold"; code: string; latencyMs: number }): void;
}

const whereKey = (submissionId: string, policyDigest: string, probeDigest: string) =>
  and(eq(payoutReplayJournal.submissionId, submissionId), eq(payoutReplayJournal.policyDigest, policyDigest), eq(payoutReplayJournal.probeDigest, probeDigest));

export const dbReplayJournal: ReplayJournalHandle = {
  lookup(submissionId, policyDigest, probeDigest) {
    const row = db.select().from(payoutReplayJournal).where(whereKey(submissionId, policyDigest, probeDigest)).get();
    if (!row) return null;
    return { decision: (row.decision as "allow" | "hold") ?? "hold", code: row.outcomeCode ?? "internal_error", completed: row.completedAt != null, attempt: row.attempt };
  },
  begin(submissionId, policyDigest, probeDigest) {
    const now = nowSeconds();
    const existing = db.select().from(payoutReplayJournal).where(whereKey(submissionId, policyDigest, probeDigest)).get();
    if (existing) {
      // reconcile an in-flight crash: bump the attempt + reset to in-flight (re-run is safe — replay is read-only).
      db.update(payoutReplayJournal).set({ startedAt: now, completedAt: null, decision: null, outcomeCode: null, latencyMs: null, attempt: existing.attempt + 1 }).where(eq(payoutReplayJournal.id, existing.id)).run();
      return;
    }
    db.insert(payoutReplayJournal).values({ id: nanoid(14), submissionId, policyDigest, probeDigest, startedAt: now, attempt: 1 }).run();
  },
  complete(submissionId, policyDigest, probeDigest, outcome) {
    db.update(payoutReplayJournal).set({ decision: outcome.decision, outcomeCode: outcome.code, completedAt: nowSeconds(), latencyMs: outcome.latencyMs }).where(whereKey(submissionId, policyDigest, probeDigest)).run();
  },
};
