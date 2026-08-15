/**
 * IS OUR VIEW OF THE CHAIN ACTUALLY CURRENT?
 *
 * A DOWN RPC is loud: every call errors, every caller degrades, somebody notices in minutes. A STALE
 * one is silent and far more dangerous — it answers instantly, reports `eth_syncing: false`, and
 * hands back a chain from hours ago. Every check passes against the wrong reality.
 *
 * Measured on prod (2026-08-15): one backend behind `rpc.goat.network`'s anycast address was frozen
 * at block 14,594,173 for over ten hours while claiming to be fully synced with 3 peers. Requests
 * from the VM landed on it deterministically; requests from a laptop, same hostname and same IPs,
 * reached a healthy node. A founder's vault deployed correctly and the server could not see the
 * receipt, so the deploy hung with no error anywhere and nothing in the product able to say why.
 *
 * The money consequence is the one that matters. Settlements are signed and broadcast BY THE SERVER,
 * and a transaction's nonce comes from the node's account state. Broadcasting real USDC using a
 * nonce read ten hours in the past is how payouts get stuck, silently replaced, or duplicated. A
 * payout must never be sent through a node we cannot show is current.
 *
 * Pure core here; the network read is a thin wrapper below it, so the policy is testable without a
 * chain and the same verdict is used by every caller.
 */
import "server-only";

import { publicClient } from "./chain";

/**
 * How old the head block may be before we refuse to treat the node as truth.
 *
 * GOAT produces a block roughly every 3-4 seconds, so a healthy head is always seconds old and this
 * is ~100x the normal gap — generous enough that ordinary jitter, a slow peer or a brief pause can
 * never trip it, tight enough that the ten-hour hole this exists for is caught immediately.
 */
export const MAX_HEAD_AGE_SECONDS = 300;

export interface ChainFreshness {
  fresh: boolean;
  /** head block number, or null when the node could not be read at all. */
  blockNumber: number | null;
  /** how many seconds old the head block is, or null when unread. */
  headAgeSeconds: number | null;
  /** `stale` / `unreadable` when not fresh — a bounded token, safe to log and surface. */
  reason: "current" | "stale" | "unreadable";
}

/**
 * The verdict for a head we have already read. Split out so the policy is exercised without a chain.
 *
 * A head in the FUTURE is treated as current, not suspicious: clock skew of a few seconds between
 * our host and the block producer is normal and is not evidence of a stale node. Only age is.
 */
export function judgeHeadAge(
  blockNumber: number | null,
  headTimestampSeconds: number | null,
  nowSeconds: number,
  maxAgeSeconds = MAX_HEAD_AGE_SECONDS,
): ChainFreshness {
  if (blockNumber === null || headTimestampSeconds === null) {
    return { fresh: false, blockNumber, headAgeSeconds: null, reason: "unreadable" };
  }
  const age = Math.max(0, nowSeconds - headTimestampSeconds);
  return age > maxAgeSeconds
    ? { fresh: false, blockNumber, headAgeSeconds: age, reason: "stale" }
    : { fresh: true, blockNumber, headAgeSeconds: age, reason: "current" };
}

/** A founder-readable sentence for a non-fresh verdict. Names the fault as OURS, never the tester's
 *  and never the founder's — nobody's work is in question when our node is behind. */
export function freshnessHoldReason(f: ChainFreshness): string {
  if (f.reason === "unreadable") return "the network is temporarily unreadable — held, nothing was sent";
  const hours = Math.floor((f.headAgeSeconds ?? 0) / 3600);
  const mins = Math.round(((f.headAgeSeconds ?? 0) % 3600) / 60);
  const behind = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return `our view of the network is ${behind} behind — held so nothing is signed against stale state`;
}

/**
 * Read the chain head and judge it. Never throws: an unreadable node is a verdict, not an exception,
 * because every caller has to make the same conservative decision either way.
 */
export async function readChainFreshness(
  chainId: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<ChainFreshness> {
  try {
    const block = await publicClient(chainId).getBlock({ blockTag: "latest" });
    return judgeHeadAge(Number(block.number), Number(block.timestamp), nowSeconds);
  } catch {
    return { fresh: false, blockNumber: null, headAgeSeconds: null, reason: "unreadable" };
  }
}
