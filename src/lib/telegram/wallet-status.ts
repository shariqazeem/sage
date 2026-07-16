import "server-only";

import { erc20Abi, getAddress } from "viem";
import { getAgentWallet } from "@/lib/db/agent-wallets";
import { getDeputyOverview } from "@/lib/campaigns/overview";
import { publicClient } from "@/lib/deputy/chain";
import { chainConfig } from "@/lib/deputy/networks";
import { reward } from "@/lib/format";

/**
 * The deterministic (no-LLM) /status dashboard for a chat that owns an agent wallet: the wallet
 * address + LIVE on-chain USDC balance + per-campaign cap, its live campaigns (funded / paid /
 * remaining), and the last 3 payout proof links. Returns null when the chat has no agent wallet, so
 * the caller falls back to the usage hint — non-wallet /status behaves exactly as before.
 */

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://sagepays.xyz";
}

async function usdcBalanceBase(address: string, chainId: number): Promise<bigint> {
  try {
    const usdc = chainConfig(chainId).usdcAddress;
    if (!usdc) return BigInt(0);
    return (await publicClient(chainId).readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [getAddress(address)],
    })) as bigint;
  } catch {
    return BigInt(0);
  }
}

export async function buildWalletStatus(chatId: string): Promise<string | null> {
  const w = getAgentWallet(chatId);
  if (!w) return null;

  const balance = await usdcBalanceBase(w.privyWalletAddress, w.chainId);
  const overview = getDeputyOverview(w.privyWalletAddress);
  const live = overview.campaigns.filter((c) => c.status === "live");

  const lines: string[] = [
    "Your Sage agent wallet",
    `Address: ${w.privyWalletAddress}`,
    `Balance: ${reward(Number(balance), w.chainId)}  ·  Cap: ${reward(Number(w.perCampaignCapBase), w.chainId)} per campaign`,
    "",
  ];

  if (live.length === 0) {
    lines.push("No live campaigns yet. Send me a product URL and a budget to launch one.");
  } else {
    lines.push(`Live campaigns (${live.length}):`);
    for (const c of live) {
      const funded = c.rewardBase * c.maxRecipients;
      const spent = c.paid * c.rewardBase;
      const remaining = Math.max(0, funded - spent);
      lines.push(
        `• ${c.title} — funded ${reward(funded, c.chainId)}, paid ${reward(spent, c.chainId)}, remaining ${reward(remaining, c.chainId)}`,
      );
    }
  }

  const proofs = overview.settledPayouts.slice(0, 3);
  if (proofs.length > 0) {
    lines.push("", "Recent payout proofs:");
    for (const p of proofs) lines.push(`${appUrl()}/proof/${p.txHash}`);
  }

  return lines.join("\n");
}
