import "server-only";

import { encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import type { AgentWallet } from "@/lib/db/schema";
import { GOAT_USDC } from "@/lib/deputy/networks";
import { launchChainConfig } from "@/lib/launch/deployment-service";
import { createStopCampaignPolicy, type MandateSpec } from "./mandate";
import { setWalletPolicies } from "./client";
import { executeViaPrivy, type PrivyExecResult } from "./executor";
import { publicClient } from "@/lib/deputy/chain";
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
  /** null when the vault was ALREADY revoked on-chain — nothing to send, nothing to fail. */
  revoke: PrivyExecResult | null;
  /** null when the vault held nothing — withdrawing zero is a revert waiting to happen. */
  withdraw: PrivyExecResult | null;
  /** true when the chain already had the campaign stopped and this call only finished the job. */
  alreadyRevoked: boolean;
  /** what withdrawRemaining actually had to move, in base units. */
  recoveredBase: bigint;
}

/** CampaignVault.getState() — index 4 is "revoked" (see VAULT_STATE in campaign-vault.ts). */
const STATE_REVOKED = 4;

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

  // STOP MUST BE IDEMPOTENT, because the chain and the catalogue can disagree. Measured live:
  // a vault sat revoked on-chain (getState 4) while its campaign read "live" in the DB, so revoke()
  // reverted with "Execution reverted for an unknown reason" and the WHOLE stop died — including the
  // withdraw that would have recovered any remaining funds, and the cataloguing that would have
  // fixed the very disagreement that caused the revert. A founder who taps stop twice, or whose
  // vault was revoked from the web card, hits exactly this. So read the chain first and do only
  // what is left to do: skip revoke when it is already done, skip withdraw when there is nothing to
  // move (withdrawing zero is its own revert).
  const chain = publicClient(wallet.chainId);
  const [state, balance] = await Promise.all([
    chain
      .readContract({
        address: vault,
        abi: [{ type: "function", name: "getState", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }] as const,
        functionName: "getState",
      })
      .then(Number)
      .catch(() => -1), // unreadable state → attempt the full sequence, exactly as before
    chain
      .readContract({ address: baseSpec.usdc, abi: erc20Abi, functionName: "balanceOf", args: [vault] })
      .catch(() => null),
  ]);
  const alreadyRevoked = state === STATE_REVOKED;
  const recoveredBase = typeof balance === "bigint" ? balance : BigInt(-1); // -1 = unknown, attempt withdraw

  // Nothing left to do on-chain at all: already revoked and provably empty. No policy swap needed.
  if (alreadyRevoked && recoveredBase === BigInt(0)) {
    return { revoke: null, withdraw: null, alreadyRevoked, recoveredBase: BigInt(0) };
  }

  // 1) scoped stop policy pinned to THIS vault; 2) attach it to the wallet.
  const stopPolicyId = await createStopCampaignPolicy(baseSpec, vault);
  await setWalletPolicies(wallet.privyWalletId, [stopPolicyId]);

  try {
    // 3) revoke() (terminal, skipped when the chain already has it), then withdrawRemaining()
    //    (balance → i_owner = this agent wallet, skipped when provably zero).
    const revoke = alreadyRevoked
      ? null
      : await executeViaPrivy(
          wallet.privyWalletId,
          owner,
          { to: vault, data: encodeFunctionData({ abi: REVOKE, functionName: "revoke" }), label: "revoke" },
          wallet.chainId,
        );
    const withdraw =
      recoveredBase === BigInt(0)
        ? null
        : await executeViaPrivy(
            wallet.privyWalletId,
            owner,
            { to: vault, data: encodeFunctionData({ abi: WITHDRAW_REMAINING, functionName: "withdrawRemaining" }), label: "withdrawRemaining" },
            wallet.chainId,
          );
    return { revoke, withdraw, alreadyRevoked, recoveredBase: recoveredBase < BigInt(0) ? BigInt(0) : recoveredBase };
  } finally {
    // 4) ALWAYS re-lock to the base mandate.
    await restoreBasePolicy(wallet.privyWalletId, wallet.policyId);
  }
}
