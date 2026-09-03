import "server-only";
import type { Campaign } from "@/lib/db/schema";
import { getDecisionBySubmission, listSubmissions } from "@/lib/db/campaigns";
import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { briefFromRow } from "@/lib/deputy/decisions";
import { firstFunderOf } from "@/lib/deputy/funding-graph";
import { defaultRpc, ETH_TOKEN, latestBlock, STRK_TOKEN, transfersTo } from "@/lib/starknet/transfers";

/**
 * THE WALLET GRAPH of one campaign — the object the farm forensic was done on, kept live.
 * Nodes: the vault and every wallet that submitted. Edges: the vault's payouts (paid rows),
 * consolidation links the watch recorded (a payout forwarded between submitters), and gas
 * funding read from the chain (who paid for whose first transactions). A node in a linked
 * cluster is marked so the picture says what the ledger knows.
 */
export interface GraphNode { id: string; kind: "vault" | "wallet"; label: string; status: string | null; clustered: boolean; paidBase: number; flags: string[] }
export interface GraphEdge { from: string; to: string; kind: "payout" | "consolidation" | "gas"; amountBase?: number }
export interface WalletGraph { campaignId: string; title: string; rail: "evm" | "starknet"; nodes: GraphNode[]; edges: GraphEdge[]; readAt: number; partial: boolean }

const bare = (w: string) => w.trim().toLowerCase().replace(/^0x/, "").replace(/^0+/, "");
const cache = new Map<string, { at: number; graph: WalletGraph }>();
const TTL = 10 * 60;
const MAX_WALLETS = 60;

async function gasFunders(rail: "evm" | "starknet", chainId: number, wallets: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const set = new Set(wallets.map(bare));
  if (rail === "starknet") {
    const rpc = defaultRpc();
    if (!rpc) return out;
    const head = await latestBlock(rpc).catch(() => null);
    if (head === null) return out;
    for (const w of wallets) {
      try {
        const inc = [...(await transfersTo(rpc, STRK_TOKEN, w, head - 20_000)), ...(await transfersTo(rpc, ETH_TOKEN, w, head - 20_000))];
        const funders = [...new Set(inc.map((t) => t.from).filter((f) => set.has(bare(f))))];
        if (funders.length) out.set(bare(w), funders);
      } catch {
        /* one unreadable wallet never hides the rest */
      }
    }
    return out;
  }
  for (const w of wallets) {
    const f = await firstFunderOf(w, chainId).catch(() => null);
    if (f && set.has(bare(f))) out.set(bare(w), [f]);
  }
  return out;
}

export async function walletGraphFor(campaign: Campaign, opts: { live?: boolean } = {}): Promise<WalletGraph> {
  const hit = cache.get(campaign.id);
  const now = Math.floor(Date.now() / 1000);
  if (hit && now - hit.at < TTL) return hit.graph;
  const subs = listSubmissions(campaign.id);
  const wallets = [...new Map(subs.map((s) => [bare(s.wallet), s.wallet])).values()].slice(0, MAX_WALLETS);
  const partial = subs.length > MAX_WALLETS;
  const byBare = new Map(wallets.map((w) => [bare(w), w]));
  const nodes: GraphNode[] = [{ id: "vault", kind: "vault", label: "vault", status: null, clustered: false, paidBase: 0, flags: [] }];
  const edges: GraphEdge[] = [];
  // wallets, their status, the payouts, the judge's flags
  for (const w of wallets) {
    const mine = subs.filter((s) => bare(s.wallet) === bare(w));
    const paid = mine.filter((s) => s.status === "paid" && s.payoutTx);
    const status = paid.length ? "paid" : mine.some((s) => s.status === "rejected") ? "refused" : mine.some((s) => s.status === "approved" || s.status === "settling") ? "settling" : "pending";
    const flags = new Set<string>();
    for (const s of mine) {
      const d = getDecisionBySubmission(s.id);
      if (!d) continue;
      for (const f of briefFromRow(d).fraudSignals ?? []) if (f.severity !== "low") flags.add(f.signal);
    }
    nodes.push({ id: bare(w), kind: "wallet", label: `${w.slice(0, 6)}…${w.slice(-4)}`, status, clustered: false, paidBase: paid.length * campaign.rewardAmount, flags: [...flags] });
    for (let i = 0; i < paid.length; i++) edges.push({ from: "vault", to: bare(w), kind: "payout", amountBase: campaign.rewardAmount });
  }
  // consolidation links recorded by the watch, between wallets of this campaign
  const seen = new Set<string>();
  for (const w of wallets) {
    for (const l of linkedWalletsOf(w)) {
      const a = bare(w), b = bare(l);
      if (a === b || !byBare.has(b)) continue;
      const key = [a, b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: a, to: b, kind: "consolidation" });
      for (const n of nodes) if (n.id === a || n.id === b) n.clustered = true;
    }
  }
  // gas funding, from the chain (cached with the graph)
  if (opts.live !== false) {
    const funders = await gasFunders(campaign.settlementRail, campaign.chainId, wallets);
    for (const [to, froms] of funders) for (const f of froms) if (bare(f) !== to) edges.push({ from: bare(f), to, kind: "gas" });
  }
  const graph: WalletGraph = { campaignId: campaign.id, title: campaign.title, rail: campaign.settlementRail, nodes, edges, readAt: now, partial };
  cache.set(campaign.id, { at: now, graph });
  return graph;
}
