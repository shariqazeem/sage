import "server-only";
import { and, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, events, submissions } from "@/lib/db/schema";
import { chainConfig } from "@/lib/deputy/networks";

/**
 * THE SETTLED LEDGER — one derivation of "money that actually moved", for every surface.
 *
 * Three public surfaces each computed their own version of the settled total and showed three
 * different numbers on the same day (measured 2026-09-01: launch $52.05, explorer $51.60,
 * marketplace $52.60). Each divergence had its own cause — mission-reward lookups instead of
 * settled amounts, a missing chain filter that let testnet rows into a money headline, a rail
 * whose settlements never reached the events journal — and every future surface would have
 * added a fourth. This module is the fix-shape for that whole family: the settlement EVENT is
 * the single source of truth (CLAUDE.md invariant), so every row here is one deduped
 * settlement event, priced by what the vault actually released.
 *
 * Scopes are named, not implied:
 *  - `mainnet` rows are real money (the chain registry decides — the next rail counts the day
 *     it settles);
 *  - `operator` marks payouts to Sage's own wallets, so "paid to testers" surfaces can
 *     exclude dogfood money without re-deriving anything.
 */

/** Sage's own wallets — dogfood payouts, excluded from "testers paid" scopes. */
export const OPERATOR_WALLETS = new Set(
  [
    "0xdf70f6e8e656e5bb714ff0e8ca176d76f26890e3",
    "0x0def3d4124d0cd1708aeffe6c1bc8182342a44d6",
  ].map((w) => w.toLowerCase()),
);

export interface SettledRow {
  txHash: string;
  amountBase: number;
  /** the paid submission, when the event names one — lets a surface enrich (mission, host). */
  submissionId: string | null;
  /** recipient wallet when the paid submission is known; null for chain-only rows. */
  wallet: string | null;
  campaignId: string;
  chainId: number;
  mainnet: boolean;
  operator: boolean;
  at: number;
}

const SETTLED_KINDS = ["settled", "autopay_settled"] as const;

/** Every settlement, one row per (chain, tx), newest first. */
export function settledLedger(): SettledRow[] {
  const evs = db
    .select({
      campaignId: events.campaignId,
      submissionId: events.submissionId,
      txHash: events.txHash,
      amount: events.amount,
      at: events.createdAt,
    })
    .from(events)
    .where(and(inArray(events.kind, [...SETTLED_KINDS]), isNotNull(events.txHash)))
    .all();
  if (evs.length === 0) return [];

  const campaignIds = [...new Set(evs.map((e) => e.campaignId))];
  const campById = new Map(
    db
      .select({ id: campaigns.id, chainId: campaigns.chainId, sandbox: campaigns.sandbox })
      .from(campaigns)
      .where(inArray(campaigns.id, campaignIds))
      .all()
      .map((c) => [c.id, c]),
  );
  const subIds = [...new Set(evs.map((e) => e.submissionId).filter((s): s is string => !!s))];
  const walletBySub = new Map(
    subIds.length === 0
      ? []
      : db
          .select({ id: submissions.id, wallet: submissions.wallet })
          .from(submissions)
          .where(inArray(submissions.id, subIds))
          .all()
          .map((s) => [s.id, s.wallet]),
  );

  const out = new Map<string, SettledRow>();
  for (const e of evs) {
    const c = campById.get(e.campaignId);
    if (!c || c.sandbox) continue;
    const key = `${c.chainId}:${e.txHash}`;
    const wallet = e.submissionId ? (walletBySub.get(e.submissionId) ?? null) : null;
    const prev = out.get(key);
    // one payout can surface as both `settled` and `autopay_settled`; keep the richer row.
    if (prev && prev.wallet !== null) continue;
    out.set(key, {
      txHash: e.txHash as string,
      amountBase: e.amount ?? prev?.amountBase ?? 0,
      submissionId: e.submissionId ?? prev?.submissionId ?? null,
      wallet: wallet ?? prev?.wallet ?? null,
      campaignId: e.campaignId,
      chainId: c.chainId,
      mainnet: chainConfig(c.chainId).isMainnet,
      operator: wallet != null && OPERATOR_WALLETS.has(wallet.toLowerCase()),
      at: prev?.at ?? e.at,
    });
  }
  return [...out.values()].sort((a, b) => b.at - a.at);
}

/** Real money settled — the number a page may headline. */
export function mainnetSettled(rows = settledLedger()): { usdcSettled: number; payouts: number } {
  const m = rows.filter((r) => r.mainnet);
  return {
    usdcSettled: m.reduce((s, r) => s + r.amountBase, 0) / 1_000_000,
    payouts: m.length,
  };
}

/** Real money settled to PEOPLE — operator dogfood excluded. */
export function mainnetSettledToTesters(
  rows = settledLedger(),
): { usdcSettled: number; payouts: number; people: number } {
  const m = rows.filter((r) => r.mainnet && !r.operator);
  return {
    usdcSettled: m.reduce((s, r) => s + r.amountBase, 0) / 1_000_000,
    payouts: m.length,
    people: new Set(m.filter((r) => r.wallet).map((r) => (r.wallet as string).toLowerCase())).size,
  };
}
