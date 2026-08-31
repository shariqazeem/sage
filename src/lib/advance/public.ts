import { advanceHistory } from "@/lib/db/advances";
import { starknetTxUrl } from "@/lib/starknet/explorer";

/**
 * THE ADVANCE FACILITY, AS THE WORLD MAY SEE IT.
 *
 * One redaction boundary for every public surface — the record page, the record API, the lender
 * view — so no caller can accidentally serve a secret. Two things never leave this module:
 * claim secrets (bearer cash, the borrower's disbursement link and the pot's repayment legs), and,
 * when the earner has withheld amounts, the figures — an advance is income-shaped money, and a
 * privacy choice that hid the payouts while publishing the loan against them would be no choice.
 *
 * What ALWAYS shows, because it is the lender's actual question: that an advance existed, its
 * terms' shape, and that it repaid — on time, from verified inflow, with every escrow transaction
 * checkable. Repayment history is the one credit signal collateral-based lending never produces.
 */

export interface PublicRepayment {
  atUnix: number;
  amountUsd: number | null;
  escrowTx: string;
  escrowTxUrl: string | null;
  submissionId: string;
}

export interface PublicAdvance {
  id: string;
  status: "active" | "repaid" | "written_off";
  createdAtUnix: number;
  repaidAtUnix: number | null;
  /** null when the earner withholds amounts. */
  principalUsd: number | null;
  outstandingUsd: number | null;
  /** the published terms — shape, not judgement. */
  terms: { multipleOfMonthlyInflow: number; waterfallPct: number };
  disburseTx: string | null;
  disburseTxUrl: string | null;
  repayments: PublicRepayment[];
}

const usd = (base: number): number => Math.round(base / 10_000) / 100;

export function publicAdvances(wallet: string, opts: { amountsWithheld: boolean }): PublicAdvance[] {
  return advanceHistory(wallet).map((a) => ({
    id: a.id,
    status: a.status,
    createdAtUnix: a.createdAt,
    repaidAtUnix: a.repaidAt,
    principalUsd: opts.amountsWithheld ? null : usd(a.principalBase),
    outstandingUsd: opts.amountsWithheld ? null : usd(a.outstandingBase),
    terms: { multipleOfMonthlyInflow: a.multiple, waterfallPct: a.waterfallBps / 100 },
    disburseTx: a.disburseTx,
    disburseTxUrl: starknetTxUrl(a.disburseTx),
    repayments: a.repayments.map((r) => ({
      atUnix: r.createdAt,
      amountUsd: opts.amountsWithheld ? null : usd(r.amountBase),
      escrowTx: r.escrowTx,
      escrowTxUrl: starknetTxUrl(r.escrowTx),
      submissionId: r.submissionId,
    })),
  }));
}
