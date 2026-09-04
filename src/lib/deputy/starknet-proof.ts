import { denominated } from "@/lib/money/currency";
import { readClaim } from "@/lib/starknet/claims";
import { getMissionByHash } from "@/lib/db/campaigns";
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
  /** "J$5,000 → $31.57 @ 158.37" when the obligation was priced in the founder's currency; null = USD. */
  denominated: string | null;
  /**
   * THE PRIVATE LEG — what this rail is judged on, drawn from the row and the chain. The vault
   * released the reward in `txHash`; Sage escrowed it behind `poseidon(secret)` in `escrowTx`; the
   * commitment is the only public key to it; `onChain` says whether it has been collected.
   */
  claim: { escrowTx: string | null; commitment: string | null; claimed: boolean | null; expiry: number | null; amountUsd: number | null } | null;
}

const notFound = (txHash: string): StarknetProof => ({
  found: false,
  denominated: null,
  claim: null,
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

  const mission = sub.missionIdHash ? getMissionByHash(campaign.id, sub.missionIdHash) : null;
  /*
    THE PRIVATE LEG, read from the row and the chain. `claimEscrowTx` and `claimCommitment` were
    written at settlement and drawn nowhere — a receipt for a private payout that never showed the
    private part. `readClaim` answers whether the escrow has been collected; a node that cannot be
    reached leaves that unknown rather than claiming either way.
  */
  let claim: StarknetProof["claim"] = null;
  if (sub.claimEscrowTx || sub.claimCommitment) {
    let onChain: { claimed: boolean; expiry: number; amountBase: bigint } | null = null;
    if (cfg && sub.claimCommitment) {
      try {
        const c = await readClaim(sub.claimCommitment);
        onChain = c.exists ? { claimed: c.claimed, expiry: c.expiry, amountBase: c.amountBase } : null;
      } catch {
        onChain = null;
      }
    }
    claim = {
      escrowTx: sub.claimEscrowTx ?? null,
      commitment: sub.claimCommitment ?? null,
      claimed: onChain ? onChain.claimed : null,
      expiry: onChain ? onChain.expiry : null,
      amountUsd: onChain ? Number(onChain.amountBase) / 1_000_000 : null,
    };
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
    denominated: denominated(campaign, mission?.rewardLocal ?? null, campaign.rewardAmount / 1_000_000),
    claim,
  };
}

/** Whether this transaction belongs to a campaign settled on Starknet. */
export function isStarknetPayout(txHash: string): boolean {
  return getCampaignByPayoutTx(txHash.trim())?.settlementRail === "starknet";
}
