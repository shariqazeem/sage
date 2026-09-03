import "server-only";

import type { BriefFraudSignal } from "./brain-core";
import { accountNonce, defaultRpc, ETH_TOKEN, latestBlock, padFelt, STRK_TOKEN, transfersTo, type Rpc, type Transfer } from "@/lib/starknet/transfers";
import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";

/** ~7 days of Starknet blocks at the current cadence. */
export const FUNDING_LOOKBACK_BLOCKS = 20_000;
const BRAND_NEW = 0;
const YOUNG = 3;

const short = (a: string) => { const p = padFelt(a); return `${p.slice(0, 6)}…${p.slice(-4)}`; };

export interface StarknetSignalDeps {
  rpc?: Rpc | null;
  linked?: (wallet: string) => string[];
}

/** The Starknet twin of `walletFreshnessSignal`: nonce = transactions ever sent. Never high alone. */
export async function starknetFreshnessSignal(wallet: string, deps: StarknetSignalDeps = {}): Promise<BriefFraudSignal | null> {
  const rpc = deps.rpc === undefined ? defaultRpc() : deps.rpc;
  if (!rpc) return null;
  let nonce: number;
  try {
    nonce = await accountNonce(rpc, wallet);
  } catch {
    return null;
  }
  if (nonce > YOUNG) return null;
  if (nonce <= BRAND_NEW) {
    return { signal: "fresh wallet", severity: "med", reason: "recipient wallet has sent no transactions on Starknet — a brand-new or single-use account" };
  }
  return { signal: "fresh wallet", severity: "low", reason: `recipient wallet has sent only ${nonce} transaction(s) on Starknet — a young account` };
}

/** Pure: which of `peers` sent gas (STRK/ETH) into `wallet`. */
export function peerFunders(incoming: readonly Transfer[], peers: readonly string[]): string[] {
  const set = new Set(peers.map(padFelt));
  const out = new Set<string>();
  for (const t of incoming) if (set.has(t.from)) out.add(t.from);
  return [...out];
}

/**
 * The Starknet twin of `fundingClusterSignal`, plus the consolidation cluster: a wallet that another
 * submitter of this campaign funded with gas (medium, as on EVM), or that the payout-consolidation
 * watch has already linked to another submitter (high — money moving between "different" people's
 * wallets after a payout is not a friend paying for gas).
 */
export async function starknetClusterSignals(
  input: { wallet: string; peerWallets: string[] },
  deps: StarknetSignalDeps = {},
): Promise<BriefFraudSignal[]> {
  const me = padFelt(input.wallet);
  const peers = [...new Set(input.peerWallets.map(padFelt))].filter((w) => w !== me);
  const out: BriefFraudSignal[] = [];
  if (peers.length === 0) return out;

  const linked = (deps.linked ?? linkedWalletsOf)(me).map(padFelt).filter((w) => w !== me);
  const linkedPeers = linked.filter((w) => peers.includes(w));
  if (linkedPeers.length > 0) {
    out.push({
      signal: "wallet cluster",
      severity: "high",
      reason: `this wallet is linked on-chain to ${linkedPeers.length} other submitter${linkedPeers.length === 1 ? "" : "s"} of this campaign (${linkedPeers.slice(0, 3).map(short).join(", ")}) — a payout from one of them was forwarded to the other, which is one person's wallets, not several people's`,
    });
  }

  const rpc = deps.rpc === undefined ? defaultRpc() : deps.rpc;
  if (!rpc) return out;
  try {
    const head = await latestBlock(rpc);
    const from = head - FUNDING_LOOKBACK_BLOCKS;
    const incoming = [...(await transfersTo(rpc, STRK_TOKEN, me, from)), ...(await transfersTo(rpc, ETH_TOKEN, me, from))];
    const funders = peerFunders(incoming, peers);
    if (funders.length > 0) {
      out.push({
        signal: "funded by another submitter",
        severity: "med",
        reason: `this wallet's gas came from ${funders.slice(0, 3).map(short).join(", ")}, which also submitted to this campaign — the wallet-rotation shape. The work may still be genuine; a person should look.`,
      });
    }
  } catch {
    // an RPC blip is never an accusation
  }
  return out;
}
