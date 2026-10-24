import "server-only";
import { getAddress, type Address, type Hash } from "viem";
import { publicClient } from "@/lib/deputy/chain";
import { chainConfig, explorerTxUrl } from "@/lib/deputy/networks";
import type { AgentWallet } from "@/lib/db/schema";
import { recordAccountMove } from "@/lib/db/account-moves";
import { launchChainConfig } from "@/lib/launch/deployment-service";
import { privyPost } from "@/lib/privy/client";
import { executeViaPrivy } from "@/lib/privy/executor";
import { AccountBusyError, accountBaseSpec, withScopedPolicy } from "@/lib/privy/scoped";
import { buildSendNativePolicy } from "@/lib/privy/swap-policy";
import { formatNative, NATIVE_SEND_GAS_UNITS, needsFeeMessage } from "./gas-policy";

/**
 * SEND THE GAS TOKEN OUT OF THE ACCOUNT (METIS on Metis): to an exchange deposit address, or any wallet.
 *
 * The base mandate allows no native transfer at all, so this is a scoped permit exactly like a USDC
 * withdrawal: this address, at most this amount, then the wallet is re-locked. The fee comes out of
 * the same balance, so the most that can leave is the balance less the fee, and a request for more is
 * refused in words with the amount that will go through.
 */
export type NativeSendResult =
  | { ok: true; txHash: Hash; amountWei: bigint; to: Address; explorerUrl: string }
  | { ok: false; code: "same" | "too_small" | "insufficient" | "busy" | "failed" | "not_here"; message: string };

/** The fee a native send is budgeted at, priced from the chain's gas price with a fifth of headroom. */
export function nativeSendFeeWei(gasPriceWei: bigint): bigint {
  return (NATIVE_SEND_GAS_UNITS * gasPriceWei * BigInt(12)) / BigInt(10);
}

/** Pure: may this much leave, given the balance and the fee. */
export function decideNativeSend(input: { chainId: number; from: Address; to: Address; amountWei: bigint; balanceWei: bigint; gasPriceWei: bigint }): { ok: true; feeWei: bigint } | Extract<NativeSendResult, { ok: false }> {
  const c = chainConfig(input.chainId);
  if (c.nativeSymbol === "USDC") return { ok: false, code: "not_here", message: `On ${c.name} USDC is the gas token; send it as USDC.` };
  if (input.from.toLowerCase() === input.to.toLowerCase()) return { ok: false, code: "same", message: "That is the account's own address." };
  if (input.amountWei <= BigInt(0)) return { ok: false, code: "too_small", message: `Give an amount of ${c.nativeSymbol} to send.` };
  const feeWei = nativeSendFeeWei(input.gasPriceWei);
  if (input.balanceWei < feeWei) {
    return { ok: false, code: "insufficient", message: needsFeeMessage({ chainId: input.chainId, action: "send", needWei: feeWei, haveWei: input.balanceWei, nativeSymbol: c.nativeSymbol, network: c.name }) };
  }
  if (input.amountWei + feeWei > input.balanceWei) {
    return { ok: false, code: "insufficient", message: `The account holds ${formatNative(input.balanceWei)} ${c.nativeSymbol}. After the network fee, the most that can leave is ${formatNative(input.balanceWei - feeWei)}.` };
  }
  return { ok: true, feeWei };
}

export async function sendNativeFromAccount(founder: string, wallet: AgentWallet, target: Address, amountWei: bigint): Promise<NativeSendResult> {
  const from = getAddress(wallet.privyWalletAddress);
  const to = getAddress(target);
  const client = publicClient(wallet.chainId);
  const [balanceWei, gasPriceWei] = await Promise.all([client.getBalance({ address: from }), client.getGasPrice()]);
  const d = decideNativeSend({ chainId: wallet.chainId, from, to, amountWei, balanceWei, gasPriceWei });
  if (!d.ok) return d;
  const spec = accountBaseSpec(wallet, launchChainConfig(wallet.chainId));
  try {
    const r = await withScopedPolicy(
      wallet,
      async () => (await privyPost<{ id: string }>("/policies", buildSendNativePolicy(spec, to, amountWei))).id,
      () => executeViaPrivy(wallet.privyWalletId, from, { to, data: "0x", value: amountWei, label: "send-native" }, wallet.chainId),
    );
    recordAccountMove({ founder, wallet: from, chainId: wallet.chainId, kind: "send", assetIn: "metis", amountIn: amountWei, counterparty: to, txHash: r.txHash });
    return { ok: true, txHash: r.txHash as Hash, amountWei, to, explorerUrl: explorerTxUrl(wallet.chainId, r.txHash) };
  } catch (e) {
    if (e instanceof AccountBusyError) return { ok: false, code: "busy", message: e.message };
    console.warn(`[send-native] failed for ${from}:`, e instanceof Error ? e.message : e);
    return { ok: false, code: "failed", message: "That didn't go through, and nothing left the account. Try again in a minute." };
  }
}
