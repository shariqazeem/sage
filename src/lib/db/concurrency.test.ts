import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  acquireLock,
  casSubmissionStatus,
  createCampaign,
  createSubmission,
  releaseLock,
  resetStaleSettling,
} from "./campaigns";
import { db } from "./index";
import { locks, submissions } from "./schema";
import { nowSeconds } from "./keys";

/**
 * DB-backed FAILURE DRILLS — the real atomic guards, against an isolated
 * in-memory SQLite (vitest sets SAGE_DB_PATH=":memory:"). These prove the SQL
 * itself is safe, not just the pure model in autopilot.test.ts.
 */

let walletSeq = 0;
function seedPendingSubmission(): string {
  const c = createCampaign({
    title: "drill",
    rewardAmount: 1_000_000,
    vaultAddress: "0x0000000000000000000000000000000000000001",
    posterWallet: "0x0000000000000000000000000000000000000002",
    autonomy: "autopilot",
  });
  // unique wallet per seed so the dedupe index never collides across tests
  const wallet = `0x${(++walletSeq).toString(16).padStart(40, "0")}`;
  const r = createSubmission({ campaignId: c.id, wallet });
  if (!r.ok) throw new Error(`seed failed: ${r.error}`);
  return r.submission.id;
}

describe("casSubmissionStatus — double-trigger yields exactly one settle", () => {
  it("only the first pending→settling transition wins; the second is refused", () => {
    const id = seedPendingSubmission();
    const first = casSubmissionStatus(id, "pending", "settling");
    const second = casSubmissionStatus(id, "pending", "settling");
    expect(first).toBe(true);
    expect(second).toBe(false);
    const row = db.select().from(submissions).where(eq(submissions.id, id)).get();
    expect(row?.status).toBe("settling");
  });

  it("refuses a transition from the wrong state", () => {
    const id = seedPendingSubmission();
    expect(casSubmissionStatus(id, "approved", "settling")).toBe(false); // it's pending
    const row = db.select().from(submissions).where(eq(submissions.id, id)).get();
    expect(row?.status).toBe("pending");
  });
});

describe("acquireLock — the sweep singleton recovers an expired lock", () => {
  it("acquires when free, refuses while a live holder owns it, recovers once expired", () => {
    releaseLock("drill_sweep");
    expect(acquireLock("drill_sweep", 55)).toBe(true); // free → acquired
    expect(acquireLock("drill_sweep", 55)).toBe(false); // live holder → refused

    // Simulate a crashed holder: rewrite its expiry into the past.
    db.update(locks)
      .set({ expiresAt: nowSeconds() - 10 })
      .where(eq(locks.name, "drill_sweep"))
      .run();

    expect(acquireLock("drill_sweep", 55)).toBe(true); // expired → stolen/recovered
    releaseLock("drill_sweep");
  });
});

describe("resetStaleSettling — recovers a crashed 'settling' row", () => {
  it("returns a crashed settling row to pending so the sweep can re-process it", () => {
    const id = seedPendingSubmission();
    casSubmissionStatus(id, "pending", "settling"); // stamps decidedAt = now
    // Backdate decidedAt so it looks like it crashed mid-settle.
    db.update(submissions)
      .set({ decidedAt: nowSeconds() - 10_000 })
      .where(eq(submissions.id, id))
      .run();

    const recovered = resetStaleSettling(nowSeconds() - 300);
    expect(recovered).toBeGreaterThanOrEqual(1);
    const row = db.select().from(submissions).where(eq(submissions.id, id)).get();
    expect(row?.status).toBe("pending");
    expect(row?.decidedAt).toBeNull();
  });
});

describe("campaigns.chainId — the network column (migration default)", () => {
  it("defaults a new campaign to Metis Sepolia (59902), honors an explicit 2345", () => {
    const testnet = createCampaign({
      title: "testnet",
      rewardAmount: 1_000_000,
      vaultAddress: `0x${"1".repeat(40)}`,
      posterWallet: `0x${"2".repeat(40)}`,
    });
    expect(testnet.chainId).toBe(59902);

    const mainnet = createCampaign({
      title: "mainnet",
      rewardAmount: 500_000,
      vaultAddress: `0x${"3".repeat(40)}`,
      posterWallet: `0x${"4".repeat(40)}`,
      chainId: 2345,
    });
    expect(mainnet.chainId).toBe(2345);
  });
});
