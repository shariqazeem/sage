import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createWalletClient,
  http,
  parseEventLogs,
  type Address,
  type Hash,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { chainConfig, explorerTxUrl, viemChainFor, DEFAULT_CHAIN_ID } from "./networks";
import {
  getPendingVendorReadyAt,
  getVaultOwner,
  getVaultStatus,
  isVendorApproved,
  policyVaultAbi,
  publicClient,
  type VaultStatus,
} from "./chain";

/* ─────────────────────────────────────────── operator key (per chain) ──────
 * The operator key is the ONLY key the vault lets call `requestSpend`. It is
 * resolved PER CHAIN so one Deputy can settle on both networks:
 *   - Metis (59902 / 1088): OPERATOR_PRIVATE_KEY (else contracts/.env PRIVATE_KEY)
 *   - GOAT mainnet (2345):  GOAT_AGENT_PRIVATE_KEY — the SAME wallet that holds
 *     the ERC-8004 identity and pays x402. On GOAT the Deputy's registered
 *     identity IS the wallet that pays, so its on-chain history becomes the
 *     reputation record (see docs/AGENT.md §2).
 * Server-only; keys never reach the client.
 */

function readKey(names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  try {
    const text = readFileSync(join(process.cwd(), "contracts", ".env"), "utf8");
    const found: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);
      if (m) found[m[1]] = m[2];
    }
    for (const n of names) if (found[n]) return found[n];
  } catch {
    /* no contracts/.env — fall through */
  }
  return undefined;
}

