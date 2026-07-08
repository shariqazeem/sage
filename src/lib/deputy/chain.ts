import "server-only";

import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseEventLogs,
  toBytes,
  type Abi,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
} from "viem";
import {
  chainConfig,
  explorerAddressUrl as chainExplorerAddressUrl,
  explorerTxUrl as chainExplorerTxUrl,
  viemChainFor,
} from "./networks";

// ABI is sourced from the Foundry build artifact in `contracts/out`. The
// artifact also carries bytecode + metadata; we only consume `.abi`. A
// JSON-imported ABI is structurally a viem `Abi` but TypeScript widens it to a
// loose literal, so we normalize the type once here (no `any`, no ts-ignore).
// NOTE: requires `forge build` to have produced the artifact (out/ is gitignored).
import policyVaultArtifact from "../../../contracts/out/PolicyVault.sol/PolicyVault.json";

export const policyVaultAbi = policyVaultArtifact.abi as unknown as Abi;

/* ──────────────────────────────────────────────────────── networks ──────
 * The chain registry (src/lib/deputy/networks.ts) is the source of truth; this
 * module reads/writes on ANY chain in it by chainId. `activeNetwork()` remains
 * the DEFAULT-chain selector (DEPUTY_NETWORK, defaults to Metis Sepolia 59902)
 * for the single-network legacy paths; new multi-chain paths pass an explicit
 * chainId. Both resolve their real config through the registry.
 */

export type DeputyNetworkKey = "metis-sepolia" | "metis-andromeda";

export interface DeputyNetwork {
  key: DeputyNetworkKey;
  chainId: number;
  name: string;
  rpcUrl: string;
  usdcAddress: Address | null;
  blockExplorerUrl: string;
  isMainnet: boolean;
}

const DEFAULT_NETWORK: DeputyNetworkKey = "metis-sepolia";

function isNetworkKey(v: string | undefined): v is DeputyNetworkKey {
  return v === "metis-sepolia" || v === "metis-andromeda";
}

/** The active DEFAULT network, selected by DEPUTY_NETWORK (defaults to Sepolia). */
export function activeNetwork(): DeputyNetwork {
  const key = isNetworkKey(process.env.DEPUTY_NETWORK)
    ? process.env.DEPUTY_NETWORK
    : DEFAULT_NETWORK;
  const chainId = key === "metis-andromeda" ? 1088 : 59902;
  const cfg = chainConfig(chainId);
  return {
    key,
    chainId: cfg.chainId,
    name: cfg.name,
    rpcUrl: cfg.rpcUrl,
    usdcAddress: cfg.usdcAddress,
    blockExplorerUrl: cfg.explorerUrl,
    isMainnet: cfg.isMainnet,
  };
}

/** The chainId used when a read/write doesn't specify one (the default chain). */
function defaultChainId(): number {
  return activeNetwork().chainId;
}

/* ─────────────────────────────────────────── reserved write config ──────
 * §9 G2 (pause / upgrade) and G6 (relayer / gasless operator writes) attach
 * here when the write phase lands. Declared now so the config shape is stable;
 * read paths never touch it. Intentionally NOT implemented this phase.
 */
export interface DeputyWriteConfig {
  relayerUrl?: string;
  guardianAddress?: Address;
}

export const writeConfig: DeputyWriteConfig = {
  relayerUrl: process.env.DEPUTY_RELAYER_URL,
  guardianAddress: process.env.DEPUTY_GUARDIAN_ADDRESS as Address | undefined,
};

/* ─────────────────────────────────────────────────── viem clients ────── */

// One memoized read client PER chain, so a Metis read and a GOAT read never
// share a transport. Keyed by chainId.
const clients = new Map<number, PublicClient>();

