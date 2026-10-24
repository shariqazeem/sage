import "server-only";
import { getAddress, type Address } from "viem";
import { chainConfig, explorerTxUrl, METIS_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";
import type { AccountMove } from "@/lib/db/schema";
import { formatNative } from "./gas-policy";
import { METIS_SWAP_VENUE } from "./swap-venue";
import { treasuryActivity } from "./activity";

/**
 * WHAT MOVED THROUGH AN ACCOUNT, as rows a person reads: "Added 1.5 METIS", "Swapped 1.2 METIS for
 * 4.40 USDC", "Funded a job". Read from the chain, never projected.
 *
 * On Metis the explorer (a Blockscout, andromeda-explorer.metis.io) is the reader, because it is the
 * only one that sees METIS: a native METIS transfer leaves no log (measured: four plain sends, zero
 * logs), but the explorer indexes the transaction and the router's internal payout. It serves the
 * account's USDC transfers, its own transactions and its internal transfers in three calls. Anywhere
 * else, and whenever the explorer can't be reached, the USDC transfers are read from the RPC as before.
 *
 * Sage's own record of a swap or a send (account_moves) names what a set of legs was: the two legs of
 * a swap become one row.
 */

export type MoveAsset = "usdc" | "native";

export interface ChainMove {
  asset: MoveAsset;
  direction: "in" | "out";
  /** base units: 6 dp for USDC, 18 for the native token */
  amount: bigint;
  counterparty: Address;
  txHash: `0x${string}`;
  /** unix seconds, when the reader knows it */
  at: number | null;
}

interface BlockscoutHash {
  hash: string;
}
interface TokenTransferItem {
  tx_hash?: string;
  transaction_hash?: string;
  timestamp?: string;
  from: BlockscoutHash;
  to: BlockscoutHash;
  total?: { value?: string; decimals?: string };
  token?: { address?: string | null; address_hash?: string | null };
}
interface TxItem {
  hash: string;
  value?: string;
  status?: string;
  timestamp?: string;
  from: BlockscoutHash;
  to: BlockscoutHash | null;
}
interface InternalItem {
  transaction_hash: string;
  value?: string;
  success?: boolean;
  timestamp?: string;
  from: BlockscoutHash;
  to: BlockscoutHash | null;
}

const ts = (s?: string) => (s ? Math.floor(Date.parse(s) / 1000) : null);

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000), next: { revalidate: 15 } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** The Metis explorer's view of one account: USDC transfers, METIS in its own transactions and in internal calls. */
export async function metisExplorerMoves(address: string, limit = 40): Promise<ChainMove[] | null> {
  const base = `${chainConfig(METIS_MAINNET_CHAIN_ID).explorerUrl}/api/v2/addresses/${getAddress(address)}`;
  const me = address.toLowerCase();
  const usdc = METIS_SWAP_VENUE.usdc.toLowerCase();
  const [tokens, txs, internal] = await Promise.all([
    getJson<{ items?: TokenTransferItem[] }>(`${base}/token-transfers?type=ERC-20`),
    getJson<{ items?: TxItem[] }>(`${base}/transactions`),
    getJson<{ items?: InternalItem[] }>(`${base}/internal-transactions`),
  ]);
  // An address the explorer has never seen answers 404 on each; that is an empty account, not an outage.
  if (tokens === null && txs === null && internal === null) {
    const probe = await fetch(`${base}/token-transfers?type=ERC-20`, { signal: AbortSignal.timeout(6000) }).then((r) => r.status).catch(() => 0);
    return probe === 404 ? [] : null;
  }
  const out: ChainMove[] = [];
  for (const it of tokens?.items ?? []) {
    const token = (it.token?.address ?? it.token?.address_hash ?? "").toLowerCase();
    if (token !== usdc) continue;
    const hash = (it.tx_hash ?? it.transaction_hash) as `0x${string}` | undefined;
    if (!hash) continue;
    const outgoing = it.from.hash.toLowerCase() === me;
    out.push({ asset: "usdc", direction: outgoing ? "out" : "in", amount: BigInt(it.total?.value ?? "0"), counterparty: getAddress(outgoing ? it.to.hash : it.from.hash), txHash: hash, at: ts(it.timestamp) });
  }
  for (const it of txs?.items ?? []) {
    const value = BigInt(it.value ?? "0");
    if (value <= BigInt(0) || (it.status && it.status !== "ok") || !it.to) continue;
    const outgoing = it.from.hash.toLowerCase() === me;
    out.push({ asset: "native", direction: outgoing ? "out" : "in", amount: value, counterparty: getAddress(outgoing ? it.to.hash : it.from.hash), txHash: it.hash as `0x${string}`, at: ts(it.timestamp) });
  }
  for (const it of internal?.items ?? []) {
    const value = BigInt(it.value ?? "0");
    if (value <= BigInt(0) || it.success === false || !it.to) continue;
    const incoming = it.to.hash.toLowerCase() === me;
    // only the internal calls that paid this account or left it; a call merely passing through is not ours
    if (!incoming && it.from.hash.toLowerCase() !== me) continue;
    out.push({ asset: "native", direction: incoming ? "in" : "out", amount: value, counterparty: getAddress(incoming ? it.from.hash : it.to.hash), txHash: it.transaction_hash as `0x${string}`, at: ts(it.timestamp) });
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, limit);
}

