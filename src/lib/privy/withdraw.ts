import "server-only";

import { encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import type { AgentWallet } from "@/lib/db/schema";
import { GOAT_USDC } from "@/lib/deputy/networks";
import { launchChainConfig } from "@/lib/launch/deployment-service";
import { createWithdrawPolicy, type MandateSpec } from "./mandate";
import { setWalletPolicies } from "./client";
import { executeViaPrivy, type PrivyExecResult } from "./executor";

/**
 * Withdraw USDC from a walletless agent wallet to a chat-authorized address. The base mandate denies
 * ALL transfers, so a withdraw can't just be signed — it needs a permit. We mint a SCOPED policy
 * (base mandate + a single transfer-to-target ≤ amount), swap the wallet onto it, send exactly that
 * transfer, then ALWAYS re-lock to the base mandate. Recipient AND amount are pinned in the policy,
 * so the secure enclave itself guarantees the money can only ever reach the founder's chosen address.
 */

export async function restoreBasePolicy(walletId: string, basePolicyId: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    try {
      await setWalletPolicies(walletId, [basePolicyId]);
      return;
    } catch (e) {
      console.error(`[withdraw] re-lock attempt ${i + 1}/3 failed for ${walletId}:`, e);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  // The scoped policy pins recipient + amount to the founder's own address, so a failed re-lock is
  // low-risk — but surface it loudly so it can be re-locked out of band.
  console.error(`[withdraw] CRITICAL: could not re-lock wallet ${walletId} to base policy ${basePolicyId}`);
}

export async function withdrawViaPrivy(
  wallet: AgentWallet,
  target: Address,
  amountBase: bigint,
): Promise<PrivyExecResult> {
  const cfg = launchChainConfig(wallet.chainId);
  if (!cfg.factory) throw new Error("GOAT campaign factory not configured");
  const usdc = getAddress(cfg.token ?? GOAT_USDC);
  const to = getAddress(target);

  const baseSpec: MandateSpec = {
    name: `mandate:${wallet.chatId}`,
    factory: getAddress(cfg.factory),
    usdc,
    perCampaignCapBase: BigInt(wallet.perCampaignCapBase),
  };

  // 1) a scoped, single-target, amount-capped withdraw permit; 2) attach it to the wallet.
  const withdrawPolicyId = await createWithdrawPolicy(baseSpec, to, amountBase);
  await setWalletPolicies(wallet.privyWalletId, [withdrawPolicyId]);

  try {
    // 3) the ONLY newly-permitted tx: transfer(target, amount) on USDC.
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amountBase] });
    return await executeViaPrivy(
      wallet.privyWalletId,
      getAddress(wallet.privyWalletAddress),
      { to: usdc, data, label: "withdraw" },
      wallet.chainId,
    );
  } finally {
    // 4) ALWAYS re-lock to the base mandate.
    await restoreBasePolicy(wallet.privyWalletId, wallet.policyId);
  }
}
