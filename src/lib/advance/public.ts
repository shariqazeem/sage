import { advanceHistory } from "@/lib/db/advances";
import { explorerTxUrl, METIS_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";
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
  /** the transaction that moved it: an escrow on Starknet, the pot's collection on Metis. */
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
  /** the network it lives on: "Metis" since 26 Oct 2026, "Starknet" before. */
  network: "Metis" | "Starknet";
  repayments: PublicRepayment[];
  /** verified payouts whose share could not be collected (approval withdrawn, money moved): counted, never hidden. */
  missedPayouts: number;
}

const usd = (base: number): number => Math.round(base / 10_000) / 100;

/** A transaction's explorer link on the advance's own network. */
const txUrl = (chainId: number, tx: string | null): string | null =>
  !tx ? null : chainId === METIS_MAINNET_CHAIN_ID ? explorerTxUrl(METIS_MAINNET_CHAIN_ID, tx) : starknetTxUrl(tx);

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
    disburseTxUrl: txUrl(a.chainId, a.disburseTx),
    network: a.chainId === METIS_MAINNET_CHAIN_ID ? ("Metis" as const) : ("Starknet" as const),
    repayments: a.repayments
      .filter((r): r is typeof r & { escrowTx: string } => !!r.escrowTx && r.amountBase > 0)
      .map((r) => ({
        atUnix: r.createdAt,
        amountUsd: opts.amountsWithheld ? null : usd(r.amountBase),
        escrowTx: r.escrowTx,
        escrowTxUrl: txUrl(a.chainId, r.escrowTx),
        submissionId: r.submissionId,
      })),
    missedPayouts: a.repayments.filter((r) => !r.escrowTx || r.amountBase <= 0).length,
  }));
}
