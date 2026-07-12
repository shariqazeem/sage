import "server-only";

/**
 * The server-only deployment-preview reader. It does the READ-ONLY chain calls the founder
 * preview needs — token balance, whether the predicted vault already has code, and the
 * current allowance — then hands them to the pure `assemblePreview`. No writes, no key,
 * no broadcast; this only tells the founder what they are about to sign. The signing
 * itself happens in the founder's wallet (the deferred client flow).
 */

import { erc20Abi, getAddress, type Address } from "viem";

import { publicClient } from "@/lib/deputy/chain";
import { buildDeployBundle, type DeploymentSettings } from "./deploy-plan";
import { assemblePreview, faucetPolicy, type DeploymentPreview, type FaucetPolicy } from "./preview-core";
import type { DeploymentReadyPlan } from "./approve";

/**
 * Read the live chain state for a deployment preview and assemble it. Pure derivation is
 * delegated to preview-core; this function only performs the three read-only RPC calls and
 * measures the predicted vault's code size.
 */
export async function readDeploymentPreview(
  plan: DeploymentReadyPlan,
  settings: DeploymentSettings,
): Promise<DeploymentPreview> {
  const bundle = buildDeployBundle(plan, settings);
  const client = publicClient(settings.chainId);
  const owner = getAddress(settings.owner);
  const token = getAddress(settings.token);

  const [balance, code, allowance] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }) as Promise<bigint>,
    client.getCode({ address: bundle.predictedVault }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, bundle.predictedVault] }) as Promise<bigint>,
  ]);

  return assemblePreview(
    bundle,
    {
      founderBalanceBase: balance,
      // getCode returns undefined/"0x" when there is no contract at the address.
      predictedVaultCodeSize: code && code !== "0x" ? (code.length - 2) / 2 : 0,
      currentAllowanceBase: allowance,
    },
    {
      tokenDecimals: plan.tokenDecimals,
      missionPlanDigest: plan.missionPlanDigest,
      missionTitles: plan.missions.map((m) => ({ title: m.title, maxCompletions: m.maxCompletions })),
    },
  );
}

/** The configured testnet MockUSDC address (env), or null if unset. */
export function configuredMockUsdc(): string | null {
  return process.env.NEXT_PUBLIC_USDC_ADDRESS ?? null;
}

/** Whether the testnet faucet may be offered for this chain + token (mainnet ⇒ never). */
export function previewFaucetPolicy(chainId: number, token: Address): FaucetPolicy {
  return faucetPolicy(chainId, token, configuredMockUsdc());
}
