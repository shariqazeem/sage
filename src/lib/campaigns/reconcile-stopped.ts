import "server-only";

import { getAddress } from "viem";
import { publicClient } from "@/lib/deputy/chain";
import { campaignVaultAbi } from "@/lib/deputy/campaign-vault";
import { setCampaignStatus } from "@/lib/db/campaigns";
import type { Campaign } from "@/lib/db/schema";

/**
 * The on-chain vault is the source of truth for whether a campaign is stopped. When a founder runs
 * "Stop & withdraw" (web) or `sage_stop_campaign` (Telegram), the vault is `revoke()`d on-chain; this
 * reconciles the DB `status` to "cancelled" so the campaign shows as stopped everywhere — even if the
 * catalogue POST didn't land, or it was stopped before status-tracking existed. Read-only against the
 * chain; only WRITES the DB when it observes a genuinely-revoked vault.
 */

const VAULT_STATE_REVOKED = 4; // ["created","funded","active","paused","revoked"]
const TERMINAL = new Set(["cancelled", "completed", "closed", "draft"]);

/** True if the vault's on-chain state is `revoked`; null on any read failure (never guesses). */
export async function isVaultRevoked(vault: string, chainId: number): Promise<boolean | null> {
  try {
    const st = await publicClient(chainId).readContract({
      address: getAddress(vault),
      abi: campaignVaultAbi,
      functionName: "getState",
    });
    return Number(st) === VAULT_STATE_REVOKED;
  } catch {
    return null;
  }
}

/** Reconcile one campaign's DB status against its vault. No-op for terminal/pre-launch rows or RPC failure. */
export async function reconcileStopped(campaign: Campaign): Promise<Campaign> {
  if (TERMINAL.has(campaign.status.toLowerCase()) || !campaign.vaultAddress) return campaign;
  const revoked = await isVaultRevoked(campaign.vaultAddress, campaign.chainId);
  if (revoked === true) {
    setCampaignStatus(campaign.id, "cancelled");
    return { ...campaign, status: "cancelled" };
  }
  return campaign;
}

/** Reconcile many campaigns in parallel (only the non-terminal ones actually hit the chain). */
export async function reconcileStoppedMany(campaigns: Campaign[]): Promise<void> {
  await Promise.all(campaigns.map((c) => reconcileStopped(c)));
}
