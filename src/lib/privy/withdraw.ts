import "server-only";

import { encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import type { AgentWallet } from "@/lib/db/schema";
import { launchChainConfig } from "@/lib/launch/deployment-service";
import { createWithdrawPolicy } from "./mandate";
import { executeViaPrivy, type PrivyExecResult } from "./executor";
import { accountBaseSpec, withScopedPolicy } from "./scoped";

export { restoreBasePolicy } from "./scoped";

/**
 * Withdraw USDC from an account to an address its owner chose. The base mandate denies ALL transfers,
 * so a withdraw can't just be signed — it needs a permit. We mint a SCOPED policy (base mandate + a
 * single transfer-to-target ≤ amount), swap the wallet onto it, send exactly that transfer, then
 * ALWAYS re-lock to the base mandate (scoped.ts, which also keeps a second permit from racing this
 * one). Recipient AND amount are pinned in the policy, so the secure enclave itself guarantees the
 * money can only ever reach the chosen address.
 */
export async function withdrawViaPrivy(wallet: AgentWallet, target: Address, amountBase: bigint): Promise<PrivyExecResult> {
  const spec = accountBaseSpec(wallet, launchChainConfig(wallet.chainId));
  const to = getAddress(target);
  return withScopedPolicy(
    wallet,
    () => createWithdrawPolicy(spec, to, amountBase),
    () =>
      // the ONLY newly-permitted tx: transfer(target, amount) on USDC.
      executeViaPrivy(
        wallet.privyWalletId,
        getAddress(wallet.privyWalletAddress),
        { to: spec.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amountBase] }), label: "withdraw" },
        wallet.chainId,
      ),
  );
}