function normalizeKey(raw: string): `0x${string}` {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

function loadOperatorKey(chainId: number): `0x${string}` {
  if (chainConfig(chainId).chainId === 2345) {
    const raw = readKey(["GOAT_AGENT_PRIVATE_KEY"]);
    if (!raw) {
      throw new Error("GOAT operator key not configured (set GOAT_AGENT_PRIVATE_KEY).");
    }
    return normalizeKey(raw);
  }
  const raw = readKey(["OPERATOR_PRIVATE_KEY", "PRIVATE_KEY"]);
  if (!raw) {
    throw new Error(
      "Operator key not configured (set OPERATOR_PRIVATE_KEY or contracts/.env PRIVATE_KEY).",
    );
  }
  return normalizeKey(raw);
}

const accounts = new Map<number, PrivateKeyAccount>();
function operatorAccount(chainId: number): PrivateKeyAccount {
  let a = accounts.get(chainId);
  if (!a) {
    a = privateKeyToAccount(loadOperatorKey(chainId));
    accounts.set(chainId, a);
  }
  return a;
}

/** The operator's on-chain address (the `requestSpend` caller) for a chain. */
export function operatorAddress(chainId: number = DEFAULT_CHAIN_ID): Address {
  return operatorAccount(chainId).address;
}

const wallets = new Map<number, WalletClient>();
function operatorWalletClient(chainId: number): WalletClient {
  let w = wallets.get(chainId);
  if (!w) {
    w = createWalletClient({
      account: operatorAccount(chainId),
      chain: viemChainFor(chainId),
      transport: http(chainConfig(chainId).rpcUrl),
    });
    wallets.set(chainId, w);
  }
  return w;
}

/* ────────────────────────────────────────────────── gas strategy ──────────
 * Metis settles at a fixed gas price (legacy, no EIP-1559) — a 20% bump avoids
 * "underpriced". GOAT is tried as EIP-1559 first; if the RPC rejects a 1559 tx
 * (some Bitcoin-L2 nodes do), we fall back to a legacy send. Which path was used
 * is logged, so a deploy/settle leaves a trail of how it actually went out.
 */
async function bumpedGasPrice(chainId: number): Promise<bigint> {
  return ((await publicClient(chainId).getGasPrice()) * BigInt(12)) / BigInt(10);
}

async function sendVaultWrite(
  chainId: number,
  req: { address: Address; functionName: string; args: readonly unknown[] },
): Promise<Hash> {
  const cfg = chainConfig(chainId);
  const wallet = operatorWalletClient(chainId);
  const account = operatorAccount(chainId);
  const chain = viemChainFor(chainId);
  const write = (gasPrice?: bigint) =>
    wallet.writeContract({
      address: req.address,
      abi: policyVaultAbi,
      functionName: req.functionName,
      args: req.args,
      account,
      chain,
      ...(gasPrice != null ? { gasPrice } : {}),
    });

  if (cfg.gas === "legacy") {
    return write(await bumpedGasPrice(chainId));
  }
  // eip1559-fallback (GOAT): attempt 1559, fall back to legacy, log the path.
  try {
    const hash = await write();
    console.log(`[signer] ${cfg.key}(${chainId}): ${req.functionName} → EIP-1559`);
    return hash;
  } catch (err) {
    const msg =
      err instanceof Error
        ? ((err as { shortMessage?: string }).shortMessage ?? err.message)
        : String(err);
    console.warn(`[signer] ${cfg.key}(${chainId}): EIP-1559 failed (${msg}); retrying legacy`);
    const hash = await write(await bumpedGasPrice(chainId));
    console.log(`[signer] ${cfg.key}(${chainId}): ${req.functionName} → legacy`);
    return hash;
  }
}

/* ──────────────────────────────────────────────── requestSpend write ──── */

export interface RequestSpendResult {
  txHash: Hash;
  settled: boolean;
  failedCheckIndex: number | null;
  explorerUrl: string;
}

/**
 * Sign and broadcast a real `requestSpend` on `chainId` (default: active chain),
 * await the receipt, and DECODE the vault's own event — the single source of
 * truth. The contract soft-rejects (never reverts) on a policy failure, so
 * success + a `SpendRejected` log is the expected "rejected" path. Throws only on
 * an unexpected revert or RPC failure.
 */
export async function submitRequestSpend(args: {
  vault: Address;
  vendor: Address;
  amount: bigint;
  intentHash: Hash;
  chainId?: number;
  /**
   * Fired with the tx hash the INSTANT it is broadcast, BEFORE the receipt is
   * awaited — the crash-critical hook. The durable settle path persists the hash
   * here so a crash during the wait is recoverable (resume by reading this tx,
   * never by re-sending). Awaited so the persist completes before we block.
   */
  onBroadcast?: (txHash: Hash) => void | Promise<void>;
}): Promise<RequestSpendResult> {
  const chainId = args.chainId ?? DEFAULT_CHAIN_ID;
  const txHash = await sendVaultWrite(chainId, {
    address: args.vault,
    functionName: "requestSpend",
    args: [args.vendor, args.amount, args.intentHash],
  });
  if (args.onBroadcast) await args.onBroadcast(txHash);
  return awaitSpendOutcome(txHash, chainId);
}

/**
 * Await a broadcast `requestSpend` tx and DECODE the vault's own event — the
 * single source of truth. Reused for both the fresh broadcast (above) and the
 * crash-recovery resume (reading a tx whose outcome was never persisted). The
 * contract soft-rejects (never reverts) on a policy failure, so success + a
 * `SpendRejected` log is the expected "rejected" path.
 */
export async function awaitSpendOutcome(
  txHash: Hash,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<RequestSpendResult> {
  const receipt = await publicClient(chainId).waitForTransactionReceipt({ hash: txHash });
  const explorerUrl = explorerTxUrl(chainId, txHash);

  if (receipt.status !== "success") {
    throw new Error(`requestSpend reverted (tx ${txHash}).`);
  }

  const events = parseEventLogs({
    abi: policyVaultAbi,
    logs: receipt.logs,
    eventName: ["SpendSettled", "SpendRejected"],
  });

  if (events.some((e) => e.eventName === "SpendSettled")) {
    return { txHash, settled: true, failedCheckIndex: null, explorerUrl };
  }
  const rejected = events.find((e) => e.eventName === "SpendRejected");
  if (rejected) {
    const eventArgs = rejected.args as { failedCheckIndex?: number | bigint };
    return {
      txHash,
      settled: false,
      failedCheckIndex: Number(eventArgs.failedCheckIndex ?? 0),
      explorerUrl,
    };
  }
  throw new Error(`No SpendSettled/SpendRejected event found in tx ${txHash}.`);
}

/* ───────────────────────────────────────────────────── revoke (G4) ────── */

export interface RevokeResult {
  txHash: Hash;
  explorerUrl: string;
  newStatus: VaultStatus;
  revokedEvent: boolean;
}

/**
 * Sign and broadcast a real, terminal `revoke()` (G4) on the given vault + chain,
 * await the receipt, and read the status back. The contract makes revoke
 * idempotent, so this never reverts on a double-kill. Callers MUST pass a
 * disposable vault — revoke is irreversible.
 */
export async function submitRevoke(
  vault: Address,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<RevokeResult> {
  const txHash = await sendVaultWrite(chainId, {
    address: vault,
    functionName: "revoke",
    args: [],
  });

  const receipt = await publicClient(chainId).waitForTransactionReceipt({ hash: txHash });
  const explorerUrl = explorerTxUrl(chainId, txHash);
  if (receipt.status !== "success") {
    throw new Error(`revoke reverted (tx ${txHash}).`);
  }

  const revoked = parseEventLogs({
    abi: policyVaultAbi,
    logs: receipt.logs,
    eventName: "Revoked",
  });
  return {
    txHash,
    explorerUrl,
    newStatus: await getVaultStatus(vault, chainId),
    revokedEvent: revoked.length > 0,
  };
}

/* ─────────────────────────────────────── vendor add (owner action) ──────
 * Adding a recipient is a governance action gated on the OWNER. On any
 * Sage-owned vault owner==operator==our key, so the server runs the full
 * queue→execute add. On a founder vault the owner is external; we report
 * `owner_must_add` and the review UI collects that signature client-side.
 */

export interface EnsureVendorResult {
  approved: boolean;
  added: boolean;
  reason:
    | "already_approved"
    | "added"
    | "owner_must_add"
    | "timelock_pending"
    | null;
  readyAt?: number;
  txHashes: Hash[];
}

/**
 * Ensure `vendor` is an approved recipient on `vault` (chain `chainId`), adding
 * it if we own the vault. Idempotent, and it resumes a half-queued add. With a
 * 0-second timelock (all our vaults) this is a queue+execute in one call.
 */
export async function ensureVendorApproved(
  vault: Address,
  vendor: Address,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<EnsureVendorResult> {
  if (await isVendorApproved(vault, vendor, chainId)) {
    return { approved: true, added: false, reason: "already_approved", txHashes: [] };
  }

  const owner = await getVaultOwner(vault, chainId);
  if (owner.toLowerCase() !== operatorAddress(chainId).toLowerCase()) {
    return { approved: false, added: false, reason: "owner_must_add", txHashes: [] };
  }

  const txHashes: Hash[] = [];

  // Queue the add (skip if a prior queue is still pending).
  let readyAt = await getPendingVendorReadyAt(vault, vendor, chainId);
  if (readyAt === 0) {
    const queueTx = await sendVaultWrite(chainId, {
      address: vault,
      functionName: "queueAddVendor",
      args: [vendor],
    });
    await publicClient(chainId).waitForTransactionReceipt({ hash: queueTx });
    txHashes.push(queueTx);
    readyAt = await getPendingVendorReadyAt(vault, vendor, chainId);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (readyAt > nowSec) {
    const waitSec = readyAt - nowSec;
    if (waitSec > 90) {
      return { approved: false, added: false, reason: "timelock_pending", readyAt, txHashes };
    }
    await new Promise((r) => setTimeout(r, (waitSec + 2) * 1000));
  }

  const executeTx = await sendVaultWrite(chainId, {
    address: vault,
    functionName: "executeAddVendor",
    args: [vendor],
  });
  await publicClient(chainId).waitForTransactionReceipt({ hash: executeTx });
  txHashes.push(executeTx);

  const approved = await isVendorApproved(vault, vendor, chainId);
  return { approved, added: approved, reason: approved ? "added" : null, txHashes };
}
