import "server-only";
import { starknetTxUrl } from "@/lib/starknet/explorer";

import { RpcProvider } from "starknet";

import { getCampaignByPayoutTx, getDecisionByPayoutTx } from "@/lib/db/campaigns";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { starknetAddresses } from "@/lib/starknet/config";

/**
 * THE RECEIPT FOR A STARKNET PAYOUT.
 *
 * Separate from the EVM proof composer, and not a variant of it, because the evidence is genuinely
 * different. An EVM payout is proved by a CampaignVault event: the vault derived the amount,
 * checked its own caps and emitted the settlement, so the receipt is a reading of that contract's
 * state. A Starknet payout has no vault. What it has is a token transfer that either happened or
 * did not, and Sage's own judgment record behind it.
 *
 * Pretending otherwise — filling the vault fields with plausible values so the existing page would
 * render — would make the receipt claim a guarantee that was never enforced. So this states what is
 * actually true, and says which parts rest on Sage rather than on a contract.
 *
 * The chain half is independently checkable by anyone: the transaction hash, its status, and the
 * amount that moved. The judgment half is Sage's record of why it paid.
 */

export interface StarknetProof {
  found: boolean;
  txHash: string;
  /** SUCCEEDED / REVERTED as the chain reports it, or null when the node could not be reached. */
  executionStatus: string | null;
  blockNumber: number | null;
  explorerUrl: string;
  recipient: string | null;
  amountUsd: number | null;
  campaignTitle: string | null;
  campaignId: string | null;
  /** Sage's own reason for paying — the half that rests on Sage, labelled as such. */
  decision: {
    recommendation: string;
    confidence: number;
    reasonCode: string | null;
    summary: string | null;
  } | null;
  paidAt: number | null;
}

const notFound = (txHash: string): StarknetProof => ({
  found: false,
  txHash,
  executionStatus: null,
  blockNumber: null,
  explorerUrl: starknetTxUrl(txHash) ?? "",
  recipient: null,
  amountUsd: null,
  campaignTitle: null,
  campaignId: null,
  decision: null,
  paidAt: null,
});

export async function composeStarknetProof(txHash: string): Promise<StarknetProof> {
  const tx = txHash.trim();
  const sub = db.select().from(submissions).where(eq(submissions.payoutTx, tx)).get();
  const campaign = getCampaignByPayoutTx(tx);
  if (!sub || !campaign) return notFound(tx);

  const decision = getDecisionByPayoutTx(tx);
  const cfg = starknetAddresses();

  // Read the chain rather than trust the row. A payout recorded here but reverted on chain is
  // exactly the failure this page exists to make visible, so the status is fetched, not assumed.
  let executionStatus: string | null = null;
  let blockNumber: number | null = null;
  if (cfg) {
    try {
      const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
      const receipt = (await provider.getTransactionReceipt(tx)) as {
        execution_status?: string;
        block_number?: number;
      };
      executionStatus = receipt.execution_status ?? null;
      blockNumber = receipt.block_number ?? null;
    } catch {
      // Unreachable node: the receipt still renders, and says the status is unknown rather than
      // claiming success. A page that shows "paid" while it cannot see the chain is worse than one
      // that admits it is looking.
      executionStatus = null;
    }
  }

  return {
    found: true,
    txHash: tx,
    executionStatus,
    blockNumber,
    explorerUrl: starknetTxUrl(tx) ?? "",
    recipient: sub.wallet,
    amountUsd: campaign.rewardAmount / 1_000_000,
    campaignTitle: campaign.title,
    campaignId: campaign.id,
    decision: decision?.brief
      ? {
          recommendation: decision.brief.recommendation,
          confidence: decision.brief.confidence,
          reasonCode: decision.brief.reasonCode ?? null,
          summary: decision.brief.summary ?? null,
        }
      : null,
    paidAt: sub.decidedAt ?? null,
  };
}

/** Whether this transaction belongs to a campaign settled on Starknet. */
export function isStarknetPayout(txHash: string): boolean {
  return getCampaignByPayoutTx(txHash.trim())?.settlementRail === "starknet";
}
