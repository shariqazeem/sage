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

interface AdvanceOut {
  id: string;
  status: "active" | "repaid" | "written_off";
  createdAtUnix: number;
  principalUsd: number | null;
  outstandingUsd: number | null;
  terms: { multipleOfMonthlyInflow: number; waterfallPct: number };
  repayments: Array<{ atUnix: number; amountUsd: number | null; escrowTxUrl: string | null }>;
}

interface RecordResponse {
  ok: boolean;
  error?: string;
  wallet: string;
  completions: number;
  amountsWithheld: boolean;
  entries: Entry[];
  signals: Signals;
  advances?: AdvanceOut[];
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

  const [attPaste, setAttPaste] = useState("");
  const [attVerdict, setAttVerdict] = useState<null | {
    valid: boolean; reason: string | null; subject: string; expiresAt: number;
    claims: { earnedAtLeastUsd?: number; completions: number; monthsActive: number; verificationPassRate: number | null };
    anchorsCount: number; expectedIssuer: string;
  }>(null);
  const [attError, setAttError] = useState<string | null>(null);
  const [attChecking, setAttChecking] = useState(false);

  const verifyAtt = useCallback(async () => {
    setAttError(null);
    setAttVerdict(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(attPaste);
    } catch {
      setAttError("That isn't valid JSON — paste the whole attestation document.");
      return;
    }
    setAttChecking(true);
    try {
      const res = await fetch("/api/attest/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attestation: parsed }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string } & NonNullable<typeof attVerdict>;
      if (!res.ok || !j.ok) throw new Error(j.error ?? "That could not be verified.");
      setAttVerdict(j);
    } catch (e) {
      setAttError(e instanceof Error ? e.message : "That could not be verified.");
    } finally {
      setAttChecking(false);
    }
  }, [attPaste]);

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
                  <div className="lend-att">
                    <p className="lend-calc-note">
                      This earner has withheld their amounts — the activity above stays verified
                      and checkable. To price it, ask them for their <b>signed earnings floor</b>
                      (they issue it on their own record page) and paste it here:
                    </p>
                    <textarea
                      value={attPaste}
                      onChange={(e) => setAttPaste(e.target.value)}
                      placeholder='{"schema":"sage.earnings-attestation.v1", …}'
                      rows={4}
                      spellCheck={false}
                      aria-label="Paste the earner's signed attestation"
                    />
                    <button onClick={() => void verifyAtt()} disabled={attChecking || !attPaste.trim()}>
                      {attChecking ? "Verifying…" : "Verify the attestation"}
                    </button>
                    {attError && <p className="lend-error" role="alert">{attError}</p>}
                    {attVerdict && !attVerdict.valid && (
                      <p className="lend-error" role="alert">
                        NOT valid — {attVerdict.reason}. Do not lend against this document.
                      </p>
                    )}
                    {attVerdict?.valid && (
                      <div className="lend-att-ok">
                        {attVerdict.subject.toLowerCase() !== data.wallet.toLowerCase() && (
                          <p className="lend-error" role="alert">
                            Valid signature, WRONG wallet: this attestation is for{" "}
                            {attVerdict.subject.slice(0, 10)}…, not the record you looked up.
                          </p>
                        )}
                        <p className="lend-att-line">
                          <b>Verified:</b> lifetime earnings{" "}
                          {attVerdict.claims.earnedAtLeastUsd !== undefined
                            ? `≥ $${attVerdict.claims.earnedAtLeastUsd.toFixed(2)}`
                            : "floor not stated"}{" "}
                          · {attVerdict.claims.completions} completions ·{" "}
                          {attVerdict.anchorsCount} on-chain anchors · expires{" "}
                          {new Date(attVerdict.expiresAt * 1000).toISOString().slice(0, 10)}
                        </p>
                        {attVerdict.claims.earnedAtLeastUsd !== undefined &&
                          attVerdict.claims.monthsActive > 0 && (
                            <p className="lend-att-line lend-att-arith">
                              Your arithmetic, floors only: ≥ $
                              {(attVerdict.claims.earnedAtLeastUsd / attVerdict.claims.monthsActive).toFixed(2)}
                              /active month (floor ÷ {attVerdict.claims.monthsActive} active months)
                              × your multiple {Number.isFinite(m) ? m : 0} = capacity ≥ $
                              {Number.isFinite(m)
                                ? ((attVerdict.claims.earnedAtLeastUsd / attVerdict.claims.monthsActive) * m).toFixed(2)
                                : "0.00"}
                              . A floor, never the figure — that is the point.
                            </p>
                          )}
                        <p className="lend-att-issuer">
                          Signed by Sage&rsquo;s published issuer {attVerdict.expectedIssuer.slice(0, 10)}… —
                          reproducible off-platform with any EVM library.
                        </p>
                      </div>
                    )}
                  </div>
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

              {/* THE FACILITY — what actually happened when capital moved against a record like
                  this. Repayment history is the answer to the lender's real question, and it is
                  the one signal collateral files never contain. When the wallet has none, the
                  panel states the pipe honestly instead of pretending: the facility is live, the
                  LP today is Sage's own pot, and the call shown is the exact one a credit union
                  would make. */}
              <section className="lend-adv" aria-label="Advance facility">
                <div className="lend-rows-h">
                  <span>Advance facility</span>
                  <span className="lend-adv-tag">waterfall on witnessed inflow</span>
                </div>
                {(data.advances ?? []).length > 0 ? (
                  <ul className="lend-adv-list">
                    {(data.advances ?? []).map((a) => (
                      <li key={a.id}>
                        <span className={`lend-adv-status is-${a.status}`}>
                          {a.status === "repaid" ? "Repaid" : a.status === "active" ? "Active" : "Written off"}
                        </span>
                        <span className="lend-adv-what">
                          {a.principalUsd === null ? "Advance" : usd(a.principalUsd)}
                          {a.status === "repaid"
                            ? ` — repaid from ${a.repayments.length} verified payout${a.repayments.length === 1 ? "" : "s"}, ≤${a.terms.waterfallPct}% of each`
                            : a.outstandingUsd !== null
                              ? ` — ${usd(a.outstandingUsd)} outstanding, ≤${a.terms.waterfallPct}% of each payout routes to repayment`
                              : ""}
                        </span>
                        {a.repayments[0]?.escrowTxUrl ? (
                          <a href={a.repayments[0].escrowTxUrl} target="_blank" rel="noreferrer noopener">
                            escrow tx <ArrowRight size={12} aria-hidden />
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="lend-adv-none">
                    No advance has run against this record yet. The facility is live — today&rsquo;s
                    LP is Sage&rsquo;s own pot, and repayment routes from each subsequent verified
                    payout (the waterfall), with recourse on the Sage-routed remainder only.
                  </p>
                )}
                <div className="lend-adv-pipe">
                  <span>The pipe is open — this is the exact call an institution&rsquo;s system would make:</span>
                  <code>
                    POST /api/admin/advance {"{"}&quot;action&quot;:&quot;disburse&quot;,&quot;wallet&quot;:&quot;{data.wallet.slice(0, 10)}…&quot;,&quot;usd&quot;:{capacity === null ? "0" : Math.max(0.5, Math.floor(capacity * 100) / 100).toFixed(2)},&quot;multiple&quot;:{Number.isFinite(m) ? m : 1}{"}"}
                  </code>
                  <span className="lend-adv-note">
                    Operator-gated today (the LP is us); the server refuses any amount past the
                    published capacity formula — the lender is bound by the same arithmetic shown
                    above.
                  </span>
                </div>
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
