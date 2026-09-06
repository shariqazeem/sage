import type { Metadata } from "next";
import Link from "next/link";
import { createHash } from "node:crypto";
import "./statement.css";
import { walletCreditSignals } from "@/lib/campaigns/credit";
import { isRecordPrivate } from "@/lib/campaigns/record-preference";
import { getCampaign } from "@/lib/db/campaigns";
import { short, shortDateUTC } from "@/lib/format";
import { siteUrl } from "@/lib/site";
import { PrintButton } from "./print-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE DOCUMENT A WORKER HANDS TO A BANK. Every line is a settled transaction a loan officer can
 * check without taking Sage's word for it; the digest at the bottom is the SHA-256 of the record
 * as served at /api/record/<wallet>, so a printed copy can be matched against the live one.
 */
export async function generateMetadata({ params }: { params: Promise<{ wallet: string }> }): Promise<Metadata> {
  const { wallet } = await params;
  return { title: `Verified income statement · ${short(wallet)} · Sage`, robots: { index: false } };
}

const usd = (v: number) => `$${v.toFixed(2)}`;
const railOf = (chainId: number) => (chainId === 900001 ? "Starknet" : chainId === 2345 ? "GOAT Network" : `chain ${chainId}`);

export default async function StatementPage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const out = walletCreditSignals(wallet);
  if (!out) {
    return <main className="st"><h1>No record</h1><p>Nothing verified has been paid to this wallet yet.</p></main>;
  }
  const { record, signals } = out;
  const withheld = isRecordPrivate(record.wallet);
  const entries = [...record.entries].sort((a, b) => b.at - a.at);
  const payers = new Map<string, string>();
  // THE OBLIGATION'S OWN CURRENCY: when the buyer priced the work in J$ or TT$, the statement says
  // so beside the settled dollars, at the rate stamped when it was composed — what a local bank reads.
  const local = new Map<string, { currency: string; rate: number }>();
  for (const e of entries) {
    if (!payers.has(e.campaignId)) {
      const c = getCampaign(e.campaignId);
      payers.set(e.campaignId, c?.posterWallet ?? "—");
      if (c?.currency && c.currency !== "USD" && c.rate) local.set(e.campaignId, { currency: c.currency, rate: c.rate });
    }
  }
  const anyLocal = local.size > 0;
  const fmtLocal = (usdAmt: number, l: { currency: string; rate: number }) => `${l.currency} ${(usdAmt * l.rate).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const digest = createHash("sha256").update(JSON.stringify(entries.map((e) => [e.at, e.campaignId, e.amountUsd, e.txHash, e.chainId]))).digest("hex");
  const generated = new Date();
  const base = siteUrl();
  const months = new Map<string, number>();
  for (const e of entries) { const k = new Date(e.at * 1000).toISOString().slice(0, 7); months.set(k, (months.get(k) ?? 0) + e.amountUsd); }
  return (
    <main className="st">
      <header className="st-head">
        <div className="st-brand"><i>S</i> Sage · sagepays.xyz</div>
        <div className="st-title"><h1>Verified income statement</h1><p>generated {generated.toISOString().slice(0, 10)} · all amounts USDC</p></div>
      </header>
      <dl className="st-meta">
        <div><dt>Account</dt><dd>{record.wallet}</dd></div>
        <div><dt>Period</dt><dd>{record.firstAt ? shortDateUTC(record.firstAt, true) : "—"} → {record.lastAt ? shortDateUTC(record.lastAt, true) : "—"}</dd></div>
        <div><dt>Verified payments</dt><dd>{record.completions} across {record.distinctCampaigns} engagements · {signals.distinctPayers} distinct payers</dd></div>
        <div><dt>Live record</dt><dd>{base}/record/{record.wallet}</dd></div>
      </dl>
      <div className="st-sum">
        <div><p className="v">{withheld ? "withheld" : usd(record.totalUsd)}</p><p className="k">total verified inflow</p></div>
        <div><p className="v">{withheld ? "withheld" : usd(signals.inflow90dUsd)}</p><p className="k">verified inflow, 90 days</p></div>
        <div><p className="v">{signals.verificationPassRate === null ? "—" : `${Math.round(signals.verificationPassRate * 100)}%`}</p><p className="k">verification pass rate</p></div>
        <div><p className="v">{signals.monthsActive}</p><p className="k">months active</p></div>
        <div><p className="v">{signals.topPayerShare === null ? "—" : `${Math.round(signals.topPayerShare * 100)}%`}</p><p className="k">largest payer share</p></div>
      </div>
      {withheld && <p className="st-note st-withheld">The account holder has chosen to withhold amounts from public view. Counts, dates and transactions are shown; the holder can print the full statement while signed in.</p>}
      <h2>Verified payments</h2>
      <table>
        <thead><tr><th>Date</th><th>Payer</th><th>Engagement</th><th>Kind</th><th>Rail</th><th>Transaction</th><th style={{ textAlign: "right" }}>Amount</th>{anyLocal && <th style={{ textAlign: "right" }}>Priced in</th>}</tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.txHash}>
              <td>{shortDateUTC(e.at, true)}</td>
              <td className="m">{payers.get(e.campaignId) ? short(payers.get(e.campaignId) as string) : "—"}</td>
              <td>{e.campaignTitle}{e.missionTitle ? ` · ${e.missionTitle}` : ""}</td>
              <td>{e.kind}</td>
              <td>{railOf(e.chainId)}</td>
              <td className="m"><Link href={e.proofPath}>{short(e.txHash)}</Link></td>
              <td className="n">{withheld ? "withheld" : usd(e.amountUsd)}</td>
              {anyLocal && <td className="n">{!withheld && local.get(e.campaignId) ? fmtLocal(e.amountUsd, local.get(e.campaignId)!) : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!withheld && months.size > 1 && (
        <>
          <h2>By month</h2>
          <table><tbody>{[...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([m, v]) => <tr key={m}><td>{m}</td><td className="n">{usd(v)}</td></tr>)}</tbody></table>
        </>
      )}
      <div className="st-verify">
        <b>How to verify this statement.</b> Every line is a settlement on a public ledger. Open any transaction above, or compare the live record at <code>{base}/api/record/{record.wallet}</code>. Record digest: <code>sha256 {digest}</code>. The credit signals follow the published formula <code>{signals.formulaVersion}</code>; Sage computes no score.
      </div>
      <p className="st-note">Sage is an AI agent that pays people for verified work. Payments are settled in USDC on public ledgers; this statement is derived from those settlements and from nothing else. It is not a bank statement and Sage is not a bank. Sanctions screening applies to every payment path.</p>
      <PrintButton />
    </main>
  );
}
