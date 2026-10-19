import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, CircleAlert, CircleSlash, EyeOff, Layers, Receipt, Scale, Wallet } from "lucide-react";
import { SiteFrame } from "@/components/site/site-frame";
import { ago } from "@/components/site/receipt-card";
import { humanWait } from "@/components/marketplace/wait-strip";
import { rewardAligned, short, shortDateUTC, usd } from "@/lib/format";
import {
  LEDGER_SHOWS,
  ledgerHref,
  ledgerOutcomes,
  lookupTarget,
  parseLedgerQuery,
  readLedger,
  type LedgerEntry,
  type LedgerNetwork,
  type LedgerShow,
} from "@/lib/site/ledger";
import "@/styles/ledger.css";

// Read on every request: the totals and every line are the ledger as it is now, never a build-time copy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ledger",
  description:
    "Every payout Sage has made and every piece of work it refused, read live. Real money only, in USDC, with a public receipt for every payout.",
  alternates: { canonical: "/ledger" },
  openGraph: {
    title: "The Sage ledger: every payout, every refusal",
    description: "What Sage has paid and the work it refused, read live. Every payout opens its receipt.",
    type: "website",
  },
};

const SHOW_LABEL: Record<LedgerShow, string> = { all: "All", paid: "Paid", refused: "Refused" };

/** Cents always, for figures that sit in a column: "$2" beside "$43.75" reads as a different measurement. */
const cents = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A week of relative time ("3 days ago"), then a date: an old line is easier to check by its date. */
function when(at: number, nowSec: number): string {
  if (nowSec - at < 7 * 86_400) return ago(at, nowSec);
  const year = (s: number) => new Date(s * 1000).getUTCFullYear();
  return shortDateUTC(at, year(at) !== year(nowSec));
}

function Line({ e, nowSec }: { e: LedgerEntry; nowSec: number }) {
  const paid = e.kind === "paid";
  const to = !paid ? null : e.ownWallet ? "to Sage's own wallet" : e.recipient ? `to ${short(e.recipient)}` : null;
  const body = (
    <>
      <span className={`lg-dot${paid ? "" : " is-refused"}`} aria-hidden />
      <span className="lg-main">
        <span className="lg-title">{e.job ?? (paid ? "A verified payout" : "Work Sage refused")}</span>
        {to && <span className="lg-sub">{to}</span>}
      </span>
      <span className="lg-meta">
        <span className="lg-net-cell">{e.network}</span>
        <time className="lg-when" dateTime={new Date(e.at * 1000).toISOString()}>
          {when(e.at, nowSec)}
        </time>
      </span>
      <span className={`lg-amt${paid ? "" : " is-refused"}`}>{paid ? rewardAligned(e.amountBase ?? 0, e.chainId) : "Refused"}</span>
    </>
  );
  // A payout opens its receipt. A refusal moves no money, so it has a receipt only in the rare case
  // that it produced a transaction; otherwise the line is a fact, not a link to nothing. No prefetch:
  // a receipt reads the chain when it renders, and fifty of them should not be read for a scroll.
  return e.txHash ? (
    <Link href={`/proof/${e.txHash}`} className="lg-row" prefetch={false}>
      {body}
    </Link>
  ) : (
    <div className="lg-row">{body}</div>
  );
}

function NetworkRow({ n, current }: { n: LedgerNetwork; current: boolean }) {
  return (
    <li>
      <Link href={ledgerHref({ network: n.key })} className="lg-net" aria-current={current ? "true" : undefined}>
        <span className="lg-net-name">{n.name}</span>
        {n.payouts + n.refused === 0 ? (
          <span className="lg-net-none">Nothing yet</span>
        ) : (
          <span className="lg-net-figs">
            <span>
              <b>{cents(n.paidUsd)}</b> paid
            </span>
            <span>
              <b>{n.payouts}</b> {n.payouts === 1 ? "payout" : "payouts"}
            </span>
            <span>
              <b>{n.refused}</b> refused
            </span>
          </span>
        )}
      </Link>
    </li>
  );
}

