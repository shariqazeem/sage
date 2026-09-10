import "server-only";
import { getAddress } from "viem";
import { founderStorageKey } from "@/lib/auth/founder";
import { getAgentWallet } from "@/lib/db/agent-wallets";
import { onboardFounder, treasuryChainId } from "@/lib/privy/onboarding";
import { LAUNCH_ENABLED_CHAINS } from "@/lib/launch/deployment-service";
import { chainConfig } from "@/lib/deputy/networks";
import type { AgentWallet } from "@/lib/db/schema";

/**
 * THE ACCOUNT ("web treasury" in code) — fund once, and the agent launches from it.
 *
 * The walletless Telegram path already mints a Privy server wallet per founder, bound to a mandate
 * policy that caps what the agent may spend per campaign, with the founder's own wallet as the
 * reclaim address. The web gets the same object under a `web:<founder>` key: the founder sends
 * USDC (and, where the chain needs it, a little gas) to it once, approves plans, and the agent
 * deploys, funds and activates each campaign itself — no wallet popup per launch, no human in the
 * money loop beyond the deposit. The mandate, not a prompt, bounds every spend.
 *
 * ONE ACCOUNT PER CHAIN. USDC on GOAT is not USDC on Arc, so an account is a wallet ON a chain.
 * The account on the product's default chain (`treasuryChainId()`, GOAT mainnet while Arc is on
 * testnet) is the one the standing mandate runs from and the one every unqualified call means. An
 * account on any other configured chain — Arc, today, behind an explicit choice — lives under
 * `web:<founder>@<chainId>` and is reached only by naming the chain.
 *
 * Legacy rows: the bare `web:<founder>` key was minted on whatever chain was the default that day,
 * so its own `chainId` column, not the key, says which chain it is the account for.
 */
export const webTreasuryKey = (founderAddress: string, chainId?: number | null): string =>
  chainId == null ? `web:${founderStorageKey(founderAddress)}` : `web:${founderStorageKey(founderAddress)}@${chainId}`;

/** The account on ONE chain, or null. The bare key is consulted first (it may be on this chain), then the chain-suffixed one. */
export function getWebTreasuryOn(founderAddress: string, chainId: number): AgentWallet | null {
  const bare = getAgentWallet(webTreasuryKey(founderAddress));
  if (bare && bare.chainId === chainId) return bare;
  return getAgentWallet(webTreasuryKey(founderAddress, chainId));
}

/** The account the mandate runs from: the one on the default chain. */
export function getWebTreasury(founderAddress: string): AgentWallet | null {
  return getWebTreasuryOn(founderAddress, treasuryChainId());
}

/**
 * Every account this founder holds, mainnet first, then testnets — the order the account page shows
 * them in and the set whose wallets count as the founder's when they post work.
 */
export function listWebTreasuries(founderAddress: string): AgentWallet[] {
  const seen = new Set<string>();
  const out: AgentWallet[] = [];
  for (const chainId of [...LAUNCH_ENABLED_CHAINS].sort((a, b) => Number(chainConfig(b).isMainnet) - Number(chainConfig(a).isMainnet))) {
    const t = getWebTreasuryOn(founderAddress, chainId);
    if (t && !seen.has(t.chatId)) {
      seen.add(t.chatId);
      out.push(t);
    }
  }
  return out;
}

/** The wallets that post work as this founder: their accounts' Privy wallets, on every chain. */
export function webTreasuryWallets(founderAddress: string): string[] {
  return listWebTreasuries(founderAddress).map((t) => t.privyWalletAddress);
}

/**
 * Open the account on a chain (idempotent per chain). Without a chain, the default chain. The bare
 * key is used for the default chain when it is free, so a founder's first account keeps the shape
 * every existing row has; anything else is chain-suffixed.
 */
export async function createWebTreasury(founderAddress: string, perCampaignCapUsd: number, chainId: number = treasuryChainId()): Promise<AgentWallet> {
  const existing = getWebTreasuryOn(founderAddress, chainId);
  if (existing) return existing;
  const capBase = Math.round(Math.max(1, Math.min(10_000, perCampaignCapUsd)) * 1_000_000);
  const bareFree = getAgentWallet(webTreasuryKey(founderAddress)) === null;
  const chatId = chainId === treasuryChainId() && bareFree ? webTreasuryKey(founderAddress) : webTreasuryKey(founderAddress, chainId);
  await onboardFounder({ chatId, founderAddress: getAddress(founderAddress), perCampaignCapBase: capBase, chainId });
  const created = getWebTreasuryOn(founderAddress, chainId);
  if (!created) throw new Error("the account was not saved");
  return created;
}