/** Read-only viem client for a chain (memoized). Defaults to the active chain. */
export function publicClient(chainId?: number): PublicClient {
  const id = chainId ?? defaultChainId();
  let client = clients.get(id);
  if (!client) {
    client = createPublicClient({
      chain: viemChainFor(id),
      transport: http(chainConfig(id).rpcUrl),
    });
    clients.set(id, client);
  }
  return client;
}

/** The active (default) network as a viem Chain — shared by read + write clients. */
export function activeViemChain(): Chain {
  return viemChainFor(defaultChainId());
}

/* ───────────────────────────────────────────────── vault reads ──────── */

/** On-chain vault lifecycle. Mirrors `IPolicyVault.VaultState` (enum order). */
export type VaultStatus = "created" | "funded" | "active" | "paused" | "revoked";

const VAULT_STATE: readonly VaultStatus[] = [
  "created", // 0
  "funded", // 1
  "active", // 2
  "paused", // 3
  "revoked", // 4
];

/** The four truth fields (plus owner + provenance) read live from the vault. */
export interface VaultStateView {
  address: Address;
  budget: number;
  spent: number;
  remaining: number;
  perTxCap: number;
  velocityCap: number;
  status: VaultStatus;
  owner: Address;
  raw: { budget: string; spent: string; remaining: string; decimals: number };
  /** the chain this vault lives on. */
  chainId: number;
  /** the network's stable key (e.g. "metis-sepolia" | "goat"). */
  network: string;
  explorerUrl: string;
}

const erc20DecimalsAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

interface PolicyView {
  budgetCeiling: bigint;
  perTransactionCap: bigint;
  dailyVelocityCap: bigint;
  duration: bigint;
  paymentToken: Address;
}

/** Typed `readContract` for the PolicyVault on a given chain (loose ABI → T). */
function readVault<T>(
  address: Address,
  functionName: string,
  chainId?: number,
): Promise<T> {
  return publicClient(chainId).readContract({
    address,
    abi: policyVaultAbi,
    functionName,
  }) as Promise<T>;
}

/**
 * Read the live, on-chain truth for a vault on `chainId` (default: active chain):
 * budget / spent / remaining / status / owner. Every value is a contract view —
 * independently reproducible on the explorer. Throws on error; use
 * {@link getOperatorVaultState} for the resilient, page-facing path.
 */
export async function getVaultState(
  address: Address,
  chainId?: number,
): Promise<VaultStateView> {
  const cfg = chainConfig(chainId ?? defaultChainId());
  const vault = getAddress(address);

  const [stateRaw, stats, owner, policy] = await Promise.all([
    readVault<number>(vault, "getState", cfg.chainId),
    readVault<readonly [bigint, bigint, bigint]>(vault, "getSpendStats", cfg.chainId),
    readVault<Address>(vault, "getOwner", cfg.chainId),
    readVault<PolicyView>(vault, "getPolicy", cfg.chainId),
  ]);

  const decimals = Number(
    await publicClient(cfg.chainId).readContract({
      address: policy.paymentToken,
      abi: erc20DecimalsAbi,
      functionName: "decimals",
    }),
  );

  const [totalSpent, budgetRemaining] = stats;
  const budget = policy.budgetCeiling;
  const toNum = (v: bigint) => Number(formatUnits(v, decimals));

  return {
    address: vault,
    budget: toNum(budget),
    spent: toNum(totalSpent),
    remaining: toNum(budgetRemaining),
    perTxCap: toNum(policy.perTransactionCap),
    velocityCap: toNum(policy.dailyVelocityCap),
    status: VAULT_STATE[stateRaw] ?? "created",
    owner,
    raw: {
      budget: budget.toString(),
      spent: totalSpent.toString(),
      remaining: budgetRemaining.toString(),
      decimals,
    },
    chainId: cfg.chainId,
    network: cfg.key,
    explorerUrl: chainExplorerAddressUrl(cfg.chainId, vault),
  };
}

