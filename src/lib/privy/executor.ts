import "server-only";

import type { Address, Hex } from "viem";
import { publicClient } from "@/lib/deputy/chain";
import { explorerTxUrl } from "@/lib/deputy/networks";
import { signGoatTransaction, type EvmTxRequest } from "./client";

/**
 * Execute on-chain calls with a founder's Privy wallet on GOAT (2345). This is the parallel of the
 * Deputy's `sendVaultWrite`, but the signer is Privy instead of a local key: build the tx (nonce +
 * gas from the live chain), have Privy SIGN it (its attached policy — the founder's mandate — gates
 * the spend before a signature is ever produced), broadcast the raw tx over Sage's GOAT RPC, and
 * await the receipt.
 *
 * Gas: GOAT is a Bitcoin L2 that enforces a MINIMUM priority fee (gas tip) of 130000 wei and rejects
 * the ~0 tip a plain legacy gasPrice produces (its base fee is single-digit wei). So we send EIP-1559
 * with an explicit tip comfortably above that floor. Calls run STRICTLY sequentially because the
 * deploy set (create → approve → fund → activate) is order-dependent: each is confirmed before the
 * next is built, so gas estimation sees the prior step's state.
 */

const GOAT = 2345;
const toHex = (n: bigint): `0x${string}` => `0x${n.toString(16)}` as `0x${string}`;

export interface PrivyCall {
  to: Address;
  data: Hex;
  value?: bigint;
  /** a stable label for logs / the durable state machine. */
  label?: string;
}

export interface PrivyExecResult {
  txHash: Hex;
  explorerUrl: string;
}

/** Build → Privy-sign → broadcast → await one call. Throws on revert or a refused signature. */
export async function executeViaPrivy(
  walletId: string,
  from: Address,
  call: PrivyCall,
  chainId: number = GOAT,
): Promise<PrivyExecResult> {
  const client = publicClient(chainId);
  const value = call.value ?? BigInt(0);
  const bump = (n: bigint): bigint => (n * BigInt(12)) / BigInt(10); // +20% headroom

  const [nonce, gasLimit, block] = await Promise.all([
    client.getTransactionCount({ address: from, blockTag: "pending" }),
    client.estimateGas({ account: from, to: call.to, data: call.data, value }),
    client.getBlock({ blockTag: "latest" }),
  ]);
  // GOAT rejects a tip below 130000 wei; floor it well above that (still a negligible cost), and let
  // maxFee cover a bumped base fee plus the tip so a base-fee wiggle between blocks can't underprice.
  const maxPriorityFeePerGas = BigInt(500_000); // wei — ~4× GOAT's 130000 minimum
  const baseFee = block.baseFeePerGas ?? (await client.getGasPrice());
  const maxFeePerGas = bump(baseFee) + maxPriorityFeePerGas;

  const tx: EvmTxRequest = {
    to: call.to,
    value: toHex(value),
    data: call.data,
    nonce: toHex(BigInt(nonce)),
    gas_limit: toHex(bump(gasLimit)),
    max_fee_per_gas: toHex(maxFeePerGas),
    max_priority_fee_per_gas: toHex(maxPriorityFeePerGas),
  };

  const signed = await signGoatTransaction(walletId, tx);
  const txHash = await client.sendRawTransaction({ serializedTransaction: signed });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`privy tx ${txHash} reverted (${call.label ?? "call"})`);
  }
  console.log(`[privy-exec] ${call.label ?? "call"} → ${txHash}`);
  return { txHash, explorerUrl: explorerTxUrl(chainId, txHash) };
}

/**
 * Run an ordered set of calls with one founder wallet, sequentially, stopping on the first failure.
 * This is how a whole campaign deploy (create → approve → fund → activate) goes out from the
 * agent's chat turn without the founder ever signing in a browser.
 */
export async function executeSequenceViaPrivy(
  walletId: string,
  from: Address,
  calls: PrivyCall[],
  chainId: number = GOAT,
): Promise<PrivyExecResult[]> {
  const out: PrivyExecResult[] = [];
  for (const call of calls) {
    out.push(await executeViaPrivy(walletId, from, call, chainId));
  }
  return out;
}
