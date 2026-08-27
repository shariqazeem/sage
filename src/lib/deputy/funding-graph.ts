import "server-only";

import { chainConfig } from "./networks";
import type { BriefFraudSignal } from "./brain-core";

/**
 * FUNDING-GRAPH SIBLING DETECTION — the answer to wallet rotation.
 *
 * The per-wallet payout cap is enforced honestly on-chain, and it is trivially defeated by using
 * more wallets. MEASURED on prod 2026-08-28, campaign launch-www-metis-io-bv31yf: one person whose
 * own submission was REJECTED funded a DAISY CHAIN of four fresh wallets — each forwarding the
 * previous balance minus gas (1.000e-6 → 9.920e-7 → 9.840e-7 → 9.761e-7 BTC), 88-108 seconds
 * apart — and those four wallets took all four slots of the mission. Every submission was genuine
 * work that passed the observation bar; the harm was not fabricated evidence, it was ONE person
 * occupying FOUR places meant for four people.
 *
 * Textual near-dup can't see this (four honest, differently-worded accounts). Wallet freshness
 * can't see it (it flags each wallet alone, never the relationship). The funding graph can: a
 * wallet's first inbound native transfer is immutable, public, and names whoever paid its gas.
 *
 * DELIBERATELY A SIGNAL, NEVER A BLOCK. Funding someone's gas is also what an honest founder does
 * for a friend, a teammate, or a person with no crypto. So this is medium severity — it informs
 * the reviewer and the founder's own console, and can never refuse a payout on its own (the gate
 * holds only on HIGH). Fully failure-isolated: an explorer blip yields NO signal, because an
 * infrastructure hiccup must never become an accusation.
 */

/** A wallet's funder never changes (first inbound transfer is immutable), so memoize forever. */
const funderCache = new Map<string, string | null>();

/** Ceiling on peer lookups per decision — see the sibling scan below. */
const MAX_PEER_LOOKUPS = 15;

export interface FundingLookupDeps {
  /** injectable for tests; returns the address that sent this wallet its first inbound transfer. */
  firstFunder?: (wallet: string, chainId: number) => Promise<string | null>;
}

/**
 * The address that paid this wallet's first inbound native transfer, lowercased — or null when
 * unknown (never funded, unreadable, or the explorer refused). Uses the chain's block explorer,
 * which is the only surface that can answer "first tx of an address" without scanning blocks.
 */
export async function firstFunderOf(wallet: string, chainId: number): Promise<string | null> {
  const key = `${chainId}:${wallet.toLowerCase()}`;
  const memo = funderCache.get(key);
  if (memo !== undefined) return memo;

  let funder: string | null = null;
  try {
    const base = chainConfig(chainId).explorerUrl.replace(/\/$/, "");
    const url = `${base}/api?module=account&action=txlist&address=${wallet}&sort=asc&page=1&offset=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const body = (await res.json()) as { result?: Array<{ from?: unknown; to?: unknown; value?: unknown }> };
      const first = Array.isArray(body.result) ? body.result[0] : undefined;
      const from = typeof first?.from === "string" ? first.from.toLowerCase() : null;
      const to = typeof first?.to === "string" ? first.to.toLowerCase() : null;
      // Only an INBOUND transfer names a funder. A wallet whose first tx is outbound was funded
      // on another chain (or via a contract), which this lane cannot see — that is an honest null.
      if (from && to === wallet.toLowerCase() && from !== wallet.toLowerCase()) funder = from;
    }
  } catch {
    return null; // never cache a failure — a blip must not become a permanent "unknown"
  }
  funderCache.set(key, funder);
  return funder;
}

/** Test seam: preload/clear the memo without touching the network. */
export function __setFunderForTest(wallet: string, chainId: number, funder: string | null): void {
  funderCache.set(`${chainId}:${wallet.toLowerCase()}`, funder);
}
export function __clearFunderCache(): void {
  funderCache.clear();
}

export interface ClusterInput {
  /** the submitting wallet under judgment. */
  wallet: string;
  /** every OTHER wallet that has submitted to this same campaign. */
  peerWallets: string[];
  chainId: number;
}

/**
 * Does this wallet share a funding relationship with another submitter on the same campaign?
 * Two shapes, both measured in the real cluster:
 *   · CHAIN  — this wallet's gas came directly from another submitter's wallet (A → B);
 *   · SIBLING — this wallet and another submitter were funded by the SAME parent.
 * Returns null when unrelated, unknown, or unreadable.
 */
export async function fundingClusterSignal(
  input: ClusterInput,
  deps: FundingLookupDeps = {},
): Promise<BriefFraudSignal | null> {
  const lookup = deps.firstFunder ?? firstFunderOf;
  const me = input.wallet.toLowerCase();
  const peers = [...new Set(input.peerWallets.map((w) => w.toLowerCase()))].filter((w) => w !== me);
  if (peers.length === 0) return null;

  let myFunder: string | null;
  try {
    myFunder = await lookup(me, input.chainId);
  } catch {
    return null;
  }
  if (!myFunder) return null;

  // CHAIN: my gas came straight from someone who also submitted here.
  if (peers.includes(myFunder)) {
    return {
      signal: "funded by another submitter",
      severity: "med",
      reason: `this wallet's first funding came directly from ${short(myFunder)}, which also submitted to this campaign — the wallet-rotation shape. The work may still be genuine; the places may not be independent.`,
    };
  }

  // SIBLING: another submitter's gas came from the same parent as mine. Bounded — the memo makes
  // repeats free within a campaign, but an unbounded scan on a busy campaign would put an
  // arbitrary number of network round-trips on the decision path.
  const siblings: string[] = [];
  for (const peer of peers.slice(0, MAX_PEER_LOOKUPS)) {
    let peerFunder: string | null = null;
    try {
      peerFunder = await lookup(peer, input.chainId);
    } catch {
      continue; // one unreadable peer never invalidates the rest
    }
    if (peerFunder && peerFunder === myFunder) siblings.push(peer);
  }
  if (siblings.length === 0) return null;
  return {
    signal: "sibling-funded wallets",
    severity: "med",
    reason: `this wallet and ${siblings.length} other submitter${siblings.length === 1 ? "" : "s"} on this campaign (${siblings.slice(0, 3).map(short).join(", ")}) were all first funded by ${short(myFunder)} — they may be one person's wallets rather than independent people.`,
  };
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
