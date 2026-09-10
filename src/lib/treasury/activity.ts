import "server-only";
import { erc20Abi, getAddress, parseAbiItem, type Address } from "viem";
import { publicClient } from "@/lib/deputy/chain";
import { chainConfig } from "@/lib/deputy/networks";

/**
 * What moved through an account, read from the chain itself: every USDC transfer in or out of the
 * treasury address. No table of our own — the chain is the record, the account page just reads it.
 *
 * Two readers, same answer. Arc's explorer is a Blockscout and serves an address's token transfers
 * in one call; the RPC is the fallback, walked in 10,000-block windows because Arc refuses larger
 * `eth_getLogs` ranges (measured: 10k ok, 50k "requested range too large").
 */
export interface TreasuryMove {
  direction: "in" | "out";
  amountBase: number;
  counterparty: Address;
  txHash: `0x${string}`;
  blockNumber: number;
  /** unix seconds when the explorer knows it; null from the RPC path */
  at: number | null;
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const WINDOW = BigInt(10_000);
const MAX_WINDOWS = 6; // ~60k blocks ≈ four hours on Arc testnet — enough for "what just happened"

async function fromExplorer(address: string, chainId: number, limit: number): Promise<TreasuryMove[] | null> {
  const c = chainConfig(chainId);
  if (chainId !== 5042002) return null; // only Arc's explorer is known to be a Blockscout
  const me = getAddress(address);
  const usdc = c.usdcAddress?.toLowerCase();
  try {
    const res = await fetch(`${c.explorerUrl}/api/v2/addresses/${me}/token-transfers?type=ERC-20`, { signal: AbortSignal.timeout(6000), next: { revalidate: 20 } });
    if (!res.ok) return null;
    const j = (await res.json()) as { items?: Array<{ block_number: number; timestamp?: string; transaction_hash: string; from: { hash: string }; to: { hash: string }; total?: { value?: string; decimals?: string }; token?: { address?: string | null; symbol?: string } }> };
    const items = (j.items ?? []).filter((it) => {
      const tokenAddr = it.token?.address?.toLowerCase();
      return !tokenAddr || !usdc || tokenAddr === usdc || it.token?.symbol === "USDC";
    });
    return items.slice(0, limit).map((it) => {
      const out = it.from.hash.toLowerCase() === me.toLowerCase();
      const decimals = Number(it.total?.decimals ?? 6);
      const raw = BigInt(it.total?.value ?? "0");
      const base = decimals === 6 ? raw : (raw * BigInt(1_000_000)) / BigInt(10) ** BigInt(decimals);
      return {
        direction: out ? "out" : "in",
        amountBase: Number(base),
        counterparty: getAddress(out ? it.to.hash : it.from.hash),
        txHash: it.transaction_hash as `0x${string}`,
        blockNumber: Number(it.block_number),
        at: it.timestamp ? Math.floor(Date.parse(it.timestamp) / 1000) : null,
      };
    });
  } catch (e) {
    console.warn("[treasury-activity] explorer unavailable:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function fromRpc(address: string, chainId: number, limit: number): Promise<TreasuryMove[]> {
  const usdc = chainConfig(chainId).usdcAddress;
  if (!usdc) return [];
  const client = publicClient(chainId);
  const me = getAddress(address);
  const moves: TreasuryMove[] = [];
  try {
    const latest = await client.getBlockNumber();
    for (let w = 0; w < MAX_WINDOWS && moves.length < limit; w++) {
      const toBlock = latest - WINDOW * BigInt(w);
      const fromBlock = toBlock - WINDOW + BigInt(1);
      if (toBlock <= BigInt(0)) break;
      const [ins, outs] = await Promise.all([
        client.getLogs({ address: usdc, event: TRANSFER, args: { to: me }, fromBlock: fromBlock > BigInt(0) ? fromBlock : BigInt(0), toBlock }),
        client.getLogs({ address: usdc, event: TRANSFER, args: { from: me }, fromBlock: fromBlock > BigInt(0) ? fromBlock : BigInt(0), toBlock }),
      ]);
      for (const l of ins) moves.push({ direction: "in", amountBase: Number(l.args.value ?? BigInt(0)), counterparty: getAddress(l.args.from as Address), txHash: l.transactionHash, blockNumber: Number(l.blockNumber), at: null });
      for (const l of outs) moves.push({ direction: "out", amountBase: Number(l.args.value ?? BigInt(0)), counterparty: getAddress(l.args.to as Address), txHash: l.transactionHash, blockNumber: Number(l.blockNumber), at: null });
    }
  } catch (e) {
    console.warn("[treasury-activity] could not read the chain:", e instanceof Error ? e.message : e);
  }
  return moves.sort((a, b) => b.blockNumber - a.blockNumber).slice(0, limit);
}

export async function treasuryActivity(address: string, chainId: number, _createdAtSec: number, limit = 30): Promise<TreasuryMove[]> {
  const viaExplorer = await fromExplorer(address, chainId, limit);
  if (viaExplorer && viaExplorer.length) return viaExplorer;
  return fromRpc(address, chainId, limit);
}

/** The account's USDC balance, straight from the token. */
export async function accountBalanceBase(address: string, chainId: number): Promise<bigint> {
  const usdc = chainConfig(chainId).usdcAddress;
  if (!usdc) return BigInt(0);
  return publicClient(chainId).readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(address)] });
}
