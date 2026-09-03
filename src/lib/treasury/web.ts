import "server-only";
import { getAddress } from "viem";
import { founderStorageKey } from "@/lib/auth/founder";
import { getAgentWallet } from "@/lib/db/agent-wallets";
import { onboardFounder } from "@/lib/privy/onboarding";
import type { AgentWallet } from "@/lib/db/schema";

/**
 * THE TREASURY — fund once, and the agent launches from it.
 *
 * The walletless Telegram path already mints a Privy server wallet per founder, bound to a mandate
 * policy that caps what the agent may spend per campaign, with the founder's own wallet as the
 * reclaim address. The web gets the same object under a `web:<founder>` key: the founder sends
 * USDC (and a little BTC for gas) to it once, approves plans, and the agent deploys, funds and
 * activates each campaign itself — no wallet popup per launch, no human in the money loop beyond
 * the deposit. The mandate, not a prompt, bounds every spend.
 */
export const webTreasuryKey = (founderAddress: string) => `web:${founderStorageKey(founderAddress)}`;

export function getWebTreasury(founderAddress: string): AgentWallet | null {
  return getAgentWallet(webTreasuryKey(founderAddress));
}

export async function createWebTreasury(founderAddress: string, perCampaignCapUsd: number): Promise<AgentWallet> {
  const existing = getWebTreasury(founderAddress);
  if (existing) return existing;
  const capBase = Math.round(Math.max(1, Math.min(10_000, perCampaignCapUsd)) * 1_000_000);
  await onboardFounder({ chatId: webTreasuryKey(founderAddress), founderAddress: getAddress(founderAddress), perCampaignCapBase: capBase });
  const created = getWebTreasury(founderAddress);
  if (!created) throw new Error("treasury was not saved");
  return created;
}
