import "server-only";

import {
  listCampaigns,
  listPosterEvents,
  listSubmissions,
} from "@/lib/db/campaigns";
import { toJournalEntries, type JournalEntry } from "./journal";
import { buildIntentHashMap, type IntentRef } from "./labels";

/** One campaign as the Agents tab shows it — all counts from real submissions. */
export interface CampaignCard {
  id: string;
  title: string;
  status: string;
  rewardBase: number;
  maxRecipients: number;
  submissions: number;
  pending: number;
  paid: number;
}

/** A settled payout for the Wallet tab — a real DB row (paid submission). */
export interface SettledPayout {
  campaignId: string;
  campaignTitle: string;
  wallet: string;
  amountBase: number;
  txHash: string;
  at: number;
  /** the chain this payout settled on (drives the network chip + explorer link). */
  chainId: number;
}

/** The Payout Deputy's real state for the signed-in founder. No fixtures. */
export interface DeputyOverview {
  hasCampaigns: boolean;
  campaigns: CampaignCard[];
  totalPending: number;
  totalPaid: number;
  /** total released in USDC base units (6dp). */
  paidAmountBase: number;
  /** distinct wallets paid across the founder's campaigns = recipients the vault
   * has allowlisted through campaigns (the real "approved recipients" count). */
  approvedRecipients: number;
  /** the founder's settled payouts (Wallet tab history), newest first. */
  settledPayouts: SettledPayout[];
  /** on-chain intent hash → campaign+recipient, to label the vault's event log. */
  intentLabels: Record<string, IntentRef>;
  journal: JournalEntry[];
}

const EMPTY: DeputyOverview = {
  hasCampaigns: false,
  campaigns: [],
  totalPending: 0,
  totalPaid: 0,
  paidAmountBase: 0,
  approvedRecipients: 0,
  settledPayouts: [],
  intentLabels: {},
  journal: [],
};

/**
 * Compose the founder's Deputy view from real rows: their campaigns, live
 * submission counts, released totals, and the work journal (real events). Returns
 * an empty overview when the visitor isn't a signed-in poster — the UI then shows
 * a designed empty state, never invented content.
 */
export function getDeputyOverview(wallet: string | null): DeputyOverview {
  if (!wallet) return EMPTY;
  const mine = listCampaigns().filter(
    (c) => c.posterWallet.toLowerCase() === wallet.toLowerCase(),
  );
  if (mine.length === 0) return EMPTY;

  let totalPending = 0;
  let totalPaid = 0;
  let paidAmountBase = 0;
  const recipients = new Set<string>();
  const settledPayouts: SettledPayout[] = [];
  const intentEntries: {
    campaignId: string;
    campaignTitle: string;
    submissionId: string;
    wallet: string;
  }[] = [];

  const campaigns: CampaignCard[] = mine.map((c) => {
    const subs = listSubmissions(c.id);
    let pending = 0;
    let paid = 0;
    for (const s of subs) {
      intentEntries.push({
        campaignId: c.id,
        campaignTitle: c.title,
        submissionId: s.id,
        wallet: s.wallet,
      });
      if (s.status === "pending") pending += 1;
      if (s.status === "paid") {
        paid += 1;
        recipients.add(s.wallet.toLowerCase());
        if (s.payoutTx) {
          settledPayouts.push({
            campaignId: c.id,
            campaignTitle: c.title,
            wallet: s.wallet,
            amountBase: c.rewardAmount,
            txHash: s.payoutTx,
            at: s.decidedAt ?? s.createdAt,
            chainId: c.chainId,
          });
        }
      }
    }
    totalPending += pending;
    totalPaid += paid;
    paidAmountBase += paid * c.rewardAmount;
    return {
      id: c.id,
      title: c.title,
      status: c.status,
      rewardBase: c.rewardAmount,
      maxRecipients: c.maxRecipients,
      submissions: subs.length,
      pending,
      paid,
    };
  });

  settledPayouts.sort((a, b) => b.at - a.at);

  return {
    hasCampaigns: true,
    campaigns,
    totalPending,
    totalPaid,
    paidAmountBase,
    approvedRecipients: recipients.size,
    settledPayouts,
    intentLabels: buildIntentHashMap(intentEntries),
    journal: toJournalEntries(listPosterEvents(wallet, 30)),
  };
}
