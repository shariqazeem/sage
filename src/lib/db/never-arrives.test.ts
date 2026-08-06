import { describe, expect, it } from "vitest";

import { db } from "./index";
import { submissions } from "./schema";
import { eq } from "drizzle-orm";
import {
  createCampaign,
  createSubmission,
  listUnresolvedSubmissionsOlderThan,
  hasStaleEvent,
  recordEvent,
  setCampaignStatus,
} from "./campaigns";

/**
 * NOBODY WAITS IN SILENCE.
 *
 * Two testers once sat at "verifying" on the public board for 14 and 15 days. Nothing judged them
 * wrongly; nothing judged them at all. Their campaign had been stopped, and the sweep's processing
 * list correctly skips terminal campaigns because their vaults can never settle — so the rows fell
 * through the one loop that would have noticed, and stayed there until a human happened to look.
 *
 * A wrong answer is survivable. Silence is not, and it is the failure most likely to reach a
 * stranger, because it needs no bug at the moment it happens: it needs only for nobody to be
 * watching afterwards.
 *
 * These run against real in-memory SQLite, so the join and the ordering are proven by the engine.
 */

const wallet = () => `0x${Math.random().toString(16).slice(2).padEnd(40, "a").slice(0, 40)}`;

function seed(opts: { ageSeconds: number; stopped?: boolean }) {
  const c = createCampaign({
    title: "never-arrives fixture",
    rewardAmount: 100_000,
    vaultAddress: `0x${"1".repeat(40)}`,
    posterWallet: `0x${"2".repeat(40)}`,
    chainId: 2345,
    criteria: ["do the thing"],
  });
  const s = createSubmission({ campaignId: c.id, wallet: wallet(), note: "I did the thing." });
  const id = (s as { submission?: { id: string } }).submission?.id ?? (s as unknown as { id: string }).id;
  // Backdate it rather than waiting a day.
  const created = Math.floor(Date.now() / 1000) - opts.ageSeconds;
  db.update(submissions).set({ createdAt: created }).where(eq(submissions.id, id)).run();
  if (opts.stopped) setCampaignStatus(c.id, "stopped");
  return { campaignId: c.id, submissionId: id };
}

const cutoff = () => Math.floor(Date.now() / 1000) - 24 * 3600;

describe("the guard sees what the processing loop cannot", () => {
  it("finds a submission stranded on a STOPPED campaign", () => {
    // This is the exact 15-day case. If terminal campaigns were excluded here too, the guard would
    // reproduce the original bug faithfully and report all-clear.
    const { submissionId } = seed({ ageSeconds: 30 * 3600, stopped: true });
    const found = listUnresolvedSubmissionsOlderThan(cutoff());
    expect(found.map((r) => r.id)).toContain(submissionId);
    expect(found.find((r) => r.id === submissionId)?.campaignStatus).toBe("stopped");
  });

  it("finds one on a live campaign too", () => {
    const { submissionId } = seed({ ageSeconds: 26 * 3600 });
    expect(listUnresolvedSubmissionsOlderThan(cutoff()).map((r) => r.id)).toContain(submissionId);
  });

  it("leaves a fresh submission alone", () => {
    const { submissionId } = seed({ ageSeconds: 60 });
    expect(listUnresolvedSubmissionsOlderThan(cutoff()).map((r) => r.id)).not.toContain(submissionId);
  });

  it("reports oldest first, so the longest wait is addressed first", () => {
    seed({ ageSeconds: 100 * 3600 });
    seed({ ageSeconds: 26 * 3600 });
    const found = listUnresolvedSubmissionsOlderThan(cutoff());
    const ages = found.map((r) => r.createdAt);
    expect([...ages].sort((a, b) => a - b)).toEqual(ages);
  });
});

describe("it speaks once per row, not once per window", () => {
  it("goes quiet after the first alert for a given submission", () => {
    const { campaignId, submissionId } = seed({ ageSeconds: 26 * 3600 });
    expect(hasStaleEvent(submissionId)).toBe(false);

    recordEvent({ campaignId, submissionId, kind: "submission_stale", detail: "first alert" });
    expect(hasStaleEvent(submissionId)).toBe(true);
  });

  it("still alerts a row that crossed the bound while the sweeper was DOWN", () => {
    // The reason this is keyed off the journal and not off a time window. A window only fires for
    // rows that cross while the sweeper happens to be running, so an outage — precisely when someone
    // is most likely to be left waiting — would produce no alert at all, forever.
    const { submissionId } = seed({ ageSeconds: 40 * 24 * 3600 }); // crossed 24h weeks ago
    expect(listUnresolvedSubmissionsOlderThan(cutoff()).map((r) => r.id)).toContain(submissionId);
    expect(hasStaleEvent(submissionId)).toBe(false); // never told anyone → it still will
  });

  it("keeps each submission's alert state separate", () => {
    const a = seed({ ageSeconds: 26 * 3600 });
    const b = seed({ ageSeconds: 26 * 3600 });
    recordEvent({ campaignId: a.campaignId, submissionId: a.submissionId, kind: "submission_stale", detail: "x" });
    expect(hasStaleEvent(a.submissionId)).toBe(true);
    expect(hasStaleEvent(b.submissionId)).toBe(false);
  });
});
