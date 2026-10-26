import "server-only";
import {
  decidedOnMainnet,
  mainnetSettled,
  refusedOnMainnet,
  settledLedger,
} from "@/lib/campaigns/settled-ledger";
import { marketplace } from "@/lib/campaigns/marketplace";
import { getCampaign, getCampaignByPayoutTx } from "@/lib/db/campaigns";
import { CHAINS, chainConfig, PRIMARY_NETWORKS, SECONDARY_NETWORKS } from "@/lib/deputy/networks";

/**
 * THE PUBLIC LEDGER (19 Oct 2026: /explorer and /outcomes fold into /ledger).
 *
 * Every payout and every refusal on real money, with the totals above them. Nothing here computes a
 * number of its own. Payouts are `settledLedger()` rows and their totals are `mainnetSettled()`, the
 * same pair the home page, the receipts and the exports read. Refusals are `refusedOnMainnet()`,
 * which shares its one predicate with `decidedOnMainnet()`, so the list under "Refused" is exactly
 * the count beside it. The ledger can be read row by row and it still adds up to the home page.
 *
 * Testnets never appear: `mainnet` decides every row, the same rule as every public total.
 */

export const LEDGER_PAGE_SIZE = 50;

export type LedgerShow = "all" | "paid" | "refused";
export const LEDGER_SHOWS: readonly LedgerShow[] = ["all", "paid", "refused"];

export interface LedgerQuery {
  show: LedgerShow;
  /** a network's registry key (`goat`, `metis-andromeda`, `arc`, `starknet`), or every network. */
  network: string | null;
  page: number;
}

export interface LedgerNetwork {
  chainId: number;
  /** the registry's stable slug: the filter value in the address bar. */
  key: string;
  name: string;
  /** primary networks are shown even before their first payout; the others once they have one. */
  tier: "primary" | "secondary";
  paidUsd: number;
  payouts: number;
  refused: number;
}

export interface LedgerEntry {
  /** stable: the chain and transaction for a payout, the submission for a refusal. */
  id: string;
  kind: "paid" | "refused";
  chainId: number;
  network: string;
  /** the job, as its founder titled it. */
  job: string | null;
  at: number;
  /** a payout's settlement, or a refusal's only when it produced one. It opens /proof/<tx>. */
  txHash: string | null;
  /** paid only: what the vault released, in USDC base units (6 dp). */
  amountBase: number | null;
  /** paid only. A refusal never names anyone. */
  recipient: string | null;
  /** paid to one of Sage's own wallets: real money that moved, never a person paid. */
  ownWallet: boolean;
}

export interface Ledger {
  totals: { paidUsd: number; payouts: number; refused: number };
  networks: LedgerNetwork[];
  query: LedgerQuery;
  /** how many lines each "show" choice holds inside the chosen network. */
  counts: Record<LedgerShow, number>;
  entries: LedgerEntry[];
  page: number;
  pages: number;
  /** whether any payout went to Sage's own wallets, so the page can say what those lines are. */
  hasOwnWallet: boolean;
}

/** Metis first, then GOAT (paused), then any other real-money rail that has moved money: Arc and Starknet, closed, keep their history here. */
function networkOrder(): number[] {
  const listed = [...PRIMARY_NETWORKS, ...SECONDARY_NETWORKS];
  const others = Object.keys(CHAINS)
    .map(Number)
    .filter((id) => chainConfig(id).isMainnet && !listed.includes(id));
  return [...listed, ...others];
}

const isLedgerShow = (v: string): v is LedgerShow => (LEDGER_SHOWS as readonly string[]).includes(v);