/** Every move on the account's chain that Sage can read: the explorer on Metis, the RPC's USDC transfers elsewhere. */
export async function readAccountMoves(address: string, chainId: number, createdAt: number): Promise<ChainMove[]> {
  if (chainId === METIS_MAINNET_CHAIN_ID) {
    const viaExplorer = await metisExplorerMoves(address);
    if (viaExplorer) return viaExplorer;
  }
  const usdcOnly = await treasuryActivity(address, chainId, createdAt);
  return usdcOnly.map((m) => ({ asset: "usdc", direction: m.direction, amount: BigInt(m.amountBase), counterparty: m.counterparty, txHash: m.txHash, at: m.at }));
}

export interface ActivityRow {
  key: string;
  kind: "added" | "sent" | "swap" | "job_out" | "job_in" | "paid_sage";
  title: string;
  detail: string;
  /** "+50.00 USDC", "−1.5 METIS", "1.2 METIS → 4.40 USDC" */
  amount: string;
  tone: "in" | "out" | "neutral";
  at: number | null;
  txUrl: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Pure: turn chain legs and Sage's records into rows. `vaults` are the job vaults this account funded
 * (so a transfer to one reads "Funded a job"), `sage` the addresses plan payments go to.
 */
export function activityRows(input: { chainId: number; legs: ChainMove[]; records: AccountMove[]; vaults: ReadonlySet<string>; sage: ReadonlySet<string>; nativeSymbol: string; limit?: number }): ActivityRow[] {
  const fmt = (asset: MoveAsset | "usdc" | "metis", amount: bigint) => (asset === "usdc" ? `${(Number(amount) / 1e6).toFixed(2)} USDC` : `${formatNative(amount)} ${input.nativeSymbol}`);
  const rows: ActivityRow[] = [];
  const done = new Set<string>();
  const venue = new Set([METIS_SWAP_VENUE.pair.toLowerCase(), METIS_SWAP_VENUE.router.toLowerCase()]);

  for (const r of input.records) {
    const legAt = input.legs.find((l) => l.txHash.toLowerCase() === r.txHash)?.at ?? null;
    if (r.kind === "swap") {
      rows.push({
        key: `rec:${r.id}`,
        kind: "swap",
        title: "Swapped",
        detail: `${r.assetIn === "usdc" ? "USDC" : input.nativeSymbol} to ${r.assetOut === "usdc" ? "USDC" : input.nativeSymbol}, through ${METIS_SWAP_VENUE.name}`,
        amount: `${fmt(r.assetIn, BigInt(r.amountIn))} → ${r.assetOut && r.amountOut ? fmt(r.assetOut, BigInt(r.amountOut)) : "?"}`,
        tone: "neutral",
        at: legAt ?? r.createdAt,
        txUrl: explorerTxUrl(input.chainId, r.txHash),
      });
    } else {
      rows.push({ key: `rec:${r.id}`, kind: "sent", title: "Sent", detail: `to ${short(r.counterparty)}`, amount: `−${fmt(r.assetIn, BigInt(r.amountIn))}`, tone: "out", at: legAt ?? r.createdAt, txUrl: explorerTxUrl(input.chainId, r.txHash) });
    }
    done.add(r.txHash);
  }

  for (const l of input.legs) {
    const tx = l.txHash.toLowerCase();
    if (done.has(tx)) continue;
    const cp = l.counterparty.toLowerCase();
    const key = `leg:${tx}:${l.asset}:${l.direction}:${cp}`;
    const base = { key, at: l.at, txUrl: explorerTxUrl(input.chainId, l.txHash) };
    if (input.vaults.has(cp)) {
      rows.push(l.direction === "out"
        ? { ...base, kind: "job_out", title: "Funded a job", detail: `vault ${short(l.counterparty)}`, amount: `−${fmt(l.asset, l.amount)}`, tone: "out" }
        : { ...base, kind: "job_in", title: "Back from a job", detail: `what the job didn't spend`, amount: `+${fmt(l.asset, l.amount)}`, tone: "in" });
    } else if (input.sage.has(cp) && l.direction === "out") {
      rows.push({ ...base, kind: "paid_sage", title: "Paid for Sage", detail: "your plan", amount: `−${fmt(l.asset, l.amount)}`, tone: "out" });
    } else if (venue.has(cp)) {
      rows.push({ ...base, kind: "swap", title: "Swap leg", detail: METIS_SWAP_VENUE.name, amount: `${l.direction === "in" ? "+" : "−"}${fmt(l.asset, l.amount)}`, tone: "neutral" });
    } else if (l.direction === "in") {
      rows.push({ ...base, kind: "added", title: "Added", detail: `from ${short(l.counterparty)}`, amount: `+${fmt(l.asset, l.amount)}`, tone: "in" });
    } else {
      rows.push({ ...base, kind: "sent", title: "Sent", detail: `to ${short(l.counterparty)}`, amount: `−${fmt(l.asset, l.amount)}`, tone: "out" });
    }
  }
  return rows.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, input.limit ?? 25);
}
