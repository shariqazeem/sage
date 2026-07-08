"use client";

import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hash,
  type WalletClient,
} from "viem";
import { metisSepolia } from "./config";
import { policyVaultAbi } from "./abis";
import { allowlistItemState, type AllowlistItemState } from "./allowlist-state";

/**
 * Owner-signed allowlisting — the founder-vault half of settlement. The poster
 * on the review page IS the vault owner; the vault only pays PRE-APPROVED
 * recipients and additions are timelocked, both by design. This orchestrates
 * queue → (countdown) → execute with the owner's wallet. It never touches the
 * operator key (that stays server-side for requestSpend).
 */

const publicClient = createPublicClient({ chain: metisSepolia, transport: http() });

// Metis settles at a fixed gas price (no EIP-1559); a 20% bump forces a legacy
// tx and avoids "underpriced" — mirrors create-vault.ts exactly.
async function legacyGas(): Promise<bigint> {
  return ((await publicClient.getGasPrice()) * BigInt(12)) / BigInt(10);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function readBool(vault: Address, fn: string, addr: Address): Promise<boolean> {
  return publicClient.readContract({
    address: vault,
    abi: policyVaultAbi,
    functionName: fn,
    args: [addr],
  }) as Promise<boolean>;
}
function readNum(vault: Address, fn: string, args: readonly unknown[] = []): Promise<number> {
  return (
    publicClient.readContract({
      address: vault,
      abi: policyVaultAbi,
      functionName: fn,
      args,
    }) as Promise<bigint>
  ).then(Number);
}

function errMsg(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return e.shortMessage ?? e.message ?? String(err);
}

export type VendorPhase =
  | "checking"
  | "queuing"
  | "waiting"
  | "executing"
  | "approved"
  | "failed";

export interface VendorProgress {
  address: Address;
  phase: VendorPhase;
  readyAt?: number;
  error?: string;
}
export type OnVendorProgress = (p: VendorProgress) => void;

export interface VendorResult {
  address: Address;
  status: "approved" | "queued" | "failed";
  /** unix seconds the timelocked add matures (status === "queued"). */
  readyAt?: number;
  queueTx?: Hash;
  executeTx?: Hash;
  error?: string;
}

/** Read the current allowlist state per recipient — drives the countdown UI. */
export async function readAllowlistStates(
  vault: Address,
  recipients: Address[],
): Promise<Record<string, AllowlistItemState>> {
  const now = nowSec();
  const out: Record<string, AllowlistItemState> = {};
  await Promise.all(
    recipients.map(async (r) => {
      const addr = getAddress(r);
      const [approved, readyAt] = await Promise.all([
        readBool(vault, "isVendorApproved", addr),
        readNum(vault, "getPendingVendorReadyAt", [addr]),
      ]);
      out[addr.toLowerCase()] = allowlistItemState({
        approved,
        pendingReadyAt: readyAt,
        now,
      });
    }),
  );
  return out;
}

/**
 * Queue (and, when the timelock is 0, execute) each missing recipient. Approved
 * ones are skipped. Timelocked adds return `queued(readyAt)` for the UI to count
 * down; call {@link executeReady} once mature. Sequential so the wallet prompts
 * one at a time with clear progress.
 */
export async function allowlistRecipients(opts: {
  wallet: WalletClient;
  owner: Address;
  vault: Address;
  recipients: Address[];
  onProgress?: OnVendorProgress;
}): Promise<VendorResult[]> {
  const { wallet, owner, vault, recipients, onProgress } = opts;
  const timelock = await readNum(vault, "getVendorAddTimelock");
  const results: VendorResult[] = [];

  for (const r of recipients) {
    const addr = getAddress(r);
    try {
      onProgress?.({ address: addr, phase: "checking" });
      if (await readBool(vault, "isVendorApproved", addr)) {
        results.push({ address: addr, status: "approved" });
        onProgress?.({ address: addr, phase: "approved" });
        continue;
      }

      let readyAt = await readNum(vault, "getPendingVendorReadyAt", [addr]);
      let queueTx: Hash | undefined;
      if (readyAt === 0) {
        onProgress?.({ address: addr, phase: "queuing" });
        queueTx = await wallet.writeContract({
          address: vault,
          abi: policyVaultAbi,
          functionName: "queueAddVendor",
          args: [addr],
          account: owner,
          chain: metisSepolia,
          gasPrice: await legacyGas(),
        });
        await publicClient.waitForTransactionReceipt({ hash: queueTx });
        readyAt = await readNum(vault, "getPendingVendorReadyAt", [addr]);
      }

      if (timelock > 0 && readyAt > nowSec()) {
        results.push({ address: addr, status: "queued", readyAt, queueTx });
        onProgress?.({ address: addr, phase: "waiting", readyAt });
        continue;
      }

      onProgress?.({ address: addr, phase: "executing" });
      const executeTx = await wallet.writeContract({
        address: vault,
        abi: policyVaultAbi,
        functionName: "executeAddVendor",
        args: [addr],
        account: owner,
        chain: metisSepolia,
        gasPrice: await legacyGas(),
      });
      await publicClient.waitForTransactionReceipt({ hash: executeTx });
      results.push({ address: addr, status: "approved", queueTx, executeTx });
      onProgress?.({ address: addr, phase: "approved" });
    } catch (err) {
      results.push({ address: addr, status: "failed", error: errMsg(err) });
      onProgress?.({ address: addr, phase: "failed", error: errMsg(err) });
    }
  }
  return results;
}

/** Execute every matured (ready) pending add. Called after the timelock countdown. */
export async function executeReady(opts: {
  wallet: WalletClient;
  owner: Address;
  vault: Address;
  recipients: Address[];
  onProgress?: OnVendorProgress;
}): Promise<VendorResult[]> {
  const { wallet, owner, vault, recipients, onProgress } = opts;
  const results: VendorResult[] = [];
  for (const r of recipients) {
    const addr = getAddress(r);
    try {
      if (await readBool(vault, "isVendorApproved", addr)) {
        results.push({ address: addr, status: "approved" });
        onProgress?.({ address: addr, phase: "approved" });
        continue;
      }
      const readyAt = await readNum(vault, "getPendingVendorReadyAt", [addr]);
      if (readyAt === 0 || readyAt > nowSec()) {
        results.push({ address: addr, status: "queued", readyAt });
        onProgress?.({ address: addr, phase: "waiting", readyAt });
        continue;
      }
      onProgress?.({ address: addr, phase: "executing" });
      const executeTx = await wallet.writeContract({
        address: vault,
        abi: policyVaultAbi,
        functionName: "executeAddVendor",
        args: [addr],
        account: owner,
        chain: metisSepolia,
        gasPrice: await legacyGas(),
      });
      await publicClient.waitForTransactionReceipt({ hash: executeTx });
      results.push({ address: addr, status: "approved", executeTx });
      onProgress?.({ address: addr, phase: "approved" });
    } catch (err) {
      results.push({ address: addr, status: "failed", error: errMsg(err) });
      onProgress?.({ address: addr, phase: "failed", error: errMsg(err) });
    }
  }
  return results;
}
