import { NextResponse } from "next/server";

import { walletCreditSignals } from "@/lib/campaigns/credit";
import { isRecordPrivate } from "@/lib/campaigns/record-preference";
import { publicRecord, publicSignals } from "@/lib/campaigns/record-privacy";
import { siteUrl } from "@/lib/site";
import { publicAdvances } from "@/lib/advance/public";
import { buildLinkedRecord } from "@/lib/campaigns/wallet-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/record/<wallet> — the Verified Work Record + Sage Signals, machine-readable.
 *
 * PUBLIC BY DEFAULT. Receipts are the point of this record when the money is grant or MSME
 * capital: a programme distributing funds has to be able to show where they went, down to the
 * amount and the transaction. Auditability is not a compromise here, it is the product.
 *
 * PRIVATE WHEN THE WORKER CHOOSES IT. Someone paid through Sage should not have to carry a
 * permanent public income graph as the price of getting paid. When they turn amounts off, this
 * serves the same record with every figure withheld — the completions, the counterparties, the
 * months, the pass rate and every transaction hash all remain, so the work stays provable while
 * the income stops being published. They prove figures with a scoped attestation instead.
 *
 * v3 is ADDITIVE over v2, not a break: a public record carries everything v2 did, plus
 * `amountsWithheld: false`. A v2 consumer reading `totalUsd` keeps working. Only a record whose
 * owner asked for privacy omits the money.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ wallet: string }> },
): Promise<NextResponse> {
  const { wallet } = await ctx.params;
  const out = walletCreditSignals(wallet);
  if (!out) {
    return NextResponse.json({ ok: false, error: "not a valid wallet address" }, { status: 400 });
  }
  const { record, signals } = out;
  const withheld = isRecordPrivate(record.wallet);

  const base = {
    ok: true as const,
    schema: "sage.work-record.v4",
    generatedAt: Math.floor(Date.now() / 1000),
    recordUrl: `${siteUrl()}/record/${record.wallet}`,
  };

  /**
   * v4 adds `advances` — the facility history through its one redaction boundary (publicAdvances):
   * secrets never leave, and under a privacy choice the FIGURES withhold while the FACT remains,
   * because "an advance existed and repaid from verified inflow" is the credit signal
   * collateral-based lending never produces, and it survives redaction.
   */
  const advancesOut = publicAdvances(record.wallet, { amountsWithheld: withheld });
  // ONE BUSINESS, MANY RAILS — the wallets this one is linked to, with the same published formulas
  // run over the union. Amounts are withheld whenever ANY linked wallet keeps its amounts private:
  // a private wallet must not become readable through a public one it is linked to.
  const lk = buildLinkedRecord(record.wallet);
  const linkedWithheld = withheld || (lk?.wallets ?? []).some((w) => isRecordPrivate(w));
  const linked =
    lk && lk.wallets.length > 1
      ? {
          wallets: lk.wallets,
          amountsWithheld: linkedWithheld,
          completions: lk.record.completions,
          distinctCampaigns: lk.record.distinctCampaigns,
          distinctPayers: lk.signals.distinctPayers,
          monthsActive: lk.signals.monthsActive,
          verificationPassRate: lk.signals.verificationPassRate,
          ...(linkedWithheld ? {} : { totalUsd: lk.record.totalUsd, signals: lk.signals }),
        }
      : null;

  if (!withheld) {
    return NextResponse.json({
      ...base,
      ...record,
      amountsWithheld: false,
      entries: record.entries.map((e) => ({ ...e, proofUrl: `${siteUrl()}${e.proofPath}` })),
      signals,
      advances: advancesOut,
    linked,
    });
  }

  const pub = publicRecord(record);
  return NextResponse.json({
    ...base,
    ...pub,
    entries: pub.entries.map((e) => ({ ...e, proofUrl: `${siteUrl()}${e.proofPath}` })),
    signals: publicSignals(signals, record),
    advances: advancesOut,
    linked,
    disclosure: {
      note: "This worker has chosen not to publish payout amounts. Every entry is anchored to a transaction anyone can verify, so the payments remain provable without the income being public.",
      howToObtainAmounts: `${siteUrl()}/record/${pub.wallet}#disclosure`,
    },
  });
}
