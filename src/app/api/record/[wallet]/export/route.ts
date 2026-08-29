import { NextResponse } from "next/server";

import { advanceCapacityUsd, walletCreditSignals } from "@/lib/campaigns/credit";
import { isRecordPrivate } from "@/lib/campaigns/record-preference";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/record/<wallet>/export — the verified cash-flow file, as CSV.
 *
 * A credit officer does not consume JSON. They open a spreadsheet, sort it, and check a few rows
 * against the chain. So this is the same record served as something they can actually work with:
 * a summary block of the underwriting inputs, then one row per verified payout with the transaction
 * that settled it.
 *
 * EVERY ROW IS CHECKABLE WITHOUT TRUSTING SAGE. The transaction hash and its receipt URL are in the
 * file; a lender can verify any line independently, which is the entire point of underwriting
 * against this rather than against a self-reported statement.
 *
 * PRIVACY IS HONOURED HERE TOO. If the earner has withheld amounts, the export carries the dates,
 * counts, counterparties and transactions but no figures — and says so in the file rather than
 * shipping blank columns that look like missing data. A lender who needs the numbers asks the
 * earner for a signed attestation.
 */
const esc = (v: string | number | null): string => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ wallet: string }> },
): Promise<NextResponse | Response> {
  const { wallet } = await ctx.params;
  const out = walletCreditSignals(wallet);
  if (!out) {
    return NextResponse.json({ ok: false, error: "not a valid wallet address" }, { status: 400 });
  }
  const { record, signals } = out;
  const withheld = isRecordPrivate(record.wallet);

  // The multiple is the LENDER's, supplied per request. Sage picks none — it states the verified
  // inflow and applies whatever arithmetic the reader asks for, published in the file.
  const multipleRaw = new URL(req.url).searchParams.get("multiple");
  const multiple = multipleRaw !== null && Number.isFinite(Number(multipleRaw)) ? Number(multipleRaw) : null;

  const lines: string[] = [];
  lines.push("Sage — verified work record");
  lines.push(`wallet,${esc(record.wallet)}`);
  lines.push(`generated,${esc(new Date().toISOString())}`);
  lines.push(`formula,${esc(signals.formulaVersion)}`);
  lines.push(`source,${esc(`${siteUrl()}/record/${record.wallet}`)}`);
  lines.push("");

  lines.push("Underwriting inputs");
  lines.push("metric,value,note");
  const row = (k: string, v: string | number | null, note = "") =>
    lines.push(`${esc(k)},${esc(v)},${esc(note)}`);

  row("verified completions", signals.completions, "payouts that passed verification");
  row("completions, last 30d", signals.completions30d);
  row("completions, last 90d", signals.completions90d);
  row("distinct payers", signals.distinctPayers, "separate counterparties");
  row(
    "largest payer share",
    signals.topPayerShare === null ? null : signals.topPayerShare.toFixed(3),
    "1.000 = a single counterparty",
  );
  row(
    "payer concentration (HHI)",
    signals.payerConcentration === null ? null : signals.payerConcentration.toFixed(3),
    "1.000 = fully concentrated",
  );
  row("months active", signals.monthsActive);
  row("tenure (days)", signals.tenureDays);
  row("days since last verified payout", signals.daysSinceLastVerified);
  row(
    "verification pass rate",
    signals.verificationPassRate === null ? null : signals.verificationPassRate.toFixed(3),
    `over ${signals.decidedSubmissions} judged submissions`,
  );

  if (withheld) {
    row("verified inflow", null, "WITHHELD by the earner — request a signed attestation");
    row("inflow, last 30d", null, "WITHHELD");
    row("inflow, last 90d", null, "WITHHELD");
  } else {
    row("verified inflow (lifetime)", signals.verifiedInflowUsd.toFixed(2), "USD");
    row("inflow, last 30d", signals.inflow30dUsd.toFixed(2), "USD");
    row("inflow, last 90d", signals.inflow90dUsd.toFixed(2), "USD");
    if (multiple !== null) {
      row(
        `advance capacity @ ${multiple}x monthly`,
        advanceCapacityUsd(signals, multiple).toFixed(2),
        "YOUR multiple applied to 90d inflow / 3. Sage computes no credit score.",
      );
    }
  }
  lines.push("");

  lines.push("Verified payouts");
  lines.push(
    withheld
      ? "date,kind,campaign,mission,amount_usd,transaction,receipt"
      : "date,kind,campaign,mission,amount_usd,transaction,receipt",
  );
  for (const e of record.entries) {
    lines.push(
      [
        esc(new Date(e.at * 1000).toISOString().slice(0, 10)),
        esc(e.kind),
        esc(e.campaignTitle),
        esc(e.missionTitle ?? ""),
        esc(withheld ? "" : e.amountUsd.toFixed(2)),
        esc(e.txHash),
        esc(`${siteUrl()}${e.proofPath}`),
      ].join(","),
    );
  }
  lines.push("");
  lines.push(
    withheld
      ? "Amounts withheld by the earner. Every transaction above is verifiable on-chain."
      : "Every transaction above is verifiable on-chain. Sage states facts and computes no credit score.",
  );

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sage-work-record-${record.wallet.slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
