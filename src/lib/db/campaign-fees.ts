import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import { campaignFees, type CampaignFee } from "./schema";
import { nowSeconds } from "./keys";

/**
 * THE CAMPAIGN LAUNCH FEE, stored.
 *
 * Every rule here is carried over from the operator-fee repair rather than relearned the same way:
 *
 *   · a fee's dappOrderId must differ per attempt, or the facilitator rejects the retry with
 *     "order already exists" and the fee is stranded forever once its first order expires;
 *   · money that has moved must be recorded BEFORE anything downstream can fail, or a confirmation
 *     timeout discards the txHash of a completed transfer and the fee is charged twice;
 *   · a failure must leave a readable trace, or the path fails in silence for a month.
 */

/** Idempotent per campaign — the launch path is retryable and a founder can double-submit. */
export function recordCampaignFee(input: {
  campaignId: string;
  inspectionId?: string | null;
  budgetBase: number;
  amountBase: number;
  payerAddress?: string | null;
  selfFunded: boolean;
}): CampaignFee | null {
  const existing = getCampaignFee(input.campaignId);
  if (existing) return existing;
  const id = nanoid(12);
  try {
    db.insert(campaignFees)
      .values({
        id,
        campaignId: input.campaignId,
        inspectionId: input.inspectionId ?? null,
        budgetBase: input.budgetBase,
        amountBase: input.amountBase,
        payerAddress: input.payerAddress ?? null,
        selfFunded: input.selfFunded,
        status: "pending",
        createdAt: nowSeconds(),
      })
      .run();
  } catch (err) {
    // A racing insert lost the unique index — that is the index doing its job, not an error.
    const msg = String(err instanceof Error ? err.message : err);
    if (!msg.includes("UNIQUE") && !msg.includes("campaign_fees_campaign_unq")) throw err;
  }
  return getCampaignFee(input.campaignId);
}

export function getCampaignFee(campaignId: string): CampaignFee | null {
  return db.select().from(campaignFees).where(eq(campaignFees.campaignId, campaignId)).get() ?? null;
}

export function listPendingCampaignFees(): CampaignFee[] {
  return db.select().from(campaignFees).where(eq(campaignFees.status, "pending")).all();
}

/**
 * The USDC has left the payer's wallet. Record it NOW, before confirmation is attempted.
 * `payPendingFees` refuses to transfer any row that already holds a payment_tx, so this is what
 * makes a double-charge impossible when the facilitator is slow to confirm.
 */
export function recordCampaignFeePaid(id: string, paymentTx: string, orderId: string): void {
  db.update(campaignFees)
    .set({ paymentTx, orderId, lastError: null })
    .where(eq(campaignFees.id, id))
    .run();
}

export function markCampaignFeeSettled(id: string, paymentTx: string, orderId: string): void {
  db.update(campaignFees)
    .set({ status: "settled", paymentTx, orderId, lastError: null })
    .where(eq(campaignFees.id, id))
    .run();
}

/** A fee we chose not to charge, recorded rather than deleted so the campaign's history stays whole. */
export function markCampaignFeeWaived(id: string, reason: string): void {
  db.update(campaignFees)
    .set({ status: "waived", lastError: reason.slice(0, 300) })
    .where(eq(campaignFees.id, id))
    .run();
}

/** Claim the next attempt number — it goes into the dappOrderId, which must be unique per try. */
export function nextCampaignFeeAttempt(id: string): number {
  const row = db.select({ attempts: campaignFees.attempts }).from(campaignFees).where(eq(campaignFees.id, id)).get();
  const next = (row?.attempts ?? 0) + 1;
  db.update(campaignFees).set({ attempts: next }).where(eq(campaignFees.id, id)).run();
  return next;
}

/** Overwritten in place: always current, never spam, and never silence. */
export function recordCampaignFeeFailure(id: string, error: string): void {
  db.update(campaignFees)
    .set({ lastError: error.slice(0, 300) })
    .where(eq(campaignFees.id, id))
    .run();
}

/**
 * Revenue, split honestly.
 *
 * `thirdPartyBase` is the only figure that belongs in a claim to GOAT, a grant, or an investor.
 * `selfFundedBase` is the operator paying their own merchant address — real money movement, real
 * on-chain receipts, and not income by any definition worth defending.
 */
export function campaignFeeTotals(): {
  thirdPartyBase: number;
  thirdPartyCount: number;
  selfFundedBase: number;
  selfFundedCount: number;
  pendingCount: number;
} {
  const all = db.select().from(campaignFees).all();
  let thirdPartyBase = 0;
  let thirdPartyCount = 0;
  let selfFundedBase = 0;
  let selfFundedCount = 0;
  let pendingCount = 0;
  for (const f of all) {
    if (f.status === "pending") pendingCount += 1;
    if (f.status !== "settled") continue;
    if (f.selfFunded) {
      selfFundedBase += f.amountBase;
      selfFundedCount += 1;
    } else {
      thirdPartyBase += f.amountBase;
      thirdPartyCount += 1;
    }
  }
  return { thirdPartyBase, thirdPartyCount, selfFundedBase, selfFundedCount, pendingCount };
}
