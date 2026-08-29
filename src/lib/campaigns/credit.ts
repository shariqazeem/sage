import "server-only";

import { getCampaign } from "@/lib/db/campaigns";
import { countDecidedSubmissionsByWallet } from "@/lib/db/campaigns";
import { buildWalletRecord, type WalletRecord } from "./record";

/**
 * SAGE SIGNALS — the credit layer over the Verified Work Record (FC plan #1, the track's CORE ask:
 * "aggregate fragmented business data → real-time credit profiles → lending without collateral").
 *
 * DESIGN RULE, same one that governs money: NO MODEL — and no invented composite score — computes
 * creditworthiness here. Every signal is a deterministic, PUBLISHED formula over receipt-anchored
 * rows (the same rows buildWalletRecord admits: paid + tx-anchored + non-sandbox, plus the decided
 * counts for the pass rate). A lender feeds these into their OWN underwriting; Sage states facts
 * it can prove and nothing else. A thin file that is TRUE beats a thick one that is self-reported.
 *
 * Versioned as credit-signals-v1: change a formula → bump the version, never silently.
 */

export const CREDIT_SIGNALS_VERSION = "credit-signals-v2";

export interface CreditSignals {
  formulaVersion: string;
  /** Σ amountUsd over receipt-anchored entries. */
  verifiedInflowUsd: number;
  /** count of receipt-anchored entries. */
  completions: number;
  /** distinct campaigns paid from. */
  distinctCampaigns: number;
  /** distinct FUNDER wallets that paid this wallet — breadth of counterparties. */
  distinctPayers: number;
  /** distinct UTC calendar months (YYYY-MM) containing ≥1 verified payout. */
  monthsActive: number;
  /** verifiedInflowUsd / monthsActive (0 when no months). */
  avgInflowPerActiveMonthUsd: number;
  /** paid / (paid + rejected) over DECIDED submissions; null when nothing decided.
   *  Pending/held work is undecided and never counted. */
  verificationPassRate: number | null;
  decidedSubmissions: number;
  /** whole days since the newest verified payout; null when none. */
  daysSinceLastVerified: number | null;
  /** whole days since the first verified payout; null when none. */
  tenureDays: number | null;
  /** verified inflow split by campaign kind. */
  byKindUsd: { testing: number; gig: number; grant: number };

  /* ── Recency. A lender underwrites cash flow NOW, not a lifetime total. ──────────────────── */
  /** verified inflow in the last 30 days. */
  inflow30dUsd: number;
  /** verified inflow in the last 90 days — the window most working-capital advances price against. */
  inflow90dUsd: number;
  completions30d: number;
  completions90d: number;

  /* ── Concentration. Ten jobs from one payer is not the same risk as ten from six. ────────── */
  /**
   * Share of verified inflow from the single largest payer, 0..1. Null when nothing is attributable
   * to a payer. A high value is not a bad score — it is a fact a lender prices.
   */
  topPayerShare: number | null;
  /**
   * Herfindahl-Hirschman index over payers, normalised 0..1: 1 means a single counterparty, and it
   * falls as income spreads. Reported because "6 payers" hides whether one of them is 95% of it.
   */
  payerConcentration: number | null;
}

/**
 * How much working capital this cash flow supports, at a multiple THE LENDER chooses.
 *
 * Sage states facts and computes no creditworthiness verdict — the same rule that keeps models away
 * from money keeps an invented score off this page. So this is deliberately not "Sage's advance
 * offer": the lender supplies the multiple, this applies it to a verified 90-day inflow, and the
 * arithmetic is published so the number can be checked rather than trusted.
 */
export function advanceCapacityUsd(
  signals: Pick<CreditSignals, "inflow90dUsd">,
  multipleOfMonthlyInflow: number,
): number {
  if (!(multipleOfMonthlyInflow > 0)) return 0;
  const monthly = signals.inflow90dUsd / 3;
  return round2(monthly * multipleOfMonthlyInflow);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const utcMonth = (unixSec: number): string => new Date(unixSec * 1000).toISOString().slice(0, 7);

/** PURE — everything derived from the record + decided counts + an injected clock. */
export function computeCreditSignals(
  record: WalletRecord,
  decided: { paid: number; rejected: number },
  payerOf: (campaignId: string) => string | null,
  nowSec: number,
): CreditSignals {
  const months = new Set(record.entries.map((e) => utcMonth(e.at)));
  const payers = new Set<string>();
  for (const e of record.entries) {
    const p = payerOf(e.campaignId);
    if (p) payers.add(p.toLowerCase());
  }
  const byKindUsd = { testing: 0, gig: 0, grant: 0 };
  for (const e of record.entries) byKindUsd[e.kind] = round2(byKindUsd[e.kind] + e.amountUsd);

  // Inflow by payer, for concentration. Entries with no attributable payer are excluded from the
  // shares rather than lumped together, which would invent a counterparty that does not exist.
  const byPayer = new Map<string, number>();
  for (const e of record.entries) {
    const payer = payerOf(e.campaignId)?.toLowerCase();
    if (payer) byPayer.set(payer, (byPayer.get(payer) ?? 0) + e.amountUsd);
  }
  const attributed = [...byPayer.values()].reduce((a, b) => a + b, 0);
  const topPayerShare = attributed > 0 ? Math.max(...byPayer.values()) / attributed : null;
  const payerConcentration =
    attributed > 0
      ? [...byPayer.values()].reduce((sum, v) => sum + (v / attributed) ** 2, 0)
      : null;

  const decidedCount = decided.paid + decided.rejected;
  const day = 86_400;
  const within = (days: number) => record.entries.filter((e) => nowSec - e.at <= days * day);
  const sumOf = (es: typeof record.entries) => round2(es.reduce((s, e) => s + e.amountUsd, 0));
  const last30 = within(30);
  const last90 = within(90);
  return {
    formulaVersion: CREDIT_SIGNALS_VERSION,
    verifiedInflowUsd: record.totalUsd,
    completions: record.completions,
    distinctCampaigns: record.distinctCampaigns,
    distinctPayers: payers.size,
    monthsActive: months.size,
    avgInflowPerActiveMonthUsd: months.size ? round2(record.totalUsd / months.size) : 0,
    verificationPassRate: decidedCount ? Math.round((decided.paid / decidedCount) * 1000) / 1000 : null,
    decidedSubmissions: decidedCount,
    daysSinceLastVerified: record.lastAt ? Math.max(0, Math.floor((nowSec - record.lastAt) / day)) : null,
    tenureDays: record.firstAt ? Math.max(0, Math.floor((nowSec - record.firstAt) / day)) : null,
    byKindUsd,
    inflow30dUsd: sumOf(last30),
    inflow90dUsd: sumOf(last90),
    completions30d: last30.length,
    completions90d: last90.length,
    topPayerShare: topPayerShare === null ? null : Math.round(topPayerShare * 1000) / 1000,
    payerConcentration:
      payerConcentration === null ? null : Math.round(payerConcentration * 1000) / 1000,
  };
}

/** IO wrapper: record + decided counts + payer lookup from the real DB. Null on a non-address. */
export function walletCreditSignals(walletRaw: string, nowSec = Math.floor(Date.now() / 1000)): { record: WalletRecord; signals: CreditSignals } | null {
  const record = buildWalletRecord(walletRaw);
  if (!record) return null;
  const decided = countDecidedSubmissionsByWallet(record.wallet);
  return {
    record,
    signals: computeCreditSignals(record, decided, (id) => getCampaign(id)?.posterWallet ?? null, nowSec),
  };
}
