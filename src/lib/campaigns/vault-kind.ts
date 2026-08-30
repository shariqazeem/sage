import type { Campaign } from "@/lib/db/schema";

/**
 * WHAT A VAULT KIND MEANS, IN ONE PLACE.
 *
 * `vaultKind === "campaign_v2"` was written throughout the product to mean two different things,
 * and only one of them is about EVM:
 *
 *   1. "this campaign carries a MISSION PLAN" — per-mission rewards and caps, an on-chain identity,
 *      a private corpus, the real tester board. True of the Cairo vault as well.
 *   2. "this is an EVM CampaignVault I can call through viem" — genuinely EVM-only.
 *
 * Adding a second rail turned every site that meant (1) into a silent exclusion: the tester board
 * fell back to the legacy card, the submit route took the pre-mission branch, the console redirected
 * to a legacy page, the agreement check refused at its first line. Each was found one at a time, by
 * a founder hitting it with real money in a vault.
 *
 * Naming the two ideas separately is what stops the next rail repeating that.
 */

/** Does this vault carry a mission plan — per-mission terms, on-chain identity, the real board? */
export function hasMissionPlan(vaultKind: string | null | undefined): boolean {
  return vaultKind === "campaign_v2" || vaultKind === "sage_vault_starknet";
}

/** Is this an EVM CampaignVault, reachable with viem and the V2 ABI? Never true for Starknet. */
export function isEvmCampaignVault(vaultKind: string | null | undefined): boolean {
  return vaultKind === "campaign_v2";
}

/** Convenience for the common `campaign.vaultKind` case. */
export const campaignHasMissionPlan = (c: Pick<Campaign, "vaultKind">): boolean =>
  hasMissionPlan(c.vaultKind);
