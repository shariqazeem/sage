import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { createCampaign, createMission, createSubmission, updateSubmission } from "@/lib/db/campaigns";
import { missionIdHash } from "./mission-plan";
import { buildWalletRecord } from "./record";

/**
 * THE VERIFIED WORK RECORD (move 3) — composed ONLY from paid, receipt-anchored rows:
 * paid-with-tx entries in, everything else out (pending, rejected, tx-less "paid" inconsistencies,
 * sandbox campaigns). Totals exact; newest first; campaign kind carried for the label.
 */

let n = 900;
const W = "0x00000000000000000000000000000000000000aa";

function seedCampaign(kind: "grant" | "testing", opts: { sandbox?: boolean } = {}) {
  const c = createCampaign({
    title: `rec-${kind}-${++n}`,
    rewardAmount: 1_500_000,
    vaultAddress: `0x${"7".repeat(40)}`,
    posterWallet: `0x${"6".repeat(40)}`,
    chainId: 2345,
    status: "live",
    sandbox: opts.sandbox ?? false,
  });
  db.update(campaigns).set({ kind }).where(eq(campaigns.id, c.id)).run();
  return c;
}

function paidSub(campaignId: string, missionKey: string, rewardBase: number, tx: string | null, at: number, walletOverride?: string) {
  const hash = missionIdHash(campaignId, missionKey);
  createMission({
    campaignId,
    missionKey,
    missionIdHash: hash,
    title: `Milestone ${missionKey}`,
    rewardAmount: rewardBase,
    maxCompletions: 3,
    displayOrder: 0,
    verifiabilityClass: "url-verifiable",
  });
  const r = createSubmission({ campaignId, wallet: walletOverride ?? W, evidenceUrl: `https://x.org/${missionKey}-${n}`, note: "done", missionIdHash: hash, missionSpecDigest: null });
  if (!r.ok) throw new Error("seed failed");
  updateSubmission(r.submission.id, { status: "paid", payoutTx: tx, decidedAt: at });
  return r.submission.id;
}

describe("buildWalletRecord — paid + anchored only, totals exact", () => {
  it("composes the record across campaigns, excludes everything unearned or unanchored", () => {
    const grant = seedCampaign("grant");
    const testing = seedCampaign("testing");
    const sandbox = seedCampaign("grant", { sandbox: true });

    // stored CHECKSUM-CASED, exactly how prod's SIWE sessions store wallets — the record must still find it
    paidSub(grant.id, "m1", 2_000_000, `0x${"a1".repeat(32)}`, 1_000, "0x00000000000000000000000000000000000000AA");
    paidSub(testing.id, "m2", 1_500_000, `0x${"b2".repeat(32)}`, 2_000); // newer
    paidSub(grant.id, "m3", 500_000, null, 3_000); // paid but NO tx — inconsistency, excluded
    paidSub(sandbox.id, "m4", 9_000_000, `0x${"c3".repeat(32)}`, 4_000); // sandbox — excluded

    // a pending and a rejected submission on the same wallet — never in the record
    const pending = createSubmission({ campaignId: grant.id, wallet: W, evidenceUrl: `https://x.org/pending-${n}`, note: "", missionIdHash: null, missionSpecDigest: null });
    if (pending.ok) updateSubmission(pending.submission.id, { status: "rejected" });

    const rec = buildWalletRecord(W.toUpperCase())!; // case-insensitive lookup
    expect(rec.wallet).toBe(W);
    expect(rec.completions).toBe(2);
    expect(rec.totalUsd).toBe(3.5);
    expect(rec.distinctCampaigns).toBe(2);
    expect(rec.entries[0]!.kind).toBe("testing"); // newest first (decidedAt 2000)
    expect(rec.entries[1]!.kind).toBe("grant");
    expect(rec.entries[0]!.proofPath).toBe(`/proof/0x${"b2".repeat(32)}`);
    expect(rec.firstAt).toBe(1_000);
    expect(rec.lastAt).toBe(2_000);
  });

  it("refuses a non-address; empty wallet yields an honest empty record", () => {
    expect(buildWalletRecord("not-a-wallet")).toBeNull();
    const empty = buildWalletRecord(`0x${"9".repeat(40)}`)!;
    expect(empty.completions).toBe(0);
    expect(empty.totalUsd).toBe(0);
    expect(empty.firstAt).toBeNull();
  });
});
