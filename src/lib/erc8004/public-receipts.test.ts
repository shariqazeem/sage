import { describe, expect, it } from "vitest";
import { createCampaign, recordEvent } from "@/lib/db/campaigns";
import { getPublicReceipts, isMainnetRail } from "./reputation";

/**
 * THE FRONT DOOR'S FEED IS A FEED OF MAINNET SETTLEMENTS, NOT A WINDOW INTO WHATEVER HAPPENED
 * LAST. Measured 2026-09-11: thirteen Arc-testnet payouts in one morning were the newest thirteen
 * receipts; the landing took the newest twelve and only then dropped testnet rows, so it rendered
 * "Watching for work" over forty-one real mainnet payouts. The filter has to run before the cap.
 * Runs against vitest's in-memory SQLite.
 */
const ARC_TESTNET = 5042002;
const GOAT = 2345;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

describe("getPublicReceipts on a busy testnet day", () => {
  const goat = createCampaign({
    title: "Real work on GOAT",
    rewardAmount: 500_000,
    maxRecipients: 4,
    chainId: GOAT,
    vaultAddress: "0x0000000000000000000000000000000000000011",
    posterWallet: "0x0000000000000000000000000000000000000002",
    status: "live",
  });
  const arc = createCampaign({
    title: "Testing on Arc",
    rewardAmount: 500_000,
    maxRecipients: 20,
    chainId: ARC_TESTNET,
    vaultAddress: "0x0000000000000000000000000000000000000012",
    posterWallet: "0x0000000000000000000000000000000000000002",
    status: "live",
  });
  // One real payout a week ago, then thirteen testnet payouts this morning.
  recordEvent({ campaignId: goat.id, kind: "autopay_settled", amount: 500_000, txHash: hash(1), createdAt: 1_000_000 });
  for (let i = 0; i < 13; i++) {
    recordEvent({ campaignId: arc.id, kind: "autopay_settled", amount: 500_000, txHash: hash(100 + i), createdAt: 2_000_000 + i });
  }

  it("the mainnet feed still carries the real payout — filtered before the cap", () => {
    const feed = getPublicReceipts(12, { mainnetOnly: true });
    expect(feed.map((r) => r.chainId)).toEqual([GOAT]);
    expect(feed[0]?.txHash).toBe(hash(1));
  });

  it("even unfiltered, no testnet receipt reaches the feed — real money is filtered at the source (10 Oct 2026)", () => {
    // Before, the unfiltered newest-twelve were all testnet and the real payout fell off the end.
    const newestTwelve = getPublicReceipts(12);
    expect(newestTwelve.map((r) => r.chainId)).toEqual([GOAT]);
    expect(newestTwelve.every((r) => isMainnetRail(r.chainId))).toBe(true);
  });

  it("knows which rails settle real money", () => {
    expect(isMainnetRail(GOAT)).toBe(true);
    expect(isMainnetRail(ARC_TESTNET)).toBe(false);
    expect(isMainnetRail(null)).toBe(false);
  });
});