/** Lightweight: just a vault's current lifecycle status (one `getState` read). */
export async function getVaultStatus(
  address: Address,
  chainId?: number,
): Promise<VaultStatus> {
  const code = await readVault<number>(getAddress(address), "getState", chainId);
  return VAULT_STATE[code] ?? "created";
}

/** A block-explorer link for any address on the given chain (default: active). */
export function explorerAddressUrl(address: Address, chainId?: number): string {
  return chainExplorerAddressUrl(chainId ?? defaultChainId(), getAddress(address));
}

/* ─────────────────────────────────────── operator → vault mapping ────── */

/** Resolve a demo operator id to its on-chain vault address (env-driven). */
export function vaultAddressForOperator(operatorId: string): Address | null {
  const byOperator: Record<string, string | undefined> = {
    "launch-growth": process.env.NEXT_PUBLIC_VAULT_ADDRESS,
  };
  const raw = byOperator[operatorId];
  if (!raw) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

/**
 * The DISPOSABLE "kill-demo" vault — a stand-in the kill switch revokes for real
 * (revoke is terminal, so the primary vault is never touched). Returns null if
 * unconfigured. Deliberately a SEPARATE address from the primary vault.
 */
export function killVaultAddress(): Address | null {
  const raw = process.env.NEXT_PUBLIC_KILL_VAULT_ADDRESS;
  if (!raw) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

/**
 * Page-facing read: map an operator to its vault and return live state, or
 * `null` when no vault is configured or the read fails. Never throws — the UI
 * falls back to its narrative model when this is `null`. (Demo vault → active chain.)
 */
export async function getOperatorVaultState(
  operatorId: string,
): Promise<VaultStateView | null> {
  const address = vaultAddressForOperator(operatorId);
  if (!address) return null;
  try {
    return await getVaultState(address);
  } catch (err) {
    console.error(`[deputy/chain] vault read failed for ${operatorId}:`, err);
    return null;
  }
}

/* ──────────────────────────────────────────── vendor allowlist ──────────
 * The demo vault's vendors are derived from names in CreateVault.s.sol as
 * `address(uint160(uint256(keccak256(bytes(name)))))`. Vendor *names* aren't
 * on-chain, so we check each known name against the vault's `isVendorApproved`
 * view.
 */
const DEMO_VENDOR_NAMES = [
  "Clearbit",
  "Hunter",
  "Apollo",
  "Perplexity",
  "Exa",
] as const;

function vendorAddressFromName(name: string): Address {
  return getAddress(`0x${keccak256(toBytes(name)).slice(-40)}`);
}

/** The demo vendor names currently approved on this vault (on-chain checked). */
export async function getApprovedVendorNames(
  address: Address,
  chainId?: number,
): Promise<string[]> {
  const vault = getAddress(address);
  const client = publicClient(chainId);
  const checked = await Promise.all(
    DEMO_VENDOR_NAMES.map((name) =>
      client
        .readContract({
          address: vault,
          abi: policyVaultAbi,
          functionName: "isVendorApproved",
          args: [vendorAddressFromName(name)],
        })
        .then((approved): string | null => (approved ? name : null))
        .catch((): string | null => null),
    ),
  );
  return checked.filter((n): n is string => n !== null);
}

/**
 * Operator-facing: the approved demo vendors for an operator's vault. Never
 * throws — returns `[]` when no vault is configured or the read fails.
 */
export async function getOperatorVendorNames(
  operatorId: string,
): Promise<string[]> {
  const address = vaultAddressForOperator(operatorId);
  if (!address) return [];
  try {
    return await getApprovedVendorNames(address);
  } catch (err) {
    console.error(`[deputy/chain] vendor read failed for ${operatorId}:`, err);
    return [];
  }
}

/* ─────────────────────────────────────── governance / vendor reads ────── */

/** The vault's owner — governs vendor management, funding, activation, revoke. */
export async function getVaultOwner(
  address: Address,
  chainId?: number,
): Promise<Address> {
  return readVault<Address>(getAddress(address), "getOwner", chainId);
}

/** The vault's operator — the only address the vault lets call `requestSpend`. */
export async function getVaultOperator(
  address: Address,
  chainId?: number,
): Promise<Address> {
  return readVault<Address>(getAddress(address), "getOperator", chainId);
}

/** Is `vendor` currently on the vault's approved allowlist? */
export async function isVendorApproved(
  vault: Address,
  vendor: Address,
  chainId?: number,
): Promise<boolean> {
  return (await publicClient(chainId).readContract({
    address: getAddress(vault),
    abi: policyVaultAbi,
    functionName: "isVendorApproved",
    args: [getAddress(vendor)],
  })) as boolean;
}

/** Unix seconds when a queued vendor becomes executable (0 = none queued). */
export async function getPendingVendorReadyAt(
  vault: Address,
  vendor: Address,
  chainId?: number,
): Promise<number> {
  const v = (await publicClient(chainId).readContract({
    address: getAddress(vault),
    abi: policyVaultAbi,
    functionName: "getPendingVendorReadyAt",
    args: [getAddress(vendor)],
  })) as bigint;
  return Number(v);
}

/** The vault's vendor-add timelock, in seconds (0 = adds are instant). */
export async function getVendorAddTimelock(
  vault: Address,
  chainId?: number,
): Promise<number> {
  const v = (await publicClient(chainId).readContract({
    address: getAddress(vault),
    abi: policyVaultAbi,
    functionName: "getVendorAddTimelock",
  })) as bigint;
  return Number(v);
}

/* ─────────────────────────────────────────── payout history (events) ───── */

/** One on-chain payout decision, settled or blocked, read from the vault log. */
export interface PayoutReceipt {
  txHash: Hash;
  settled: boolean;
  recipient: Address;
  amount: number;
  timestamp: number;
  failedCheckIndex: number | null;
  intentHash: Hash;
  /** the chain this payout settled on. */
  chainId: number;
  explorerUrl: string;
}

interface SettledArgs {
  vendor?: Address;
  amount?: bigint;
  timestamp?: bigint;
  intentHash?: Hash;
}
interface RejectedArgs extends SettledArgs {
  failedCheckIndex?: number | bigint;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_HASH = `0x${"0".repeat(64)}` as Hash;

/**
 * Read the vault's settled + blocked payouts from its event log (on `chainId`,
 * default: active chain), newest first. `decimals` is the settlement token's
 * decimals (the caller already knows it from {@link getVaultState}). Throws on
 * RPC error; use {@link getOperatorPayoutHistory} for the resilient path.
 */
export async function getVaultPayoutHistory(
  address: Address,
  decimals: number,
  chainId?: number,
): Promise<PayoutReceipt[]> {
  const cfg = chainConfig(chainId ?? defaultChainId());
  const vault = getAddress(address);
  const client = publicClient(cfg.chainId);
  const toNum = (v: bigint) => Number(formatUnits(v, decimals));

  const [settled, rejected] = await Promise.all([
    client.getContractEvents({
      address: vault,
      abi: policyVaultAbi,
      eventName: "SpendSettled",
      fromBlock: "earliest",
      toBlock: "latest",
    }),
    client.getContractEvents({
      address: vault,
      abi: policyVaultAbi,
      eventName: "SpendRejected",
      fromBlock: "earliest",
      toBlock: "latest",
    }),
  ]);

  const ordered = [
    ...settled.map((e) => ({ e, settled: true })),
    ...rejected.map((e) => ({ e, settled: false })),
  ].sort((x, y) => {
    const byBlock = Number((y.e.blockNumber ?? BigInt(0)) - (x.e.blockNumber ?? BigInt(0)));
    return byBlock !== 0 ? byBlock : (y.e.logIndex ?? 0) - (x.e.logIndex ?? 0);
  });

  return ordered.map(({ e, settled: ok }): PayoutReceipt => {
    const args = e.args as RejectedArgs;
    const txHash = (e.transactionHash ?? ZERO_ADDRESS) as Hash;
    return {
      txHash,
      settled: ok,
      recipient: args.vendor ?? ZERO_ADDRESS,
      amount: toNum(args.amount ?? BigInt(0)),
      timestamp: Number(args.timestamp ?? BigInt(0)),
      failedCheckIndex: ok ? null : Number(args.failedCheckIndex ?? 0),
      intentHash: args.intentHash ?? ZERO_HASH,
      chainId: cfg.chainId,
      explorerUrl: chainExplorerTxUrl(cfg.chainId, e.transactionHash ?? ""),
    };
  });
}

/**
 * Page-facing: an operator's on-chain payout history, or `[]` when no vault is
 * configured or the log read fails. Never throws. (Demo vault → active chain.)
 */
export async function getOperatorPayoutHistory(
  operatorId: string,
  decimals: number,
): Promise<PayoutReceipt[]> {
  const address = vaultAddressForOperator(operatorId);
  if (!address) return [];
  try {
    return await getVaultPayoutHistory(address, decimals);
  } catch (err) {
    console.error(`[deputy/chain] payout history read failed for ${operatorId}:`, err);
    return [];
  }
}

/* ─────────────────────────────────────────── single-payout proof ───────── */

export interface PayoutProof {
  txHash: Hash;
  settled: boolean;
  recipient: Address;
  amount: number;
  intentHash: Hash;
  timestamp: number;
  blockNumber: number;
  failedCheckIndex: number | null;
  vault: Address;
  perTxCap: number;
  budget: number;
  remaining: number;
  /** the chain this payout is on — drives the network chip + explorer links. */
  chainId: number;
  network: string;
  explorerUrl: string;
}

/**
 * Read a single payout's proof from its tx hash on `chainId` (default: active
 * chain): its settled/blocked event plus the vault's policy. Returns null if the
 * hash isn't a valid payout tx. Never throws — the page shows a "not found" state.
 */
export async function getPayoutProof(
  txHash: string,
  chainId?: number,
): Promise<PayoutProof | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
  const cfg = chainConfig(chainId ?? defaultChainId());
  try {
    const receipt = await publicClient(cfg.chainId).getTransactionReceipt({
      hash: txHash as Hash,
    });
    const events = parseEventLogs({
      abi: policyVaultAbi,
      logs: receipt.logs,
      eventName: ["SpendSettled", "SpendRejected"],
    });
    const ev = events[0];
    if (!ev) return null;

    const vaultAddr = getAddress(ev.address);
    const state = await getVaultState(vaultAddr, cfg.chainId);
    const settled = ev.eventName === "SpendSettled";
    const args = ev.args as {
      vendor?: Address;
      amount?: bigint;
      intentHash?: Hash;
      timestamp?: bigint;
      failedCheckIndex?: number | bigint;
    };
    const toNum = (v: bigint) => Number(formatUnits(v, state.raw.decimals));

    return {
      txHash: txHash as Hash,
      settled,
      recipient: args.vendor ?? ZERO_ADDRESS,
      amount: toNum(args.amount ?? BigInt(0)),
      intentHash: args.intentHash ?? ZERO_HASH,
      timestamp: Number(args.timestamp ?? BigInt(0)),
      blockNumber: Number(receipt.blockNumber),
      failedCheckIndex: settled ? null : Number(args.failedCheckIndex ?? 0),
      vault: vaultAddr,
      perTxCap: state.perTxCap,
      budget: state.budget,
      remaining: state.remaining,
      chainId: cfg.chainId,
      network: cfg.name,
      explorerUrl: chainExplorerTxUrl(cfg.chainId, txHash),
    };
  } catch (err) {
    console.error(`[deputy/chain] payout proof read failed for ${txHash}:`, err);
    return null;
  }
}
