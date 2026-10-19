import "server-only";
import { getAddress, type Address } from "viem";
import { publicClient } from "@/lib/deputy/chain";
import { chainConfig, isMainnetChain, PRIMARY_NETWORKS } from "@/lib/deputy/networks";
import { findUsdcPayment, type PaymentCheck } from "@/lib/workspaces/plan-payment";

/**
 * WHERE A PLAN IS PAID, AND HOW SAGE KNOWS IT WAS.
 *
 * In USDC, on a primary network (Metis or GOAT), to Sage's billing address. The proof is the
 * transfer itself: Sage reads the receipt and looks for exactly that transfer, from a wallet that is
 * the founder's. No card, no processor, no invoice: the same money rail the product runs on, and a
 * plan bought on Metis is itself an Andromeda transaction.
 */

/** Sage's billing address: SAGE_BILLING_ADDRESS, else the operator's (one EVM address on every network). */
export function billingAddress(): Address | null {
  const raw =
    process.env.SAGE_BILLING_ADDRESS?.trim() ||
    process.env.GOAT_OPERATOR_ADDRESS?.trim() ||
    process.env.METIS_MAINNET_OPERATOR_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_OPERATOR_ADDRESS?.trim();
  try {
    return raw ? getAddress(raw) : null;
  } catch {
    return null;
  }
}

/** The networks a plan can be paid on: the primary EVM networks that carry real USDC. */
export function billingChains(): number[] {
  return PRIMARY_NETWORKS.filter((id) => {
    const c = chainConfig(id);
    return c.evm && isMainnetChain(id) && !!c.usdcAddress;
  });
}

export function isBillingChain(chainId: unknown): chainId is number {
  return typeof chainId === "number" && billingChains().includes(chainId);
}

/**
 * Read one transaction and find a USDC transfer of at least `minBase` to the billing address from any
 * of `payers`. A receipt that isn't there yet is retryable, not a refusal.
 */
export async function readPlanPayment(input: {
  chainId: number;
  txHash: `0x${string}`;
  payers: readonly string[];
  minBase: bigint;
}): Promise<PaymentCheck | { ok: false; reason: string; retryable: true }> {
  const to = billingAddress();
  const usdc = chainConfig(input.chainId).usdcAddress;
  if (!to || !usdc) return { ok: false, reason: "plan payments aren't configured on this network" };
  let receipt: Awaited<ReturnType<ReturnType<typeof publicClient>["getTransactionReceipt"]>>;
  try {
    receipt = await publicClient(input.chainId).getTransactionReceipt({ hash: input.txHash });
  } catch {
    return { ok: false, reason: "that transaction isn't readable yet; give it a few seconds", retryable: true };
  }
  if (receipt.status !== "success") return { ok: false, reason: "that transaction reverted, so no payment was made" };
  const logs = receipt.logs.filter((l) => l.topics.length > 0) as Parameters<typeof findUsdcPayment>[0];
  let last: PaymentCheck = { ok: false, reason: "no USDC transfer to Sage's billing address from your wallet in that transaction" };
  for (const from of input.payers) {
    let checksummed: string;
    try {
      checksummed = getAddress(from);
    } catch {
      continue;
    }
    const check = findUsdcPayment(logs, { usdc, to, from: checksummed, minBase: input.minBase });
    if (check.ok) return check;
    last = check;
  }
  return last;
}
