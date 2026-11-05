import "server-only";

import { defaultRpc, latestBlock, padFelt, transfersFrom, type Rpc, type Transfer } from "@/lib/starknet/transfers";
import { starknetAddresses } from "@/lib/starknet/config";
import { linkWallets } from "@/lib/campaigns/wallet-links";
import { isKnownSubmitterWallet, listRecentPaidEvmSubmissions, listRecentPaidStarknetSubmissions, recordEvent } from "@/lib/db/campaigns";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { CHAINS } from "./networks";
import { encodeDetail } from "@/lib/campaigns/journal";
import { notifyTelegram } from "./notify";

/**
 * WHERE DID THE MONEY GO AFTER SAGE PAID IT?
 *
 * The one thing a wallet-rotation farm cannot avoid is collecting: on the first Starknet gig, eight
 * of ten paid wallets forwarded their $1.10 to the same wallet within minutes — a wallet that had
 * itself submitted (and been refused) on the campaign. That forward is visible on chain and it is
 * the strongest identity signal Sage has: two wallets whose payouts meet are one person.
 *
 * Every sweep, this reads the outbound USDC of recently paid Starknet wallets. A forward to a wallet
 * that has submitted anywhere, or to a wallet that has now collected from two or more paid wallets,
 * LINKS the pair in `wallet_links` (the same store /record uses for a person's own linked wallets)
 * — and from then on every wallet in that cluster carries a HIGH "wallet cluster" signal on every
 * campaign, so the gate holds it for the founder. Nothing is refused here; nothing is clawed back;
 * a fact is recorded and the founder is told once.
 */
export const CONSOLIDATION_LOOKBACK_SECONDS = 7 * 24 * 3600;
const LOOKBACK_BLOCKS = 20_000;

const short = (a: string) => { const p = padFelt(a); return `${p.slice(0, 6)}…${p.slice(-4)}`; };
/** short form for either rail: a 40-hex EVM address stays as it is, a felt is padded first. */
const shortAny = (a: string) => (/^0x[0-9a-f]{40}$/i.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : short(a));

export interface PaidWallet { submissionId: string; campaignId: string; wallet: string }
export interface ConsolidationLink { from: string; to: string; campaignId: string; submissionId: string; why: string }

/** Pure: which outbound transfers are consolidation — to a known submitter, or to a wallet collecting from ≥2 paid wallets. */
export function consolidationLinks(
  paid: readonly PaidWallet[],
  outbound: ReadonlyMap<string, readonly { to: string }[]>,
  isSubmitter: (wallet: string) => boolean,
  /** the rail's canonical spelling of an address: a padded felt on Starknet, lowercase hex on EVM. */
  norm: (wallet: string) => string = padFelt,
): ConsolidationLink[] {
  const paidSet = new Set(paid.map((p) => norm(p.wallet)));
  const collectors = new Map<string, Set<string>>();
  for (const p of paid) {
    for (const t of outbound.get(norm(p.wallet)) ?? []) {
      if (!collectors.has(t.to)) collectors.set(t.to, new Set());
      collectors.get(t.to)!.add(norm(p.wallet));
    }
  }
  const links: ConsolidationLink[] = [];
  for (const p of paid) {
    const me = norm(p.wallet);
    for (const t of outbound.get(me) ?? []) {
      if (t.to === me) continue;
      const submitter = paidSet.has(t.to) || isSubmitter(t.to);
      const hub = (collectors.get(t.to)?.size ?? 0) >= 2;
      if (!submitter && !hub) continue;
      links.push({
        from: me,
        to: t.to,
        campaignId: p.campaignId,
        submissionId: p.submissionId,
        why: submitter
          ? `payout forwarded to ${shortAny(t.to)}, which also submitted to Sage`
          : `payout forwarded to ${shortAny(t.to)}, which has collected from ${collectors.get(t.to)!.size} paid wallets`,
      });
    }
  }
  return links;
}

export async function watchPayoutConsolidation(deps: { rpc?: Rpc | null; now?: number } = {}): Promise<{ scanned: number; linked: number }> {
  const rpc = deps.rpc === undefined ? defaultRpc() : deps.rpc;
  const cfg = starknetAddresses();
  if (!rpc || !cfg) return { scanned: 0, linked: 0 };
  const now = deps.now ?? Math.floor(Date.now() / 1000);
  const paid = listRecentPaidStarknetSubmissions(now - CONSOLIDATION_LOOKBACK_SECONDS).map((s) => ({ submissionId: s.id, campaignId: s.campaignId, wallet: s.wallet }));
  if (paid.length === 0) return { scanned: 0, linked: 0 };
  let head: number;
  try {
    head = await latestBlock(rpc);
  } catch {
    return { scanned: 0, linked: 0 };
  }
  const outbound = new Map<string, Transfer[]>();
  for (const p of paid) {
    const w = padFelt(p.wallet);
    if (outbound.has(w)) continue;
    try {
      outbound.set(w, await transfersFrom(rpc, cfg.token, w, head - LOOKBACK_BLOCKS));
    } catch {
      outbound.set(w, []);
    }
  }
  let linked = 0;
  for (const l of consolidationLinks(paid, outbound, isKnownSubmitterWallet)) {
    if (!linkWallets(l.from, l.to, now).linked) continue;
    linked += 1;
    recordEvent({
      campaignId: l.campaignId,
      submissionId: l.submissionId,
      kind: "wallet_cluster",
      detail: encodeDetail(`${short(l.from)} · ${l.why}`),
    });
    void notifyTelegram(`🕸️ <b>Wallet cluster</b>\n${short(l.from)} → ${short(l.to)}\n${l.why}\nFuture submissions from this cluster hold for your review.`);
  }
  return { scanned: paid.length, linked };
}