/** The filter, read from the address bar. Anything unrecognised falls back to everything, page one. */
export function parseLedgerQuery(params: Record<string, string | string[] | undefined>): LedgerQuery {
  const one = (k: string): string => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim().toLowerCase() ?? "";
  };
  const show = one("show");
  const network = one("network");
  const page = Math.floor(Number(one("page")));
  return {
    show: isLedgerShow(show) ? show : "all",
    network: networkOrder().some((id) => chainConfig(id).key === network) ? network : null,
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** The address of one view of the ledger. Defaults are left out, so the plain view is plain `/ledger`. */
export function ledgerHref(q: Partial<LedgerQuery>, hash: string | null = "activity"): string {
  const p = new URLSearchParams();
  if (q.show && q.show !== "all") p.set("show", q.show);
  if (q.network) p.set("network", q.network);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return `/ledger${s ? `?${s}` : ""}${hash ? `#${hash}` : ""}`;
}

export function readLedger(query: LedgerQuery, pageSize = LEDGER_PAGE_SIZE): Ledger {
  const settled = settledLedger();
  const paid = settled.filter((r) => r.mainnet);
  const refused = refusedOnMainnet();
  const money = mainnetSettled(settled);

  const networks: LedgerNetwork[] = networkOrder()
    .map((chainId) => {
      const cfg = chainConfig(chainId);
      const here = mainnetSettled(paid.filter((r) => r.chainId === chainId));
      return {
        chainId,
        key: cfg.key,
        name: cfg.name,
        tier: PRIMARY_NETWORKS.includes(chainId) ? ("primary" as const) : ("secondary" as const),
        paidUsd: here.usdcSettled,
        payouts: here.payouts,
        refused: refused.filter((r) => r.chainId === chainId).length,
      };
    })
    .filter((n) => n.tier === "primary" || n.payouts > 0 || n.refused > 0);

  type Line = Omit<LedgerEntry, "job" | "network"> & { campaignId: string };
  const lines: Line[] = [
    ...paid.map((r): Line => ({
      id: `${r.chainId}:${r.txHash}`,
      kind: "paid",
      chainId: r.chainId,
      campaignId: r.campaignId,
      at: r.at,
      txHash: r.txHash,
      amountBase: r.amountBase,
      recipient: r.wallet,
      ownWallet: r.operator,
    })),
    ...refused.map((r): Line => ({
      id: `refused:${r.submissionId}`,
      kind: "refused",
      chainId: r.chainId,
      campaignId: r.campaignId,
      at: r.at,
      txHash: r.txHash,
      amountBase: null,
      recipient: null,
      ownWallet: false,
    })),
  ].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));

  const inNetwork = query.network ? lines.filter((l) => chainConfig(l.chainId).key === query.network) : lines;
  const counts: Record<LedgerShow, number> = {
    all: inNetwork.length,
    paid: inNetwork.filter((l) => l.kind === "paid").length,
    refused: inNetwork.filter((l) => l.kind === "refused").length,
  };
  const shown = query.show === "all" ? inNetwork : inNetwork.filter((l) => l.kind === query.show);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const page = Math.min(Math.max(1, query.page), pages);

  // Titles only for the lines on this page: one read per job, however many lines it has.
  const titles = new Map<string, string | null>();
  const title = (id: string): string | null => {
    if (!titles.has(id)) titles.set(id, getCampaign(id)?.title ?? null);
    return titles.get(id) ?? null;
  };
  const entries = shown.slice((page - 1) * pageSize, page * pageSize).map(({ campaignId, ...l }) => ({
    ...l,
    network: chainConfig(l.chainId).name,
    job: title(campaignId),
  }));

  return {
    totals: { paidUsd: money.usdcSettled, payouts: money.payouts, refused: decidedOnMainnet().refused },
    networks,
    query: { ...query, page },
    counts,
    entries,
    page,
    pages,
    hasOwnWallet: paid.some((r) => r.operator),
  };
}

export interface LedgerOutcomes {
  /** different people paid: wallets linked to one person count once (the board's own count). */
  people: number;
  /** submit to money on chain, the one published wait (marketplace.ts `payoutWait`). */
  medianWaitSeconds: number | null;
  /** how many payouts that median stands on. */
  measured: number;
  /** the share of judged work that was refused (`decidedOnMainnet`). */
  refusedSharePct: number;
}

/**
 * WHAT THE JOBS GOT, from the derivations the rest of the site already publishes: the people count
 * and the wait are the job board's (so "Find work" and the ledger say the same thing), the refusal
 * share is the one every surface shows. The old outcomes page's corridor comparisons were written for
 * a hackathon track and are not carried over.
 */
export function ledgerOutcomes(): LedgerOutcomes {
  const board = marketplace();
  return {
    people: board.paidToDate.people,
    medianWaitSeconds: board.speed.medianSeconds,
    measured: board.speed.measured,
    refusedSharePct: decidedOnMainnet().sharePct,
  };
}

/**
 * Where a pasted 0x… goes: a payout's receipt, or a wallet's record of paid work. A known payout
 * transaction always opens its receipt; otherwise a full 64-digit hash is read as a transaction and
 * anything shorter as an address (an EVM wallet, or a Starknet one written without its leading zeros).
 * Null when it is neither, so the page can say so instead of guessing.
 */
export function lookupTarget(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(v)) return null;
  if (v.length === 66 || getCampaignByPayoutTx(v)) return `/proof/${v}`;
  return `/record/${v}`;
}
