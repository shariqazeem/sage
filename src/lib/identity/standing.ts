import "server-only";
import { getCampaign, listPaidSubmissionsByWallet } from "@/lib/db/campaigns";
import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { founderStorageKey } from "@/lib/auth/founder";
import { tierOf, type TierEvidence, type TierVerdict } from "./tier";

/**
 * A wallet's standing, read from the ledger and the recorded chain links. Nothing here is a model's
 * opinion: payouts happened, campaigns are distinct rows, and a link was written by the consolidation
 * watch when a payout was forwarded between two submitters.
 */
export function standingOf(wallet: string): TierVerdict & { evidence: TierEvidence } {
  const paid = listPaidSubmissionsByWallet(wallet);
  const campaigns = new Set(paid.map((s) => s.campaignId));
  const payers = new Set<string>();
  for (const id of campaigns) {
    const c = getCampaign(id);
    if (c) payers.add(founderStorageKey(c.posterWallet));
  }
  const linked = linkedWalletsOf(wallet).filter((w) => w.toLowerCase() !== wallet.trim().toLowerCase());
  const evidence: TierEvidence = {
    paidCompletions: paid.length,
    distinctCampaigns: campaigns.size,
    distinctPayers: payers.size,
    linkedWallets: linked.length,
    personhood: null,
  };
  return { ...tierOf(evidence), evidence };
}

/**
 * Standing gates the better-paid work only when it is armed. Off by default: a tier gate over an
 * empty board is a closed door with nowhere to earn the key, so it is turned on once there is open
 * low-paid work to build standing on.
 */
export function identityTiersArmed(env: Record<string, string | undefined> = process.env): boolean {
  return env.IDENTITY_TIERS === "1";
}
