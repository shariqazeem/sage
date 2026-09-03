import "server-only";
import type { Campaign } from "@/lib/db/schema";
import { getDecisionBySubmission, listSubmissions } from "@/lib/db/campaigns";
import { directLinksOf, linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { briefFromRow } from "@/lib/deputy/decisions";
import { firstFunderOf } from "@/lib/deputy/funding-graph";
import { defaultRpc, ETH_TOKEN, latestBlock, type Rpc, STRK_TOKEN, transfersTo } from "@/lib/starknet/transfers";

/**
 * THE WALLET GRAPH of one campaign — the object the farm forensic was done on, kept live.
 * Nodes: the vault and every wallet that submitted. Edges: the vault's payouts (paid rows),
 * consolidation links the watch recorded (a payout forwarded between submitters), and gas
 * funding read from the chain (who paid for whose first transactions). A node in a linked
 * cluster is marked so the picture says what the ledger knows.
 */
export interface GraphNode { id: string; kind: "vault" | "wallet"; label: string; status: string | null; clustered: boolean; paidBase: number; flags: string[] }
export interface GraphEdge { from: string; to: string; kind: "payout" | "consolidation" | "gas"; amountBase?: number }
export interface WalletGraph { campaignId: string; title: string; rail: "evm" | "starknet"; nodes: GraphNode[]; edges: GraphEdge[]; readAt: number; partial: boolean; /** chain reads that failed — the picture may be missing gas edges */ readErrors: number }

const bare = (w: string) => w.trim().toLowerCase().replace(/^0x/, "").replace(/^0+/, "");
const cache = new Map<string, { at: number; graph: WalletGraph }>();
const TTL = 10 * 60;
const MAX_WALLETS = 60;

/**
 * The block the campaign's life began at, from the chain's own pace: two block timestamps give
 * seconds per block, and the campaign's creation time (minus a day of slack) gives the depth. A
 * fixed "last N blocks" was hours on Starknet — the farm's gas chain, a day old, read as nothing.
 */
async function blockAtTime(rpc: Rpc, head: number, atSec: number): Promise<number> {
  const ts = async (n: number) => Number(((await rpc("starknet_getBlockWithTxHashes", [{ block_number: n }])) as { timestamp: number }).timestamp);
  const span = Math.min(head, 5_000);
  const [tHead, tPast] = await Promise.all([ts(head), ts(head - span)]);
  const secPerBlock = Math.max(0.5, (tHead - tPast) / span);
  const depth = Math.ceil((tHead - atSec) / secPerBlock);
  return Math.max(0, head - Math.min(depth, 3_000_000));
}

async function gasFunders(rail: "evm" | "starknet", chainId: number, wallets: string[], sinceSec: number): Promise<{ funders: Map<string, string[]>; errors: number }> {
  const funders = new Map<string, string[]>();
  let errors = 0;
  const set = new Set(wallets.map(bare));
  if (rail === "starknet") {
    const rpc = defaultRpc();
    if (!rpc) return { funders, errors: 1 };
    let from = 0;
    try {
      const head = await latestBlock(rpc);
      from = await blockAtTime(rpc, head, sinceSec - 86_400);
    } catch {
      return { funders, errors: 1 };
    }
    for (const w of wallets) {
      try {
        const inc = [...(await transfersTo(rpc, STRK_TOKEN, w, from)), ...(await transfersTo(rpc, ETH_TOKEN, w, from))];
        const who = [...new Set(inc.map((t) => t.from).filter((f) => set.has(bare(f))))];
        if (who.length) funders.set(bare(w), who);
      } catch (e) {
        errors += 1;
        console.warn(`[graph] gas read failed for ${w.slice(0, 10)}…: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { funders, errors };
  }
  for (const w of wallets) {
    try {
      const f = await firstFunderOf(w, chainId);
      if (f && set.has(bare(f))) funders.set(bare(w), [f]);
    } catch {
      errors += 1;
    }
  }
  return { funders, errors };
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
  // consolidation links recorded by the watch, between wallets of this campaign: the ROWS are the
  // edges (a payout forwarded from one to the other); the closure only says who is in a cluster
  const seen = new Set<string>();
  for (const w of wallets) {
    for (const l of directLinksOf(w)) {
      const a = bare(w), b = bare(l);
      if (a === b || !byBare.has(b)) continue;
      const key = [a, b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: a, to: b, kind: "consolidation" });
    }
    if (linkedWalletsOf(w).some((l) => bare(l) !== bare(w) && byBare.has(bare(l)))) {
      const me = nodes.find((n) => n.id === bare(w));
      if (me) me.clustered = true;
    }
  }
  // gas funding, from the chain (cached with the graph)
  let readErrors = 0;
  if (opts.live !== false) {
    const g = await gasFunders(campaign.settlementRail, campaign.chainId, wallets, campaign.createdAt);
    readErrors = g.errors;
    for (const [to, froms] of g.funders) for (const f of froms) if (bare(f) !== to) edges.push({ from: bare(f), to, kind: "gas" });
  }
  const graph: WalletGraph = { campaignId: campaign.id, title: campaign.title, rail: campaign.settlementRail, nodes, edges, readAt: now, partial, readErrors };
  // a graph whose chain reads failed is not worth keeping for ten minutes
  if (readErrors > 0) return graph;
  cache.set(campaign.id, { at: now, graph });
  return graph;
}