/**
 * THE SAME WATCH ON METIS (and any EVM rail).
 *
 * The farm was caught on Starknet, so this watch was written for Starknet only, and when Metis became
 * the one network, the strongest identity signal Sage has stopped being read at all (found 5 Nov 2026).
 * On EVM, outbound USDC is the token's own Transfer log with the paid wallet as `from`. The rule is
 * unchanged and shared (consolidationLinks): a forward to a wallet that also submitted, or to a wallet
 * now collecting from two or more paid wallets, links the pair. From then on the cluster carries a HIGH
 * "wallet cluster" signal on every campaign (decisions.ts), so the gate holds it for the founder.
 */
const EVM_LOOKBACK_BLOCKS = BigInt(60_000);
const EVM_LOG_CHUNK = BigInt(10_000);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export interface EvmLogReader {
  head(chainId: number): Promise<bigint>;
  transfersFrom(chainId: number, token: Address, from: Address, fromBlock: bigint, toBlock: bigint): Promise<{ to: string }[]>;
}

function defaultEvmReader(): EvmLogReader {
  const client = (chainId: number) => createPublicClient({ transport: http(CHAINS[chainId]!.rpcUrl) });
  return {
    head: (chainId) => client(chainId).getBlockNumber(),
    async transfersFrom(chainId, token, from, fromBlock, toBlock) {
      const out: { to: string }[] = [];
      // RPCs cap a log query's block range, so the window is read in chunks.
      for (let start = fromBlock; start <= toBlock; start += EVM_LOG_CHUNK) {
        const end = start + EVM_LOG_CHUNK - BigInt(1) < toBlock ? start + EVM_LOG_CHUNK - BigInt(1) : toBlock;
        const logs = await client(chainId).getLogs({ address: token, event: TRANSFER, args: { from }, fromBlock: start, toBlock: end });
        for (const l of logs) if (l.args.to) out.push({ to: l.args.to.toLowerCase() });
      }
      return out;
    },
  };
}

const lowerHex = (w: string) => w.trim().toLowerCase();

export async function watchPayoutConsolidationEvm(deps: { reader?: EvmLogReader; now?: number } = {}): Promise<{ scanned: number; linked: number }> {
  const now = deps.now ?? Math.floor(Date.now() / 1000);
  const rows = listRecentPaidEvmSubmissions(now - CONSOLIDATION_LOOKBACK_SECONDS);
  if (rows.length === 0) return { scanned: 0, linked: 0 };
  const reader = deps.reader ?? defaultEvmReader();
  let scanned = 0;
  let linked = 0;
  const byChain = new Map<number, PaidWallet[]>();
  for (const r of rows) {
    const cfg = CHAINS[r.chainId];
    if (!cfg?.evm || !cfg.usdcAddress || !/^0x[0-9a-fA-F]{40}$/.test(r.wallet)) continue;
    if (!byChain.has(r.chainId)) byChain.set(r.chainId, []);
    byChain.get(r.chainId)!.push({ submissionId: r.submissionId, campaignId: r.campaignId, wallet: r.wallet });
  }
  for (const [chainId, paid] of byChain) {
    const token = CHAINS[chainId]!.usdcAddress as Address;
    let head: bigint;
    try {
      head = await reader.head(chainId);
    } catch {
      continue; // an unreadable network is never an accusation
    }
    const from = head > EVM_LOOKBACK_BLOCKS ? head - EVM_LOOKBACK_BLOCKS : BigInt(0);
    const outbound = new Map<string, { to: string }[]>();
    for (const p of paid) {
      const w = lowerHex(p.wallet);
      if (outbound.has(w)) continue;
      try {
        outbound.set(w, await reader.transfersFrom(chainId, token, p.wallet as Address, from, head));
      } catch {
        outbound.set(w, []);
      }
    }
    scanned += paid.length;
    for (const l of consolidationLinks(paid, outbound, isKnownSubmitterWallet, lowerHex)) {
      if (!linkWallets(l.from, l.to, now).linked) continue;
      linked += 1;
      recordEvent({
        campaignId: l.campaignId,
        submissionId: l.submissionId,
        kind: "wallet_cluster",
        detail: encodeDetail(`${shortAny(l.from)} · ${l.why}`),
      });
      void notifyTelegram(`🕸️ <b>Wallet cluster</b>\n${shortAny(l.from)} → ${shortAny(l.to)}\n${l.why}\nFuture submissions from this cluster hold for your review.`);
    }
  }
  return { scanned, linked };
}
