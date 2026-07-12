import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { db } from "./index";
import { nowSeconds } from "./keys";
import { inspectionJobs } from "./schema";
import { claimInspectionJob, getInspectionJob } from "./inspection";

/**
 * Ownership transfer for the plan-claim (real in-memory SQLite). An anonymous inspection
 * can be claimed by a wallet exactly once; a plan already owned by a DIFFERENT wallet can
 * never be stolen — the load-bearing "an anonymous browser cannot claim another browser's
 * plan" property, enforced atomically at the DB layer.
 */

function seedJob(owner: string): string {
  const id = nanoid(12);
  const now = nowSeconds();
  db.insert(inspectionJobs)
    .values({
      id, founderWallet: owner, idempotencyKey: nanoid(20), status: "ready",
      publicCampaignId: `pub-${id}`, productUrl: "https://x.example", goal: "g", targetUsers: "u",
      totalBudgetBase: 1_000_000, tokenDecimals: 6, createdAt: now, updatedAt: now,
    })
    .run();
  return id;
}

describe("claimInspectionJob — anonymous → wallet, once, never stolen", () => {
  const WALLET_A = `0x${"a".repeat(40)}`;
  const WALLET_B = `0x${"b".repeat(40)}`;

  it("transfers an anonymous plan to the claiming wallet", () => {
    const id = seedJob("anonymous");
    expect(claimInspectionJob(id, WALLET_A).ok).toBe(true);
    expect(getInspectionJob(id)?.founderWallet).toBe(WALLET_A.toLowerCase());
  });

  it("is idempotent for the same wallet (resume)", () => {
    const id = seedJob("anonymous");
    expect(claimInspectionJob(id, WALLET_A).ok).toBe(true);
    expect(claimInspectionJob(id, WALLET_A).ok).toBe(true); // no-op, still ok
    expect(getInspectionJob(id)?.founderWallet).toBe(WALLET_A.toLowerCase());
  });

  it("refuses to let another wallet claim an already-owned plan", () => {
    const id = seedJob("anonymous");
    expect(claimInspectionJob(id, WALLET_A).ok).toBe(true);
    const stolen = claimInspectionJob(id, WALLET_B);
    expect(stolen).toEqual({ ok: false, reason: "already_claimed_by_another_wallet" });
    expect(getInspectionJob(id)?.founderWallet).toBe(WALLET_A.toLowerCase()); // unchanged
  });

  it("refuses an unknown job", () => {
    expect(claimInspectionJob("nope", WALLET_A)).toEqual({ ok: false, reason: "no_such_job" });
  });
});
