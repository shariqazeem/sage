import "server-only";

import { getCampaign, getMissionByHash, listPaidSubmissionsByWallet } from "@/lib/db/campaigns";

/**
 * THE VERIFIED WORK RECORD (move 3 of the pivot) — a wallet's portable, receipt-anchored history
 * of paid, verified work across every Sage campaign.
 *
 * This is the artifact "MSME credit" is missing: a small business or worker with no bank history
 * DOES have history here — every entry was verified before payment and settles to a public
 * on-chain receipt anyone can check. Composed 100% from existing rows (paid submissions ×
 * campaigns × missions); nothing is asserted that a /proof page can't back. PAID work only:
 * the record is the wallet-holder's asset — holds and refusals are the SYSTEM's integrity story
 * (told in aggregate on the page), never published per-person.
 */

export interface RecordEntry {
  /** unix seconds the payout was decided/settled. */
  at: number;
  campaignId: string;
  campaignTitle: string;
  kind: "testing" | "grant" | "gig";
  missionTitle: string | null;
  amountUsd: number;
  txHash: string;
  proofPath: string;
  chainId: number;
}

export interface WalletRecord {
  wallet: string;
  totalUsd: number;
  completions: number;
  distinctCampaigns: number;
  firstAt: number | null;
  lastAt: number | null;
  entries: RecordEntry[];
}

export function buildWalletRecord(walletRaw: string): WalletRecord | null {
  // lowercase FIRST so a pasted "0X…"-prefixed or checksummed address still resolves
  const wallet = walletRaw.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return null;
  const paid = listPaidSubmissionsByWallet(wallet);

  const entries: RecordEntry[] = [];
  for (const s of paid) {
    if (!s.payoutTx) continue; // paid without a tx would be an inconsistency — never show unanchored rows
    const campaign = getCampaign(s.campaignId);
    if (!campaign || campaign.sandbox) continue;
    const mission = s.missionIdHash ? getMissionByHash(campaign.id, s.missionIdHash) : null;
    const amountBase = mission?.rewardAmount ?? campaign.rewardAmount;
    entries.push({
      at: s.decidedAt ?? s.createdAt,
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      kind: campaign.kind ?? "testing",
      missionTitle: mission?.title ?? null,
      amountUsd: amountBase / 1_000_000,
      txHash: s.payoutTx,
      proofPath: `/proof/${s.payoutTx}`,
      chainId: campaign.chainId ?? 59902,
    });
  }

  const totalUsd = entries.reduce((sum, e) => sum + e.amountUsd, 0);
  const times = entries.map((e) => e.at).filter((t) => t > 0);
  return {
    wallet,
    totalUsd: Math.round(totalUsd * 100) / 100,
    completions: entries.length,
    distinctCampaigns: new Set(entries.map((e) => e.campaignId)).size,
    firstAt: times.length ? Math.min(...times) : null,
    lastAt: times.length ? Math.max(...times) : null,
    entries,
  };
}
