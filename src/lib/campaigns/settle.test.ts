import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign, Submission } from "@/lib/db/schema";

/**
 * chainId plumbing through the settle path (mocked signer): a campaign's
 * `chainId` must reach BOTH the allowlist add and the requestSpend, so a GOAT
 * (2345) campaign settles on GOAT and a Metis (59902) one on Metis.
 */

vi.mock("@/lib/deputy/signer", () => ({
  ensureVendorApproved: vi.fn(),
  submitRequestSpend: vi.fn(),
}));

import { settleSubmission } from "./settle";
import { ensureVendorApproved, submitRequestSpend } from "@/lib/deputy/signer";

const submission = {
  id: "s1",
  wallet: `0x${"a".repeat(40)}`,
} as unknown as Submission;

function campaignOn(chainId: number): Campaign {
  return {
    id: "c1",
    chainId,
    vaultAddress: `0x${"1".repeat(40)}`,
    rewardAmount: 500_000,
  } as unknown as Campaign;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureVendorApproved).mockResolvedValue({
    approved: true,
    added: false,
    reason: "already_approved",
    txHashes: [],
  });
  vi.mocked(submitRequestSpend).mockResolvedValue({
    txHash: "0xTX",
    settled: true,
    failedCheckIndex: null,
    explorerUrl: "https://explorer.goat.network/tx/0xTX",
  });
});

describe("settleSubmission — passes the campaign's chainId to the signer", () => {
  it("settles a GOAT (2345) campaign on chain 2345", async () => {
    const out = await settleSubmission({ campaign: campaignOn(2345), submission });
    expect(out.settled).toBe(true);
    expect(ensureVendorApproved).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      2345,
    );
    expect(submitRequestSpend).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 2345 }),
    );
  });

  it("settles a Metis Sepolia (59902) campaign on chain 59902", async () => {
    await settleSubmission({ campaign: campaignOn(59902), submission });
    expect(ensureVendorApproved).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      59902,
    );
    expect(submitRequestSpend).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 59902 }),
    );
  });
});
