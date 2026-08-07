import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { nowSeconds } from "@/lib/db/keys";
import { inspectionJobs } from "@/lib/db/schema";
import { getInspectionJob } from "@/lib/db/inspection";
import { reapStalledJob, reapStalledInspections } from "./job";

/**
 * The stalled-job reaper (real in-memory SQLite). Measured on prod: three jobs sat in
 * `generating_missions` / `field_test` for days after a deploy restart killed their `after()`
 * runner — the founder's screen said Sage was working and nothing was. The reaper runs off the
 * status poll: a stalled job with retries left resumes; one without becomes an honest failure.
 */

function seedJob(over: Partial<typeof inspectionJobs.$inferInsert> = {}): string {
  const id = nanoid(12);
  const now = nowSeconds();
  db.insert(inspectionJobs)
    .values({
      id, founderWallet: "anonymous", idempotencyKey: nanoid(20), status: "generating_missions",
      publicCampaignId: `pub-${id}`, productUrl: "https://x.example", goal: "g", targetUsers: "u",
      totalBudgetBase: 1_000_000, tokenDecimals: 6, createdAt: now - 3600, updatedAt: now - 3600,
      ...over,
    })
    .run();
  return id;
}

const STALE = nowSeconds() - 3600; // an hour without movement — far past the 15-minute threshold

describe("reapStalledJob", () => {
  it("a stalled job with retries left is failed then queued for a resume", () => {
    const id = seedJob({ updatedAt: STALE, retryCount: 0 });
    const job = getInspectionJob(id)!;
    expect(reapStalledJob(job)).toBe("retrying");
    const after = getInspectionJob(id)!;
    expect(after.status).toBe("queued");
    expect(after.retryCount).toBe(1);
  });

  it("a stalled job with retries spent becomes an honest failure naming the stage", () => {
    const id = seedJob({ updatedAt: STALE, retryCount: 2, status: "field_test" });
    const job = getInspectionJob(id)!;
    expect(reapStalledJob(job)).toBe("failed");
    const after = getInspectionJob(id)!;
    expect(after.status).toBe("failed");
    expect(after.failureReason).toBe("stalled_in_field_test");
  });

  it("a job that moved recently is never touched", () => {
    const id = seedJob({ updatedAt: nowSeconds() - 60 });
    const job = getInspectionJob(id)!;
    expect(reapStalledJob(job)).toBeNull();
    expect(getInspectionJob(id)!.status).toBe("generating_missions");
  });

  it("a terminal job is never touched", () => {
    for (const status of ["ready", "needs_input", "failed"] as const) {
      const id = seedJob({ status, updatedAt: STALE });
      expect(reapStalledJob(getInspectionJob(id)!)).toBeNull();
      expect(getInspectionJob(id)!.status).toBe(status);
    }
  });

  it("CAS: a run that advanced since the caller looked wins over the reaper", () => {
    const id = seedJob({ updatedAt: STALE });
    const snapshot = getInspectionJob(id)!; // the stale view a slow poller holds
    // the real runner advances the job between the poller's read and its reap attempt
    db.update(inspectionJobs).set({ status: "reviewing", updatedAt: nowSeconds() }).where(eq(inspectionJobs.id, id)).run();
    expect(reapStalledJob(snapshot)).toBeNull();
    expect(getInspectionJob(id)!.status).toBe("reviewing");
  });

  it("of two concurrent observers exactly one acts", () => {
    const id = seedJob({ updatedAt: STALE, retryCount: 2 });
    const a = getInspectionJob(id)!;
    const b = getInspectionJob(id)!;
    const results = [reapStalledJob(a), reapStalledJob(b)];
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});


/**
 * THE HEARTBEAT CANNOT BE THE FOUNDER'S ATTENTION.
 *
 * `reapStalledJob` fixes a dead job the moment someone looks at it, and the status poll was the
 * only thing that ever looked — so a founder who closes the tab, which is exactly the founder who
 * never comes back to un-stick it, leaves a job saying "Sage is working" forever.
 *
 * MEASURED on production: five jobs sat non-terminal past the threshold, idle for 108, 110, 778,
 * 1371 and 3643 minutes. The oldest had been stuck for more than sixty hours. Two were killed by a
 * deploy restart that same night — every deploy kills whatever `after()` work is in flight, so this
 * is routine rather than exotic.
 */
describe("reapStalledInspections (the sweep's unconditional pass)", () => {
  it("finds and resumes stalled jobs nobody is watching", () => {
    const ids = [seedJob({ updatedAt: STALE }), seedJob({ updatedAt: STALE, status: "field_test" })];
    const scheduled: string[] = [];
    const out = reapStalledInspections((fn) => {
      scheduled.push("ran");
      void fn;
    });
    expect(out.retried).toBeGreaterThanOrEqual(2);
    expect(scheduled.length).toBe(out.retried);
    for (const id of ids) expect(getInspectionJob(id)!.status).toBe("queued");
  });

  it("fails a job that has spent its retries, rather than resuming it forever", () => {
    const id = seedJob({ updatedAt: STALE, retryCount: 9 });
    const out = reapStalledInspections(() => {}, 25);
    expect(out.failed).toBeGreaterThanOrEqual(1);
    expect(getInspectionJob(id)!.status).toBe("failed");
  });

  it("leaves a job that is still moving alone", () => {
    const fresh = seedJob({ updatedAt: nowSeconds() }); // stamped just now
    reapStalledInspections(() => {}, 25);
    expect(getInspectionJob(fresh)!.status).toBe("generating_missions");
  });

  it("never touches a terminal job", () => {
    const done = seedJob({ updatedAt: STALE, status: "ready" });
    reapStalledInspections(() => {}, 25);
    expect(getInspectionJob(done)!.status).toBe("ready");
  });

  it("batches, because each retry is a real browser run", () => {
    for (let i = 0; i < 5; i++) seedJob({ updatedAt: STALE });
    const out = reapStalledInspections(() => {}, 2);
    expect(out.retried + out.failed).toBeLessThanOrEqual(2);
  });
});
