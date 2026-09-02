import "../../sage-proof.css";
import "../record.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { walletCreditSignals } from "@/lib/campaigns/credit";
import { isRecordPrivate } from "@/lib/campaigns/record-preference";

import { PrivacyToggle } from "./privacy-toggle";
import { AttestCard } from "./attest-card";
import { buildWalletRecord } from "@/lib/campaigns/record";
import { publicAdvances } from "@/lib/advance/public";
import { money, short } from "@/lib/format";
import { siteUrl } from "@/lib/site";
import { getSessionAddress } from "@/lib/auth/session";
import { getStarknetSessionAddress } from "@/lib/auth/starknet-session";
import { buildLinkedRecord, linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { LinkWalletsButton } from "./link-wallets";
import { TakeAdvanceButton } from "./take-advance";
import { offerFor } from "@/lib/advance/self-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE VERIFIED WORK RECORD — a wallet's portable, receipt-anchored history of paid verified work
 * (move 3: the "MSME credit" answer). Every line links to its own /proof page; nothing on this
 * page is asserted that a receipt can't back. Public and indexable: the whole point is that a
 * worker or small business can hand this URL to anyone — a funder, a program, a lender.
 */

const KIND_LABEL = { testing: "testing", grant: "grant", gig: "gig" } as const;

export async function generateMetadata({ params }: { params: Promise<{ wallet: string }> }): Promise<Metadata> {
  const { wallet } = await params;
  const record = buildWalletRecord(wallet);
  // The layout template already appends "· Sage" to every page title, so this must NOT — the
  // browser tab was reading "Verified Work Record · Sage · Sage". OpenGraph does not go through
  // the template, so the share card keeps the suffix explicitly.
  const title = "Verified Work Record";
  const shareTitle = `${title} · Sage`;
  const description = record
    ? `${short(record.wallet)} — ${record.completions} verified completion${record.completions === 1 ? "" : "s"}${isRecordPrivate(record.wallet) ? "" : `, $${record.totalUsd.toFixed(2)} earned`} across ${record.distinctCampaigns} campaign${record.distinctCampaigns === 1 ? "" : "s"}. Every entry anchored to an on-chain receipt.`
    : "A wallet's verified, receipt-anchored history of paid work on Sage.";
  return {
    metadataBase: new URL(siteUrl()),
    title,
    description,
    alternates: { canonical: `/record/${wallet.toLowerCase()}` },
    openGraph: { title: shareTitle, description, siteName: "Sage", type: "profile" },
    twitter: { card: "summary", title: shareTitle, description },
  };
}

const dateOf = (unix: number): string =>
  new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function RecordPage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const out = walletCreditSignals(wallet);
  if (!out) notFound();
  const { record, signals } = out;
  // Public unless this worker chose otherwise. Receipts are the point of the record for grants and
  // MSME capital; privacy is the worker's option, never a default imposed on the people it serves.
  const amountsPrivate = isRecordPrivate(record.wallet);
  // Through the one redaction boundary — never the raw ledger, which carries bearer secrets.
  const advs = publicAdvances(record.wallet, { amountsWithheld: amountsPrivate });
  // ONE BUSINESS, MANY RAILS — the linked set, and whether THIS viewer can link a second wallet to
  // this record (signed in with both, and this record is one of them). Comparison by value on
  // both rails: EVM addresses are checksummed in sessions; Starknet felts vary in padding.
  const same = (a: string | null, b: string) => { try { return a !== null && BigInt(a) === BigInt(b); } catch { return false; } };
  const [evmSession, starknetSession] = await Promise.all([getSessionAddress(), getStarknetSessionAddress()]);
  const linked = buildLinkedRecord(record.wallet);
  const business = linked && linked.wallets.length > 1 ? linked : null;
  const businessPrivate = amountsPrivate || (business?.wallets ?? []).some((w) => isRecordPrivate(w));
  const viewerOwnsThis = same(evmSession, record.wallet) || same(starknetSession, record.wallet);
  const alreadyLinked = evmSession && starknetSession ? linkedWalletsOf(evmSession).some((w) => same(w, starknetSession)) : true;
  const canLink = !!evmSession && !!starknetSession && viewerOwnsThis && !alreadyLinked;
  // WORKING CAPITAL, SELF-SERVE — the owner sees what the published formula allows right now and can
  // take it in one click; everyone else sees the facility's terms on the lender view instead.
  const offer = viewerOwnsThis ? offerFor(record.wallet) : null;
  const showTake = !!offer && offer.terms.armed && !offer.active && offer.offerUsd >= 0.1;
  const otherLabel = same(evmSession, record.wallet) ? "Starknet" : "Ethereum";

  return (
    <div className="spp">
      <div className="spp-col">
        {/* The mark lives in the app rail on this route, so the page does not draw a second one —
            /proof keeps the standalone mark-and-kicker treatment because it has no rail. */}
        <div className="spp-top spp-reveal">
          <span className="spp-kicker">Verified work record</span>
        </div>

        <header className="rec-head spp-reveal">
          <h1 className="rec-title">Verified Work Record</h1>
          <div className="rec-wallet">{record.wallet}</div>
        </header>

        <section className="rec-stats spp-reveal" aria-label="Record totals">
          <div className="rec-stat">
            <div className="rec-stat-v">
              {amountsPrivate ? signals.distinctPayers : `$${record.totalUsd.toFixed(2)}`}
            </div>
            <div className="rec-stat-k">{amountsPrivate ? "Separate payers" : "Earned, verified"}</div>
          </div>
          <div className="rec-stat">
            <div className="rec-stat-v">{record.completions}</div>
            <div className="rec-stat-k">Completions</div>
          </div>
          <div className="rec-stat">
            <div className="rec-stat-v">{record.distinctCampaigns}</div>
            <div className="rec-stat-k">Campaigns</div>
          </div>
          <div className="rec-stat">
            <div className="rec-stat-v">{record.lastAt ? dateOf(record.lastAt) : "—"}</div>
            <div className="rec-stat-k">Last verified</div>
          </div>
        </section>

        <PrivacyToggle wallet={record.wallet} amountsPrivate={amountsPrivate} />
        {canLink && <LinkWalletsButton otherLabel={otherLabel} />}

        {/* Shown only when the worker chose it. A record that quietly dropped its amounts would
            read as incomplete; one that says why reads as deliberate — which it is. */}
        {amountsPrivate && (
          <section className="rec-withheld-note spp-reveal" id="disclosure">
            <p>
              <strong>This worker has chosen not to publish payout amounts.</strong> Every entry
              below is anchored to a transaction anyone can verify, so each payment is provable
              without this page publishing what someone earns.
            </p>
            <AttestCard wallet={record.wallet} />
          </section>
        )}

        {/* SAGE SIGNALS (FC plan #1) — deterministic underwriting INPUTS over the receipt-anchored
            rows below. No composite score: the same rule that keeps models away from money keeps
            invented creditworthiness verdicts off this page. */}
        {record.entries.length > 0 && (
          <section className="rec-signals spp-reveal" aria-label="Sage Signals — underwriting inputs">
            <div className="rec-sig-head">
              <span className="rec-sig-title">Sage Signals</span>
              <span className="rec-sig-v">{signals.formulaVersion}</span>
            </div>
            <dl className="rec-sig-grid">
              <div className="rec-sig">
                <dt>Verification pass rate</dt>
                <dd>
                  {signals.verificationPassRate === null
                    ? "—"
                    : `${Math.round(signals.verificationPassRate * 100)}%`}
                  <small> of {signals.decidedSubmissions} judged</small>
                </dd>
              </div>
              <div className="rec-sig">
                <dt>
                  {amountsPrivate ? "Verified payouts / active month" : "Verified inflow / active month"}
                </dt>
                <dd>
                  {amountsPrivate
                    ? signals.monthsActive
                      ? (signals.completions / signals.monthsActive).toFixed(1)
                      : "—"
                    : `$${signals.avgInflowPerActiveMonthUsd.toFixed(2)}`}
                </dd>
              </div>
              <div className="rec-sig">
                <dt>Months active</dt>
                <dd>{signals.monthsActive}</dd>
              </div>
              <div className="rec-sig">
                <dt>Distinct funders</dt>
                <dd>{signals.distinctPayers}</dd>
              </div>
              {/* RECENCY AND CONCENTRATION — what a working-capital decision actually turns on.
                  A lifetime total says someone earned once; these say whether the cash flow is
                  live, and whether it leans on a single counterparty. */}
              <div className="rec-sig">
                <dt>Verified work, last 90d</dt>
                <dd>
                  {signals.completions90d}
                  {amountsPrivate ? null : (
                    <small> · ${signals.inflow90dUsd.toFixed(2)}</small>
                  )}
                </dd>
              </div>
              <div className="rec-sig">
                <dt>Largest funder share</dt>
                <dd>
                  {signals.topPayerShare === null
                    ? "—"
                    : `${Math.round(signals.topPayerShare * 100)}%`}
                  <small> of verified income</small>
                </dd>
              </div>
              <div className="rec-sig">
                <dt>Tenure</dt>
                <dd>{signals.tenureDays === null ? "—" : `${signals.tenureDays}d`}</dd>
              </div>
              <div className="rec-sig">
                <dt>Last verified</dt>
                <dd>{signals.daysSinceLastVerified === null ? "—" : signals.daysSinceLastVerified === 0 ? "today" : `${signals.daysSinceLastVerified}d ago`}</dd>
              </div>
            </dl>
            {/* The file a credit officer opens. Sage states the inputs; the lender applies their
                own multiple, which is why it is a parameter and not a number on this page. */}
            <p className="rec-export">
              <a href={`/api/record/${record.wallet}/export?multiple=2`}>
                Download this record for a lender (CSV)
              </a>
              <span>
                Every row carries the transaction that settled it, so any line can be checked
                on-chain without taking Sage&rsquo;s word for it.
              </span>
            </p>
            <p className="rec-sig-note">
              Published deterministic formulas over the receipt-anchored entries below — inputs a
              lender can underwrite on, never a score. Sage computes no creditworthiness verdict.
            </p>
          </section>
        )}

        {business && (
          <section className="rec-biz spp-reveal" aria-label="One business, many rails">
            <div className="rec-sig-head">
              <span className="rec-sig-title">One business · {business.wallets.length} wallets</span>
              <span className="rec-sig-ver mono">linked by their own sign-ins</span>
            </div>
            <p className="rec-biz-lede">
              The same published formulas, run over every wallet this one is linked to — a business paid on
              two rails by different funders is one credit file, not two halves.
            </p>
            <ul className="rec-biz-wallets">
              {business.wallets.map((w) => (
                <li key={w}><Link href={`/record/${w}`} className="mono">{short(w)}</Link>{same(w, record.wallet) ? <span className="rec-biz-this">this record</span> : null}</li>
              ))}
            </ul>
            <div className="rec-biz-grid">
              <div><span className="rec-biz-k">verified inflow</span><span className="rec-biz-v mono">{businessPrivate ? "withheld" : `$${business.record.totalUsd.toFixed(2)}`}</span></div>
              <div><span className="rec-biz-k">completions</span><span className="rec-biz-v mono">{business.record.completions}</span></div>
              <div><span className="rec-biz-k">distinct funders</span><span className="rec-biz-v mono">{business.signals.distinctPayers}</span></div>
              <div><span className="rec-biz-k">months active</span><span className="rec-biz-v mono">{business.signals.monthsActive}</span></div>
              <div><span className="rec-biz-k">pass rate</span><span className="rec-biz-v mono">{business.signals.verificationPassRate === null ? "—" : `${Math.round(business.signals.verificationPassRate * 100)}%`}</span></div>
            </div>
          </section>
        )}

        {showTake && offer && (
          <section className="rec-adv spp-reveal" aria-label="Working capital">
            <div className="rec-sig-head">
              <span className="rec-sig-title">Working capital</span>
              <span className="rec-sig-sub mono">capacity ${offer.capacityUsd.toFixed(2)} · = {offer.terms.multiple}× monthly verified inflow</span>
            </div>
            <TakeAdvanceButton wallet={record.wallet} offerUsd={offer.offerUsd} multiple={offer.terms.multiple} waterfallBps={offer.terms.waterfallBps} />
          </section>
        )}
        {offer?.active && (
          <p className="rec-link-hint">Advance outstanding: ${offer.active.outstandingUsd.toFixed(2)} of ${offer.active.principalUsd.toFixed(2)} — repaid automatically from your next verified payouts.</p>
        )}
        {/* THE ADVANCE FACILITY (capital in). Rendered only when a facility has actually run for
            this wallet — an empty promise box would be marketing, and this page is receipts.
            Repayment history leads because it is the one credit signal collateral-based lending
            never produces: capital moved against this record, and the record paid it back. */}
        {advs.length > 0 && (
          <section className="rec-adv spp-reveal" aria-label="Advance facility">
            <div className="rec-sig-head">
              <span className="rec-sig-title">Advance facility</span>
              <span className="rec-sig-v">waterfall on witnessed inflow</span>
            </div>
            <ul className="rec-adv-list">
              {advs.map((a) => (
                <li key={a.id} className="rec-adv-item">
                  <div className="rec-adv-line">
                    <span className={`rec-adv-status rec-adv-${a.status}`}>
                      {a.status === "active" ? "Active" : a.status === "repaid" ? "Repaid" : "Written off"}
                    </span>
                    <span className="rec-adv-main">
                      {a.principalUsd === null ? "Advance" : `$${a.principalUsd.toFixed(2)} advance`}
                      {" · "}
                      {a.status === "active" && a.outstandingUsd !== null
                        ? `$${a.outstandingUsd.toFixed(2)} outstanding`
                        : a.status === "repaid"
                          ? `repaid from ${a.repayments.length} verified payout${a.repayments.length === 1 ? "" : "s"}`
                          : "—"}
                    </span>
                    <span className="rec-adv-when">{dateOf(a.createdAtUnix)}</span>
                  </div>
                  <div className="rec-adv-terms">
                    Terms, published: capacity was {a.terms.multipleOfMonthlyInflow}× monthly
                    verified inflow (90d window ÷ 3); at most {a.terms.waterfallPct}% of each
                    subsequent verified payout routes to repayment. Recourse is the Sage-routed
                    remainder — nothing else.
                  </div>
                  {a.repayments.length > 0 && (
                    <ul className="rec-adv-reps">
                      {a.repayments.map((r) => (
                        <li key={r.escrowTx + r.submissionId}>
                          <span>{dateOf(r.atUnix)}</span>
                          <span>
                            {r.amountUsd === null ? "repayment" : `−$${r.amountUsd.toFixed(2)}`} routed
                            from a verified payout
                          </span>
                          {r.escrowTxUrl ? (
                            <a href={r.escrowTxUrl} target="_blank" rel="noreferrer noopener">
                              escrow tx →
                            </a>
                          ) : (
                            <span className="rec-adv-tx">{short(r.escrowTx)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {record.entries.length === 0 ? (
          <p className="rec-empty spp-reveal">No verified work on this wallet yet.</p>
        ) : (
          <ul className="rec-list spp-reveal" aria-label="Verified completions">
            {record.entries.map((e) => (
              <li key={e.txHash}>
                <Link href={e.proofPath} className="rec-row">
                  <span className="rec-what">
                    <span className="rec-mission">{e.missionTitle ?? e.campaignTitle}</span>
                    <span className="rec-meta">
                      <span className="rec-kind">{KIND_LABEL[e.kind]}</span>
                      {e.campaignTitle} · {dateOf(e.at)}
                    </span>
                  </span>
                  <span className="rec-amt">
                    {amountsPrivate ? (
                      <span className="rec-withheld">Verified</span>
                    ) : (
                      money(e.amountUsd, e.chainId)
                    )}
                    <small>receipt →</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <footer className="rec-trust spp-reveal">
          Every entry above was <b>verified before it was paid</b> — checked against Sage&apos;s own
          observations, an on-chain fact, or the created artifact itself — and links to its public,
          on-chain settlement receipt. Sage refuses work it cannot verify, so a record here is
          earned, not granted.
          <br />
          <b>For lenders &amp; programs:</b> this page and its signals are consumable as JSON —{" "}
          <a href={`/api/record/${record.wallet}`}>api/record/{short(record.wallet)}</a> — the
          cash-flow history collateral-based underwriting is missing, verified at the source. How it
          works: <Link href="/docs">sagepays.xyz/docs</Link>
        </footer>
      </div>
    </div>
  );
}
