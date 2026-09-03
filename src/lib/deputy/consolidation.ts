import "server-only";

import { defaultRpc, latestBlock, padFelt, transfersFrom, type Rpc, type Transfer } from "@/lib/starknet/transfers";
import { starknetAddresses } from "@/lib/starknet/config";
import { linkWallets } from "@/lib/campaigns/wallet-links";
import { isKnownSubmitterWallet, listRecentPaidStarknetSubmissions, recordEvent } from "@/lib/db/campaigns";
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

export interface PaidWallet { submissionId: string; campaignId: string; wallet: string }
export interface ConsolidationLink { from: string; to: string; campaignId: string; submissionId: string; why: string }

/** Pure: which outbound transfers are consolidation — to a known submitter, or to a wallet collecting from ≥2 paid wallets. */
export function consolidationLinks(
  paid: readonly PaidWallet[],
  outbound: ReadonlyMap<string, readonly Transfer[]>,
  isSubmitter: (wallet: string) => boolean,
): ConsolidationLink[] {
  const paidSet = new Set(paid.map((p) => padFelt(p.wallet)));
  const collectors = new Map<string, Set<string>>();
  for (const p of paid) {
    for (const t of outbound.get(padFelt(p.wallet)) ?? []) {
      if (!collectors.has(t.to)) collectors.set(t.to, new Set());
      collectors.get(t.to)!.add(padFelt(p.wallet));
    }
  }
  const links: ConsolidationLink[] = [];
  for (const p of paid) {
    const me = padFelt(p.wallet);
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
          ? `payout forwarded to ${short(t.to)}, which also submitted to Sage`
          : `payout forwarded to ${short(t.to)}, which has collected from ${collectors.get(t.to)!.size} paid wallets`,
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
