import "server-only";
import { settledLedger, mainnetSettled, decidedOnMainnet } from "@/lib/campaigns/settled-ledger";
import { getCampaign } from "@/lib/db/campaigns";
import { chainConfig } from "@/lib/deputy/networks";

/**
 * THE PUBLIC SITE'S NUMBERS, FROM ONE PLACE. Every figure and every receipt a stranger sees on the
 * company pages is read from the same settled ledger the explorer and the receipts use, real money
 * only (a testnet payout never appears), at request time. Nothing here is a sample.
 */
export interface LiveReceipt {
  txHash: string;
  amountUsd: number;
  network: string;
  chainId: number;
  /** The job it paid for, as its founder titled it. */
  job: string | null;
  recipient: string | null;
  at: number;
}

export interface LiveProof {
  paidUsd: number;
  payouts: number;
  refused: number;
  receipts: LiveReceipt[];
}

export function liveProof(limit = 6): LiveProof {
  const rows = settledLedger().filter((r) => r.mainnet && !r.operator);
  const totals = mainnetSettled();
  const decided = decidedOnMainnet();
  const titles = new Map<string, string | null>();
  const title = (id: string) => {
    if (!titles.has(id)) titles.set(id, getCampaign(id)?.title ?? null);
    return titles.get(id) ?? null;
  };
  return {
    paidUsd: totals.usdcSettled,
    payouts: totals.payouts,
    refused: decided.refused,
    receipts: rows.slice(0, limit).map((r) => ({
      txHash: r.txHash,
      amountUsd: r.amountBase / 1e6,
      network: chainConfig(r.chainId).name,
      chainId: r.chainId,
      job: title(r.campaignId),
      recipient: r.wallet,
      at: r.at,
    })),
  };
}
