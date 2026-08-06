import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { nowSeconds } from "@/lib/db/keys";
import { inspectionJobs } from "@/lib/db/schema";
import { getInspectionJob } from "@/lib/db/inspection";
import { reapStalledJob } from "./job";

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
