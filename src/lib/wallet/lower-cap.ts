"use client";

import {
  createPublicClient,
  getAddress,
  http,
  parseUnits,
  type Address,
  type Hash,
  type WalletClient,
} from "viem";
import { metisSepolia } from "./config";
import { policyVaultAbi } from "./abis";

/**
 * The one owner-signed mutation the vault permits: lowering a cap. Mirrors the
 * vendor-add orchestration — owner wallet signs, legacy Metis gas — then re-reads
 * the cap from chain so the UI shows the contract's truth, not an optimistic
 * guess. Ceiling and duration are immutable; those have no setter to call.
 */
const publicClient = createPublicClient({ chain: metisSepolia, transport: http() });
const USDC_DECIMALS = 6;

async function legacyGas(): Promise<bigint> {
  return ((await publicClient.getGasPrice()) * BigInt(12)) / BigInt(10);
}

export type CapKind = "perTx" | "velocity";

export interface LowerCapResult {
  txHash: Hash;
  /** the new cap read back from chain (whole USDC). */
  newCap: number;
}

interface PolicyStruct {
  perTransactionCap: bigint;
  dailyVelocityCap: bigint;
}

export async function lowerCap(opts: {
  wallet: WalletClient;
  owner: Address;
  vault: Address;
  kind: CapKind;
  newCapUsd: number;
}): Promise<LowerCapResult> {
  const { wallet, owner, kind, newCapUsd } = opts;
  const vault = getAddress(opts.vault);
  const functionName =
    kind === "perTx" ? "lowerPerTransactionCap" : "lowerDailyVelocityCap";
  const newCapWei = parseUnits(String(newCapUsd), USDC_DECIMALS);

  const txHash = await wallet.writeContract({
    address: vault,
    abi: policyVaultAbi,
    functionName,
    args: [newCapWei],
    account: owner,
    chain: metisSepolia,
    gasPrice: await legacyGas(),
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  const policy = (await publicClient.readContract({
    address: vault,
    abi: policyVaultAbi,
    functionName: "getPolicy",
  })) as PolicyStruct;
  const raw =
    kind === "perTx" ? policy.perTransactionCap : policy.dailyVelocityCap;

  return { txHash, newCap: Number(raw) / 10 ** USDC_DECIMALS };
}
