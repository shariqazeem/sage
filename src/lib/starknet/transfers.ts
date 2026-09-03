import { starknetAddresses } from "./config";

/**
 * Transfer events on Starknet mainnet, read straight off the RPC — the raw material for the wallet
 * signals (who funded this wallet's gas, where did its payout go).
 *
 * Cairo 1 ERC-20s (STRK, ETH, native USDC) emit `Transfer` with `from` and `to` as KEYS and the
 * u256 amount as data; the older bridged tokens put everything in data. Both shapes are read.
 */
export const TRANSFER_SELECTOR = "0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9";
export const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const ETH_TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

export interface Transfer {
  from: string;
  to: string;
  value: bigint;
  block: number;
  tx: string;
}

export type Rpc = (method: string, params: unknown) => Promise<unknown>;

export const padFelt = (a: string) => `0x${a.trim().replace(/^0x/i, "").toLowerCase().padStart(64, "0")}`;
export const sameFelt = (a: string, b: string) => padFelt(a) === padFelt(b);

export function rpcOver(url: string, timeoutMs = 20_000): Rpc {
  let id = 1;
  return async (method, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (json.error) throw new Error(`${method}: ${json.error.message ?? "rpc error"}`);
    return json.result;
  };
}

/** The operator's own RPC, or null when the Starknet rail is not configured. */
export function defaultRpc(): Rpc | null {
  const cfg = starknetAddresses();
  return cfg ? rpcOver(cfg.rpcUrl) : null;
}

export async function latestBlock(rpc: Rpc): Promise<number> {
  return Number(await rpc("starknet_blockNumber", []));
}

/** The account's nonce — how many transactions it has ever sent. An undeployed account reads as 0. */
export async function accountNonce(rpc: Rpc, wallet: string): Promise<number> {
  try {
    return Number(BigInt(String(await rpc("starknet_getNonce", ["latest", padFelt(wallet)]))));
  } catch {
    return 0;
  }
}

interface RawEvent { keys: string[]; data: string[]; block_number: number; transaction_hash: string }

function decode(e: RawEvent): Transfer | null {
  const keyed = e.keys.length >= 3;
  const from = keyed ? e.keys[1] : e.data[0];
  const to = keyed ? e.keys[2] : e.data[1];
  const low = keyed ? e.data[0] : e.data[2];
  if (!from || !to || !low) return null;
  try {
    return { from: padFelt(from), to: padFelt(to), value: BigInt(low), block: e.block_number, tx: e.transaction_hash };
  } catch {
    return null;
  }
}

async function transfers(rpc: Rpc, token: string, keys: string[][], fromBlock: number): Promise<Transfer[]> {
  const out: Transfer[] = [];
  let continuation: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = (await rpc("starknet_getEvents", [
      { address: token, keys, from_block: { block_number: Math.max(0, fromBlock) }, to_block: "latest", chunk_size: 500, ...(continuation ? { continuation_token: continuation } : {}) },
    ])) as { events?: RawEvent[]; continuation_token?: string };
    for (const e of r.events ?? []) {
      const t = decode(e);
      if (t) out.push(t);
    }
    continuation = r.continuation_token;
    if (!continuation) break;
  }
  return out;
}

/** Transfers of `token` INTO `wallet` since `fromBlock`. */
export const transfersTo = (rpc: Rpc, token: string, wallet: string, fromBlock: number) =>
  transfers(rpc, token, [[TRANSFER_SELECTOR], [], [padFelt(wallet)]], fromBlock);

/** Transfers of `token` OUT OF `wallet` since `fromBlock`. */
export const transfersFrom = (rpc: Rpc, token: string, wallet: string, fromBlock: number) =>
  transfers(rpc, token, [[TRANSFER_SELECTOR], [padFelt(wallet)]], fromBlock);
