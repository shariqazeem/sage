"use client";

import { useCallback, useState } from "react";
import { ArrowRight, Download, Loader2, Search } from "lucide-react";

/**
 * THE LENDER VIEW — one page where a credit officer decides whether to advance against verified
 * cash flow.
 *
 * The record page is written for the earner: it is their history, their receipts, their choice
 * about privacy. This is written for the person on the other side of the table, who has a
 * different question — not "what have I done" but "can I lend against this, and how much".
 *
 * SAGE COMPUTES NO SCORE, AND THIS PAGE IS WHERE THAT DISCIPLINE COSTS SOMETHING. It would be easy
 * to print a number and call it creditworthiness; every lending product does. But Sage has no
 * business judging a borrower it has never met, and a score invented from four signals would be
 * exactly the kind of confident fiction this product exists against. So the multiple is the
 * lender's input, the arithmetic is shown, and the output is labelled as their calculation rather
 * than our recommendation.
 *
 * What Sage does claim is narrower and defensible: every row is a payment that happened, verified
 * before it moved, and checkable on-chain without trusting us.
 */

interface Signals {
  formulaVersion: string;
  completions: number;
  completions30d: number;
  completions90d: number;
  distinctPayers: number;
  monthsActive: number;
  verificationPassRate: number | null;
  decidedSubmissions: number;
  daysSinceLastVerified: number | null;
  tenureDays: number | null;
  topPayerShare: number | null;
  payerConcentration: number | null;
  verifiedInflowUsd?: number;
  inflow30dUsd?: number;
  inflow90dUsd?: number;
  amountsWithheld?: boolean;
}

interface Entry {
  at: number;
  campaignTitle: string;
  missionTitle: string | null;
  kind: string;
  amountUsd?: number;
  txHash: string;
  proofUrl: string;
}

