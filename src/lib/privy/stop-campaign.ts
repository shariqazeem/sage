import "server-only";

import { encodeFunctionData, getAddress, type Address } from "viem";
import type { AgentWallet } from "@/lib/db/schema";
import { GOAT_USDC } from "@/lib/deputy/networks";
import { launchChainConfig } from "@/lib/launch/deployment-service";
import { createStopCampaignPolicy, type MandateSpec } from "./mandate";
import { setWalletPolicies } from "./client";
import { executeViaPrivy, type PrivyExecResult } from "./executor";
import { restoreBasePolicy } from "./withdraw";

/**
 * Stop a walletless campaign and return its remaining USDC to the founder's agent wallet. The base
 * mandate permits neither revoke nor withdrawRemaining, so — exactly like a withdraw — we mint a
 * SCOPED policy (base mandate + revoke + withdrawRemaining pinned to THIS vault only), swap the wallet
 * onto it, send `revoke()` then `withdrawRemaining()`, then ALWAYS re-lock to the base mandate.
 * `withdrawRemaining()` returns the balance to the vault's owner (this agent wallet), so the funds land
 * back in the founder's own custody; sending them onward is the separate, chat-authorized withdraw.
 */

const REVOKE = [{ type: "function", name: "revoke", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const;
const WITHDRAW_REMAINING = [{ type: "function", name: "withdrawRemaining", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const;

export interface StopCampaignResult {
  revoke: PrivyExecResult;
  withdraw: PrivyExecResult;
}

export async function stopCampaignViaPrivy(wallet: AgentWallet, vaultAddress: Address): Promise<StopCampaignResult> {
  const cfg = launchChainConfig(wallet.chainId);
  if (!cfg.factory) throw new Error("GOAT campaign factory not configured");
  const vault = getAddress(vaultAddress);
  const owner = getAddress(wallet.privyWalletAddress);

  const baseSpec: MandateSpec = {
    name: `mandate:${wallet.chatId}`,
    factory: getAddress(cfg.factory),
    usdc: getAddress(cfg.token ?? GOAT_USDC),
    perCampaignCapBase: BigInt(wallet.perCampaignCapBase),
  };

  // 1) scoped stop policy pinned to THIS vault; 2) attach it to the wallet.
  const stopPolicyId = await createStopCampaignPolicy(baseSpec, vault);
  await setWalletPolicies(wallet.privyWalletId, [stopPolicyId]);

  try {
    // 3) revoke() (terminal), then withdrawRemaining() (balance → i_owner = this agent wallet).
    const revoke = await executeViaPrivy(
      wallet.privyWalletId,
      owner,
      { to: vault, data: encodeFunctionData({ abi: REVOKE, functionName: "revoke" }), label: "revoke" },
      wallet.chainId,
    );
    const withdraw = await executeViaPrivy(
      wallet.privyWalletId,
      owner,
      { to: vault, data: encodeFunctionData({ abi: WITHDRAW_REMAINING, functionName: "withdrawRemaining" }), label: "withdrawRemaining" },
      wallet.chainId,
    );
    return { revoke, withdraw };
  } finally {
    // 4) ALWAYS re-lock to the base mandate.
    await restoreBasePolicy(wallet.privyWalletId, wallet.policyId);
  }
}
