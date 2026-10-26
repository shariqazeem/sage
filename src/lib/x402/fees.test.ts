import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { seedV2Campaign } from "@/lib/campaigns/campaign-v2.fixture";
import { db } from "@/lib/db";
import { fees } from "@/lib/db/schema";
import { chargeOperatorFee } from "./fees";

/**
 * THE OPERATOR FEE IS GOAT'S (26 Oct 2026). Its merchant, payer and USDC are on GOAT, so only a GOAT
 * job's payout owes one, and it is recorded once however often the settle path re-runs. A Metis
 * payout used to queue a fee the sweep then paid in GOAT USDC, on a network paused for new money.
 */
const feesFor = (submissionId: string) => db.select().from(fees).where(eq(fees.submissionId, submissionId)).all().length;

describe("the operator fee", () => {
  it("a GOAT job's payout owes one fee, recorded once", () => {
    const f = seedV2Campaign({ chainId: 2345, wallet: `0x${"7".repeat(40)}`, vaultAddress: `0x${"3".repeat(40)}` });
    const tx = `0x${"a1".repeat(32)}`;
    chargeOperatorFee(tx, { campaignId: f.campaign.id, submissionId: f.submission.id });
    chargeOperatorFee(tx, { campaignId: f.campaign.id, submissionId: f.submission.id });
    expect(feesFor(f.submission.id)).toBe(1);
  });

  it("a Metis job's payout queues nothing on GOAT", () => {
    const f = seedV2Campaign({ chainId: 1088, wallet: `0x${"8".repeat(40)}`, vaultAddress: `0x${"4".repeat(40)}` });
    chargeOperatorFee(`0x${"b2".repeat(32)}`, { campaignId: f.campaign.id, submissionId: f.submission.id });
    expect(feesFor(f.submission.id)).toBe(0);
  });
});