/** What an empty view says: the plain truth for this filter, and the way back to everything. */
function emptyLine(show: LedgerShow, network: LedgerNetwork | null): string {
  const what = show === "paid" ? "No payouts" : show === "refused" ? "No refusals" : "Nothing";
  return network ? `${what} on ${network.name} yet.` : `${what} yet.`;
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Look up a transaction or a wallet: a plain GET form, so it works before (and without) JavaScript.
  const rawQ = (Array.isArray(params.q) ? (params.q[0] ?? "") : (params.q ?? "")).slice(0, 200);
  const target = rawQ.trim() === "" ? null : lookupTarget(rawQ);
  if (target) redirect(target);
  const lookupFailed = rawQ.trim() !== "";

  const ledger = readLedger(parseLedgerQuery(params));
  const outcomes = ledgerOutcomes();
  const nowSec = Math.floor(Date.now() / 1000);
  const { query, totals, counts, entries, page, pages } = ledger;
  const primary = ledger.networks.filter((n) => n.tier === "primary");
  const secondary = ledger.networks.filter((n) => n.tier === "secondary");
  const filtered = ledger.networks.find((n) => n.key === query.network) ?? null;
  const nothingAtAll = totals.payouts + totals.refused === 0;

  return (
    <SiteFrame active="/ledger">
      <section className="page-head">
        <div className="site-wrap">
          <h1 className="display">Every payout. Every&nbsp;refusal.</h1>
          <p className="lead">
            Everything Sage has paid, and every piece of work it refused, read live as this page loads. Real money only.
          </p>
        </div>
      </section>

      <section className="sec sec-follow" aria-label="Totals">
        <div className="site-wrap">
          <div className="stats">
            <div className="stat">
              <div className="stat-v">{usd(totals.paidUsd)}</div>
              <div className="stat-l">paid in USDC</div>
            </div>
            <div className="stat">
              <div className="stat-v">{totals.payouts}</div>
              <div className="stat-l">verified payouts</div>
            </div>
            <div className="stat">
              <div className="stat-v">{totals.refused}</div>
              <div className="stat-l">refused, each with a reason</div>
            </div>
          </div>

          <div className="lg-nets-wrap">
            <h2 className="lg-label">By network</h2>
            <ul className="lg-nets">
              {primary.map((n) => (
                <NetworkRow key={n.chainId} n={n} current={n.key === query.network} />
              ))}
            </ul>
            {secondary.length > 0 && (
              <>
                <h3 className="lg-label lg-label-sub">Also on</h3>
                <ul className="lg-nets">
                  {secondary.map((n) => (
                    <NetworkRow key={n.chainId} n={n} current={n.key === query.network} />
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="sec sec-white" id="activity">
        <div className="site-wrap">
          <div className="sec-head">
            <h2 className="h2">Every line, newest first.</h2>
            <p className="lead">A payout opens its receipt, with its transaction on chain. A refusal moves no money, so there is nothing to open.</p>
          </div>

          <nav className="lg-filters" aria-label="Filter the ledger">
            <div className="lg-filter" role="group" aria-label="Show">
              {LEDGER_SHOWS.map((s) => (
                <Link
                  key={s}
                  href={ledgerHref({ show: s, network: query.network })}
                  className="lg-chip"
                  aria-current={s === query.show ? "true" : undefined}
                >
                  {SHOW_LABEL[s]} <span className="lg-chip-n">{counts[s]}</span>
                </Link>
              ))}
            </div>
            <div className="lg-filter" role="group" aria-label="Network">
              <Link href={ledgerHref({ show: query.show })} className="lg-chip" aria-current={query.network === null ? "true" : undefined}>
                All networks
              </Link>
              {ledger.networks.map((n) => (
                <Link
                  key={n.chainId}
                  href={ledgerHref({ show: query.show, network: n.key })}
                  className="lg-chip"
                  aria-current={n.key === query.network ? "true" : undefined}
                >
                  {n.name}
                </Link>
              ))}
            </div>
          </nav>

          {entries.length === 0 ? (
            <div className="lg-empty">
              {nothingAtAll ? (
                <p>Nothing yet. The first payout will appear here the moment it settles.</p>
              ) : (
                <>
                  <p>{emptyLine(query.show, filtered)}</p>
                  <Link href={ledgerHref({})} className="more">
                    See everything
                  </Link>
                </>
              )}
            </div>
          ) : (
            <ol className="lg-list" aria-label="Payouts and refusals, newest first">
              <li className="lg-head" aria-hidden="true">
                <span />
                <span>Job</span>
                <span>Network</span>
                <span>When</span>
                <span>Amount</span>
              </li>
              {entries.map((e) => (
                <li key={e.id}>
                  <Line e={e} nowSec={nowSec} />
                </li>
              ))}
            </ol>
          )}

          {pages > 1 && (
            <nav className="lg-pager" aria-label="Pages">
              {page > 1 ? (
                <Link href={ledgerHref({ ...query, page: page - 1 })} className="btn btn-quiet btn-sm" rel="prev">
                  <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Newer
                </Link>
              ) : (
                <span className="btn btn-quiet btn-sm" aria-disabled="true">
                  <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Newer
                </span>
              )}
              <span className="lg-pager-at">
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link href={ledgerHref({ ...query, page: page + 1 })} className="btn btn-quiet btn-sm" rel="next">
                  Older <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
                </Link>
              ) : (
                <span className="btn btn-quiet btn-sm" aria-disabled="true">
                  Older <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
                </span>
              )}
            </nav>
          )}
        </div>
      </section>

      <section className="sec" id="outcomes">
        <div className="site-wrap">
          <div className="sec-head">
            <h2 className="h2">What the jobs got.</h2>
            <p className="lead">Real people, paid for work that checked out. Counted from the same records.</p>
          </div>
          <div className="stats">
            <div className="stat">
              <div className="stat-v">{outcomes.people}</div>
              <div className="stat-l">{outcomes.people === 1 ? "person paid" : "people paid"}</div>
            </div>
            <div className="stat">
              <div className="stat-v">{outcomes.medianWaitSeconds === null ? "Not yet" : humanWait(outcomes.medianWaitSeconds)}</div>
              <div className="stat-l">{outcomes.measured > 1 ? "median wait from submitting to paid" : "wait from submitting to paid"}</div>
            </div>
            <div className="stat">
              <div className="stat-v">{outcomes.refusedSharePct}%</div>
              <div className="stat-l">of judged work refused</div>
            </div>
          </div>
          <p className="lg-note">
            People, not wallets: wallets that belong to one person count once.
            {outcomes.measured > 1 && ` The wait is measured over ${outcomes.measured} payouts, and includes the checking.`}
          </p>
        </div>
      </section>

      <section className="sec sec-white" id="check">
        <div className="site-wrap split">
          <div>
            <h2 className="h2">Check it yourself.</h2>
            <ul>
              <li>
                <Receipt size={18} strokeWidth={1.75} aria-hidden />
                <span>Every payout has a public receipt that names its transaction, so anyone can find it on the network itself.</span>
              </li>
              <li>
                <CircleSlash size={18} strokeWidth={1.75} aria-hidden />
                <span>A refusal is not always about the work. When a job filled up or stopped first, its reason says so.</span>
              </li>
              <li>
                <EyeOff size={18} strokeWidth={1.75} aria-hidden />
                <span>Refusals name no one here. The reason is written for the person who did the work.</span>
              </li>
              <li>
                <Layers size={18} strokeWidth={1.75} aria-hidden />
                <span>Real money only. Payouts on test networks never appear here.</span>
              </li>
              <li>
                <Scale size={18} strokeWidth={1.75} aria-hidden />
                <span>These are the same numbers the home page and every receipt show, from one set of records.</span>
              </li>
              {ledger.hasOwnWallet && (
                <li>
                  <Wallet size={18} strokeWidth={1.75} aria-hidden />
                  <span>A few payouts went to Sage&apos;s own wallets while it tested itself. They moved real money, so they are counted.</span>
                </li>
              )}
            </ul>
          </div>
          <form className="lg-lookup" action="/ledger#check" method="get">
            <label htmlFor="lg-q">Look up a transaction or a wallet</label>
            <div className="lg-lookup-row">
              <input
                id="lg-q"
                name="q"
                type="text"
                className="lg-input"
                placeholder="0x…"
                defaultValue={lookupFailed ? rawQ : undefined}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={lookupFailed ? "lg-q-error" : "lg-q-hint"}
              />
              <button type="submit" className="btn btn-primary">
                Open
              </button>
            </div>
            {lookupFailed ? (
              <p className="lg-error" id="lg-q-error" role="alert">
                <CircleAlert size={16} strokeWidth={1.75} aria-hidden />
                <span>That is not a transaction or a wallet address. Both start with 0x.</span>
              </p>
            ) : (
              <p className="lg-hint" id="lg-q-hint">
                A transaction opens its receipt. A wallet opens its record of paid work.
              </p>
            )}
          </form>
        </div>
      </section>
    </SiteFrame>
  );
}
