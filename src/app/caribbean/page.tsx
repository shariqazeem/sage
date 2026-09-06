import type { Metadata } from "next";
import Link from "next/link";
import "./caribbean.css";
import { readOutcomes } from "@/lib/outcomes/outcomes";
import { CURRENCIES } from "@/lib/money/currency";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECORD = "0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3";
const FIRST = "0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069";
const PRIVATE = "0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb";

export const metadata: Metadata = {
  title: "Sage for the Caribbean — payments that verify themselves, credit records that write themselves",
  description: "For the Finance, Payments & MSME Capital track: verified payments in minutes at a flat fee, a cash-flow record per worker a lender can read, an advance repaid from the next payouts, obligations priced in the region's own currencies. Every number read from the ledger.",
  alternates: { canonical: `${siteUrl()}/caribbean` },
};

const usd = (v: number) => `$${v.toFixed(2)}`;
const mins = (m: number | null) => (m === null ? "not yet measured" : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);

export default function CaribbeanPage() {
  const o = readOutcomes();
  const decided = o.payoutCount + o.refusedCount;
  const caribbean = CURRENCIES.filter((c) => c.code !== "USD" && !["CAD", "GBP", "EUR"].includes(c.code));
  const diaspora = CURRENCIES.filter((c) => ["CAD", "GBP", "EUR", "USD"].includes(c.code));
  const denominated = new Set(o.denominated.currencies);
  const corridors = o.publicCorridors.filter((c) => c.pct !== null).slice(0, 6);
  return (
    <main className="cb">
      <section className="lead">
        <p className="eyebrow">Future Caribbean 2026 · Finance, Payments &amp; MSME Capital</p>
        <h1>Payments that verify themselves. Credit records that write themselves.</h1>
        <p className="lede">
          Sage is an AI agent that pays people for verified work — in minutes, at a flat fee, inside spending limits enforced by code it cannot
          change — and turns every payment into a cash-flow record a lender can read. Live with real money on two settlement rails since July.
          Every figure on this page is read from the settlement ledger; nothing is typed in.
        </p>
        <div className="ledger">
          <span><b>{usd(o.settledUsd)}</b>settled, verified</span>
          <span><b>{o.payoutCount}</b>payments on mainnet</span>
          <span><b>{o.refusedCount}</b>refusals with the reason on record</span>
          <span><b>{o.peoplePaid}</b>people paid</span>
          <span><b>{mins(o.medianMinutesToSettle)}</b>median, submission to settled</span>
        </div>
      </section>

      <section>
        <h2>The four readings, against the track&rsquo;s own bar</h2>
        <p>The brief names the metrics: payment fee reduction, real-time settlement, credit access without collateral, efficient regional capital movement. These are the live readings, derived on <Link href="/outcomes">/outcomes</Link>.</p>
        <div className="grid2">
          <div className="read"><p className="v ok">$0.10</p><p className="k">flat fee per settlement · recipients keep 100%</p><p className="vs">Against the corridor&rsquo;s {Math.round(o.corridor.benchmarkRate * 100)}% the same {usd(o.corridor.amountUsd)} would have cost {usd(o.corridor.benchmarkCostUsd)}; it cost {usd(o.corridor.sageCostUsd)}.</p></div>
          <div className="read"><p className="v ok">{mins(o.medianMinutesToSettle)}</p><p className="k">median, submission to settled payment</p><p className="vs">Verification included — the part other rails do not attempt. {o.p90MinutesToSettle !== null ? `p90 ${mins(o.p90MinutesToSettle)}.` : ""} Against three days for a corridor transfer.</p></div>
          <div className="read"><p className="v">{o.peoplePaid}</p><p className="k">people paid · no bank account, no application</p><p className="vs">Each with a verified work record and the option of an advance against it. {o.refusalSharePct !== null ? `${Math.round(o.refusalSharePct)}% of judged work refused — the integrity behind the record.` : ""}</p></div>
          <div className="read"><p className="v">{usd(o.settledUsd)}</p><p className="k">capital moved · {o.railsUsed.map((r) => r.rail).join(" + ")}</p><p className="vs">{o.denominated.payouts > 0 ? `${o.denominated.payouts} obligations priced in ${o.denominated.currencies.join(", ")} and settled in digital dollars.` : `${o.denominationsSupported} currencies supported; the first regionally denominated obligation settles this week.`}</p></div>
        </div>
      </section>

      <section>
        <h2>How a payment becomes a credit record</h2>
        <p>Four live artifacts, one for each step. Open any of them; they are the product, not a description of it.</p>
        <ol className="steps">
          <li><h3>Say the work, in your own currency</h3><p>A buyer, a programme or a cooperative describes the work once — &ldquo;J$10,000 in two parts&rdquo; — and funds it once. Sage compiles milestones, each with a verification rule, and stamps the rate.</p><Link href="/launch">the composer →</Link></li>
          <li><h3>The agent verifies and pays</h3><p>It reads the deliverable itself and pays within minutes from a vault whose limits it cannot change. Every payment leaves a public receipt; every refusal leaves its reason.</p><Link href={`/proof/${FIRST}`}>the first receipt →</Link></li>
          <li><h3>The record writes itself</h3><p>Verified inflow over 30 and 90 days, distinct payers, tenure, pass rate — published formulas over receipts, never a score. Exportable as JSON, CSV and a printable statement.</p><Link href={`/record/${RECORD}`}>a worker&rsquo;s record →</Link></li>
          <li><h3>A lender reads it in one call</h3><p>The facility as published arithmetic: capacity from verified inflow, an advance disbursed against it, repaid from the next verified payouts through a waterfall.</p><Link href={`/lender?wallet=${RECORD}`}>the lender&rsquo;s view →</Link></li>
        </ol>
      </section>

      <section>
        <h2>Priced in the region&rsquo;s money, settled in digital dollars</h2>
        <p>An obligation is written in the currency the seller thinks in and converted once, at a stamped, source-attributed rate. Settlement is always the digital dollar (USDC), so the money is spendable anywhere and the record is comparable everywhere.</p>
        <div className="cur">
          {caribbean.map((c) => <span key={c.code} className={denominated.has(c.code) ? "on" : ""}>{c.symbol} {c.code}</span>)}
          {diaspora.map((c) => <span key={c.code} className={denominated.has(c.code) ? "on" : ""}>{c.symbol} {c.code}</span>)}
        </div>
        {corridors.length > 0 && (
          <div className="tbl"><table>
            <thead><tr><th>Receiving country</th><th>What a $200 remittance costs today</th><th>Reading</th><th>On Sage</th></tr></thead>
            <tbody>{corridors.map((c) => <tr key={c.country}><td><b>{c.countryName}</b></td><td>{c.pct!.toFixed(2)}%</td><td>{o.publicCorridorSource.name}, {c.year}</td><td><b>$0.10 flat</b>, minutes</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section>
        <h2>For institutions</h2>
        <p>Everything a lender, a programme or a payroll needs is a call or a page — no integration project, no data-sharing agreement to negotiate for public records.</p>
        <div className="tbl"><table>
          <thead><tr><th>Need</th><th>Where</th><th>What you get</th></tr></thead>
          <tbody>
            <tr><td><b>A worker&rsquo;s verified cash-flow record</b></td><td><code>GET /api/record/&lt;wallet&gt;</code></td><td>JSON, schema <code>sage.work-record.v4</code>: every verified payout with its transaction, the credit signals with the formula version, linked wallets, advances.</td></tr>
            <tr><td><b>The same record for a spreadsheet</b></td><td><code>GET /api/record/&lt;wallet&gt;/export</code></td><td>One row per payout: date, payer, campaign, amount, transaction, receipt.</td></tr>
            <tr><td><b>A statement the worker can hand to a bank</b></td><td><Link href={`/record/${RECORD}/statement`}>/record/&lt;wallet&gt;/statement</Link></td><td>A printable verified income statement with a verification link and a digest of the underlying record.</td></tr>
            <tr><td><b>Underwriting on verified inflow</b></td><td><Link href={`/lender?wallet=${RECORD}`}>/lender</Link></td><td>Capacity as published arithmetic; the lender sets the multiple. The advance call an institution&rsquo;s system makes is printed on the page, operator-authorized today.</td></tr>
            <tr><td><b>Paying your own people</b></td><td><Link href="/launch">/launch</Link></td><td>Invite-only work for contractors, apprentices and micro-suppliers; verified before it pays; every payment on their record.</td></tr>
          </tbody>
        </table></div>
      </section>

      <section>
        <h2>The controls a lender needs first</h2>
        <div className="grid3">
          <div className="read"><p className="v">{o.refusedCount}</p><p className="k">refusals on record</p><p className="vs">Work that does not meet the brief is declined with the reason next to it. A record is only worth underwriting when the money behind it was verified before it moved.</p></div>
          <div className="read"><p className="v">1</p><p className="k">person, one slot</p><p className="vs">Public work asks for a one-time proof of personhood — no name, no document — so a bounty for fifty people is earned by fifty people. Every payment is screened against the sanctions list.</p></div>
          <div className="read"><p className="v">0</p><p className="k">amounts a model may set</p><p className="vs">The agent proposes; the funded plan and the vault decide the amount. Limits are enforced by code the agent cannot change, and every decision is on the public ledger.</p></div>
        </div>
        <p>The full statement of controls, custody and what is disclaimed: <Link href="/docs/compliance">/docs/compliance</Link>.</p>
      </section>

      <section>
        <h2>Proven, and scheduled</h2>
        <div className="tbl"><table>
          <thead><tr><th>Claim</th><th>Status</th><th>Evidence</th></tr></thead>
          <tbody>
            <tr><td>Autonomous verified payments on mainnet, two rails</td><td><span className="status done">proven</span></td><td><Link href="/explorer">/explorer</Link> · {o.payoutCount} payments, {decided} decisions</td></tr>
            <tr><td>Private payouts — the receipt proves the payment without publishing the recipient</td><td><span className="status done">proven</span></td><td><Link href={`/proof/${PRIVATE}`}>a private receipt</Link></td></tr>
            <tr><td>Verified cash-flow records and the lender&rsquo;s view</td><td><span className="status done">live</span></td><td><Link href={`/record/${RECORD}`}>a record</Link> · <Link href={`/lender?wallet=${RECORD}`}>its lender view</Link></td></tr>
            <tr><td>Obligations in {o.denominationsSupported} currencies at a stamped rate</td><td><span className="status done">live</span></td><td><Link href="/launch">/launch</Link></td></tr>
            <tr><td>Sanctions screening on every payment path · one person, one slot</td><td><span className="status done">live</span></td><td><Link href="/docs/compliance">/docs/compliance</Link> · <Link href="/verify">/verify</Link></td></tr>
            <tr><td>First working-capital advance disbursed and repaid from the next payouts</td><td><span className="status sched">scheduled this week</span></td><td>built, dry-run against live records · {o.advancesTotal > 0 ? `${o.advancesTotal} advances, ${o.advancesRepaid} repaid` : "the first run is scheduled"}</td></tr>
            <tr><td>First obligation priced in a Caribbean currency, settled</td><td><span className="status sched">scheduled this week</span></td><td>the J$10,000 seller grant</td></tr>
          </tbody>
        </table></div>
      </section>

      <section>
        <div className="ask">
          <h2>The system is built. It needs the institutions it was built for.</h2>
          <p>An MSME programme that wants its grants verified before they pay. A cooperative paying members for delivered work. A payroll for contractors across islands. A lending desk that would price verified cash flow instead of collateral. Twenty minutes with any of them is the next milestone.</p>
          <p>Built solo by Shariq Shaukat for Future Caribbean 2026. Reach the founder through the Future Caribbean community or on LinkedIn.</p>
          <Link href="/start" className="door">Put Sage to work →</Link>
        </div>
      </section>
    </main>
  );
}
