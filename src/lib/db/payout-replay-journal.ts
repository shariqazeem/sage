import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
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
  /** P4 — the active lease + completion time + runner version, for freshness + CAS. */
  runId: string | null;
  completedAt: number | null;
  probeVersion: string;
}

/** The interface the replay runner uses; the DB implementation is `dbReplayJournal`, a fake is used in tests.
 *  P4 — begin() returns an opaque lease (runId + attempt); complete() CAS-updates only against that exact lease. */
export interface ReplayJournalHandle {
  lookup(submissionId: string, policyDigest: string, probeDigest: string): ReplayJournalLookup | null;
  begin(submissionId: string, policyDigest: string, probeDigest: string): { runId: string; attempt: number };
  complete(runId: string, submissionId: string, policyDigest: string, probeDigest: string, outcome: { decision: "allow" | "hold"; code: string; latencyMs: number }): boolean;
}

const whereKey = (submissionId: string, policyDigest: string, probeDigest: string) =>
  and(eq(payoutReplayJournal.submissionId, submissionId), eq(payoutReplayJournal.policyDigest, policyDigest), eq(payoutReplayJournal.probeDigest, probeDigest));

/** The replay runner/probe contract version. A completed row from an OLDER runner is stale — re-run (its cache
 *  is invalid). Bump this whenever the browser replay semantics change (e.g. the Phase-6 URL enforcement). */
export const REPLAY_RUNNER_VERSION = "replay-runner-v2-urlcheck";

export const dbReplayJournal: ReplayJournalHandle = {
  lookup(submissionId, policyDigest, probeDigest) {
    const row = db.select().from(payoutReplayJournal).where(whereKey(submissionId, policyDigest, probeDigest)).get();
    if (!row) return null;
    return { decision: (row.decision as "allow" | "hold") ?? "hold", code: row.outcomeCode ?? "internal_error", completed: row.completedAt != null, attempt: row.attempt, runId: row.runId, completedAt: row.completedAt, probeVersion: row.probeVersion };
  },
  begin(submissionId, policyDigest, probeDigest) {
    const now = nowSeconds();
    const runId = nanoid(18);
    // ATOMIC upsert (INSERT … ON CONFLICT DO UPDATE on the unique key) — concurrency-safe: two racing begins
    // never both insert; a re-begin mints a FRESH runId lease (invalidating any older in-flight run's later
    // completion) + resets to in-flight + bumps attempt. Read-only replay makes a re-run safe.
    db.insert(payoutReplayJournal)
      .values({ id: nanoid(14), submissionId, policyDigest, probeDigest, startedAt: now, attempt: 1, probeVersion: REPLAY_RUNNER_VERSION, runId })
      .onConflictDoUpdate({
        target: [payoutReplayJournal.submissionId, payoutReplayJournal.policyDigest, payoutReplayJournal.probeDigest],
        set: { startedAt: now, completedAt: null, decision: null, outcomeCode: null, latencyMs: null, probeVersion: REPLAY_RUNNER_VERSION, runId, attempt: sql`${payoutReplayJournal.attempt} + 1` },
      })
      .run();
    const row = db.select().from(payoutReplayJournal).where(whereKey(submissionId, policyDigest, probeDigest)).get();
    return { runId, attempt: row?.attempt ?? 1 };
  },
  complete(runId, submissionId, policyDigest, probeDigest, outcome) {
    // CAS on the active lease: only complete while THIS run is still the active in-flight one. A superseded or
    // late completion (a newer begin minted a different runId) matches 0 rows and cannot overwrite the current.
    const res = db.update(payoutReplayJournal)
      .set({ decision: outcome.decision, outcomeCode: outcome.code, completedAt: nowSeconds(), latencyMs: outcome.latencyMs })
      .where(and(whereKey(submissionId, policyDigest, probeDigest), eq(payoutReplayJournal.runId, runId), isNull(payoutReplayJournal.completedAt)))
      .run();
    return res.changes === 1;
  },
};