interface RecordResponse {
  ok: boolean;
  error?: string;
  wallet: string;
  completions: number;
  amountsWithheld: boolean;
  entries: Entry[];
  signals: Signals;
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const usd = (v: number | undefined) =>
  v === undefined ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function LenderClient() {
  const [wallet, setWallet] = useState("");
  const [multiple, setMultiple] = useState("2");
  const [data, setData] = useState<RecordResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const look = useCallback(async () => {
    const w = wallet.trim();
    if (!w) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/record/${encodeURIComponent(w)}`);
      const body = (await res.json()) as RecordResponse;
      if (!res.ok || !body.ok) throw new Error(body.error ?? "That wallet could not be read.");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That wallet could not be read.");
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  const m = Number(multiple);
  const monthly = data?.signals.inflow90dUsd !== undefined ? data.signals.inflow90dUsd / 3 : null;
  const capacity = monthly !== null && Number.isFinite(m) && m > 0 ? monthly * m : null;

  return (
    <div className="lend-wrap">
      <header className="lend-head">
        <p className="lend-kicker">For lenders</p>
        <h1 className="lend-title">Underwrite verified cash flow.</h1>
        <p className="lend-lede">
          Paste a wallet. You get the payment history behind it — every job verified before the
          money moved, every row anchored to a transaction you can check yourself. Sage states the
          facts and computes no credit score; the multiple below is yours.
        </p>
      </header>

      <div className="lend-search">
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void look()}
          placeholder="0x… wallet address"
          spellCheck={false}
          autoComplete="off"
          aria-label="Wallet address"
        />
        <button onClick={() => void look()} disabled={loading || !wallet.trim()}>
          {loading ? (
            <>
              <Loader2 className="lend-spin" size={15} aria-hidden /> Reading
            </>
          ) : (
            <>
              <Search size={15} aria-hidden /> Look up
            </>
          )}
        </button>
      </div>

      {error ? (
        <p className="lend-error" role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          {data.completions === 0 ? (
            <p className="lend-empty">
              No verified payouts for this wallet. That is not a bad credit signal — it is no signal
              at all, and it should not be read as one.
            </p>
          ) : (
            <>
              <section className="lend-grid" aria-label="Underwriting inputs">
                <div className="lend-cell">
                  <div className="lend-v">{data.signals.completions90d}</div>
                  <div className="lend-k">Verified jobs, 90d</div>
                  <div className="lend-n">
                    {data.signals.completions} lifetime · {data.signals.completions30d} in 30d
                  </div>
                </div>
                <div className="lend-cell">
                  <div className="lend-v">
                    {data.amountsWithheld ? "—" : usd(data.signals.inflow90dUsd)}
                  </div>
                  <div className="lend-k">Verified inflow, 90d</div>
                  <div className="lend-n">
                    {data.amountsWithheld
                      ? "withheld by the earner"
                      : `${usd(data.signals.inflow30dUsd)} in 30d`}
                  </div>
                </div>
                <div className="lend-cell">
                  <div className="lend-v">{pct(data.signals.verificationPassRate)}</div>
                  <div className="lend-k">Verification pass rate</div>
                  <div className="lend-n">over {data.signals.decidedSubmissions} judged</div>
                </div>
                <div className="lend-cell">
                  <div className="lend-v">{pct(data.signals.topPayerShare)}</div>
                  <div className="lend-k">Largest funder share</div>
                  <div className="lend-n">
                    {data.signals.distinctPayers} distinct funder
                    {data.signals.distinctPayers === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="lend-cell">
                  <div className="lend-v">
                    {data.signals.daysSinceLastVerified === null
                      ? "—"
                      : data.signals.daysSinceLastVerified === 0
                        ? "today"
                        : `${data.signals.daysSinceLastVerified}d`}
                  </div>
                  <div className="lend-k">Since last payout</div>
                  <div className="lend-n">
                    {data.signals.tenureDays === null ? "—" : `${data.signals.tenureDays}d tenure`}
                  </div>
                </div>
                <div className="lend-cell">
                  <div className="lend-v">{data.signals.monthsActive}</div>
                  <div className="lend-k">Months active</div>
                  <div className="lend-n">{data.signals.formulaVersion}</div>
                </div>
              </section>

              {/* THE CALCULATION IS THEIRS. Sage supplies verified inflow; the lender supplies the
                  multiple and owns the output. Printing a number here and calling it a credit
                  decision would be the confident fiction this product exists against. */}
              <section className="lend-calc" aria-label="Advance capacity">
                <div className="lend-calc-row">
                  <label htmlFor="mult">Your multiple, on verified monthly inflow</label>
                  <input
                    id="mult"
                    type="number"
                    min="0"
                    step="0.25"
                    value={multiple}
                    onChange={(e) => setMultiple(e.target.value)}
                    disabled={data.amountsWithheld}
                  />
                </div>
                {data.amountsWithheld ? (
                  <p className="lend-calc-note">
                    This earner has withheld their amounts. The activity above is still verified and
                    checkable — to price it, ask them for a signed statement of earnings, which
                    proves a floor without publishing the figure.
                  </p>
                ) : (
                  <>
                    <p className="lend-calc-out">
                      {capacity === null ? "—" : usd(capacity)}
                      <span>
                        = {usd(monthly ?? undefined)} monthly × {Number.isFinite(m) ? m : 0}
                      </span>
                    </p>
                    <p className="lend-calc-note">
                      Your calculation, not Sage&rsquo;s recommendation. Sage computes no credit
                      score — it reports verified inflow and shows the arithmetic so you can check
                      it rather than trust it.
                    </p>
                  </>
                )}
              </section>

              <section className="lend-rows" aria-label="Verified payouts">
                <div className="lend-rows-h">
                  <span>Verified payouts</span>
                  <a href={`/api/record/${data.wallet}/export?multiple=${encodeURIComponent(multiple)}`}>
                    <Download size={14} aria-hidden /> CSV
                  </a>
                </div>
                <ul>
                  {data.entries.slice(0, 25).map((e) => (
                    <li key={e.txHash}>
                      <span className="lend-when">
                        {new Date(e.at * 1000).toISOString().slice(0, 10)}
                      </span>
                      <span className="lend-what">
                        {e.missionTitle ?? e.campaignTitle}
                        <small>{e.campaignTitle}</small>
                      </span>
                      <span className="lend-amt">
                        {e.amountUsd === undefined ? "verified" : usd(e.amountUsd)}
                      </span>
                      <a href={e.proofUrl} target="_blank" rel="noreferrer noopener">
                        receipt <ArrowRight size={12} aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
