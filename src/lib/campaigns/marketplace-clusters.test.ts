import { describe, expect, it } from "vitest";
import { marketplace } from "./marketplace";
import { linkWallets } from "./wallet-links";
import { seedV2Campaign } from "./campaign-v2.fixture";
import { casSubmissionStatus, createSubmission, recordEvent, updateSubmission } from "@/lib/db/campaigns";

/**
 * The board's showcase is the first thing a stranger reads, and on 2026-09-04 all eight rows were
 * wallets belonging to one operator we had already proven and published as a cluster. A page whose
 * claim is "we publish the collapse rather than the flattering number" has to actually do it.
 */
const pay = (campaignId: string, missionIdHash: string, wallet: string, note: string, tx: string) => {
  const c = createSubmission({ campaignId, wallet, note, missionIdHash });
  if (!c.ok) throw new Error(c.error);
  casSubmissionStatus(c.submission.id, "pending", "settling");
  casSubmissionStatus(c.submission.id, "settling", "paid");
  updateSubmission(c.submission.id, { payoutTx: tx, decidedAt: Math.floor(Date.now() / 1000) });
  // the ledger is built from ANCHORED settlement events, not from submission rows — a payout that
  // never emitted one is not a payout the public pages will ever show
  recordEvent({ campaignId, submissionId: c.submission.id, kind: "autopay_settled", detail: `paid ${wallet}`, txHash: tx, amount: 1_100_000 });
};

describe("the public showcase counts people, not addresses", () => {
  it("shows one row per cluster and reports the collapsed count, while the money total stays whole", () => {
    const f = seedV2Campaign({ wallet: `0x${"5".repeat(40)}`, chainId: 2345 });
    const a = `0x${"a1".repeat(20)}`;
    const b = `0x${"b2".repeat(20)}`;
    pay(f.campaign.id, f.mission.missionIdHash, a, "I opened the product and followed the whole quickstart, noting each screen.", `0x${"e".repeat(64)}`);
    pay(f.campaign.id, f.mission.missionIdHash, b, "I went through the same flow on a second machine and wrote down what differed.", `0x${"f".repeat(64)}`);

    const before = marketplace().paidToDate;
    linkWallets(a, b);
    const after = marketplace().paidToDate;

    // the same money, fewer people — that is the whole point
    expect(after.usd).toBe(before.usd);
    expect(after.count).toBe(before.count);
    expect(after.people).toBeLessThan(before.people);

    const rows = marketplace().recentPayouts.map((p) => p.wallet.toLowerCase());
    const both = rows.filter((w) => w === a.toLowerCase() || w === b.toLowerCase());
    expect(both.length).toBeLessThanOrEqual(1);
  });
});
