import type { Metadata } from "next";
import Link from "next/link";
import { ReadHead, ReadPage } from "@/components/site/read-page";
import { humanWait } from "@/components/marketplace/wait-strip";
import { CURRENCIES } from "@/lib/money/currency";
import { usd } from "@/lib/format";
import { publicReadings } from "@/lib/site/readings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sage in the Caribbean: work priced in J$, TT$ or EC$, paid in USDC",
  description:
    "Pay people across the Caribbean for verified work: priced in the region's own currencies, paid in USDC within minutes with no fee taken from the person paid, and recorded as verified income a lender can read.",
  alternates: { canonical: "/caribbean" },
};

/** The first payout Sage made on its own: a person's account of their work, judged and paid $1. */
const FIRST = "0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069";
/** A private payout: the receipt proves the payment without naming who collected it. */
const PRIVATE = "0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb";
/** The J$ rehearsal (6 Sep 2026): our own wallet stood in for the seller, and took the first advance. */
const REHEARSAL = "0x04f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
const JMD_ONE = "0x72838f509d6dae3e570e6536167c166f06d4a92f68fce849c10fe1b29983f8";
const JMD_TWO = "0x2337afda7ef311c4bd515d66feb78f0903f16b3cc23e49ef7fb7702fe1bb54";

/**
 * SAGE IN THE CARIBBEAN (restored 20 Oct 2026; it folded into the home page on 19 Oct).
 *
 * Sage is one global product; this page is what it means in the region it was first built with,
 * through Future Caribbean 2026. Every figure is read from the ledger as the page loads
 * (src/lib/site/readings.ts), every claim links to its evidence, and what is not built yet (cash-out
 * in local currency, funding from a bank) is said plainly rather than implied.
 */
export default function CaribbeanPage() {
  const r = publicReadings();
  const settled = new Set(r.denominated.currencies);
  const region = CURRENCIES.filter((c) => c.region === "caribbean");
  const senders = CURRENCIES.filter((c) => c.region === "sender");
  const corridors = r.corridors.filter((c) => c.pct !== null);

  return (
    <ReadPage>
      <ReadHead eyebrow="Sage in the Caribbean" title="Work priced in your currency. Paid in minutes. On the record.">
        <p className="lead">
          Sage pays people for verified work wherever USDC reaches. Across the Caribbean, a cooperative, a programme or
          a business can price the work in J$, TT$, EC$ or Bds$, and every payout becomes part of a record of verified
          income a lender can read.
        </p>
        <div className="hero-cta">
          <Link href="/start" className="btn btn-primary">
            Start free
          </Link>
          <Link href="/company#contact" className="btn btn-quiet">
            Talk to us
          </Link>
        </div>
      </ReadHead>

      <div className="site-wrap read-col">
        <div className="read-figs three" aria-label="Read from the ledger as this page loads">
          <div className="read-fig">
            <div className="read-fig-v">{usd(r.paidUsd)}</div>
            <div className="read-fig-k">paid in USDC, on real money</div>
          </div>
          <div className="read-fig">
            <div className="read-fig-v">{r.people}</div>
            <div className="read-fig-k">{r.people === 1 ? "person" : "people"} paid, no application</div>
          </div>
          <div className="read-fig">
            <div className="read-fig-v">{r.medianWaitSeconds === null ? "Not yet" : humanWait(r.medianWaitSeconds)}</div>
            <div className="read-fig-k">median wait, checking included</div>
          </div>
        </div>

        <section className="read-sec" id="how">
          <h2>How a payment becomes a credit record</h2>
          <p>Five steps, each one live. Open any of them: they are the product, not a description of it.</p>
          <ol className="read-steps">
            <li>
              <h3>Say the work, in your own currency</h3>
              <p>
                A buyer, a programme or a cooperative describes the work once, for example &ldquo;J$10,000 in two
                milestones&rdquo;, and funds it once. Sage turns it into milestones, each with a rule for checking it, and
                stamps the exchange rate.
              </p>
              <Link href="/launch" className="more">
                Post work
              </Link>
            </li>
            <li>
              <h3>Sage checks, then pays</h3>
              <p>
                It reads the delivered work itself and pays from a vault whose limits it cannot change. Every payout gets a
                public receipt, and every refusal gets its reason.
              </p>
              <Link href={`/proof/${FIRST}`} className="more">
                The first receipt
              </Link>
            </li>
            <li>
              <h3>The record writes itself</h3>
              <p>
                Verified income over 30 and 90 days, distinct payers, months active and pass rate: published formulas over
                receipts, never a score. It downloads as JSON or CSV, and prints as a statement a person can hand to a
                bank.
              </p>
              <Link href="/record" className="more">
                How records work
              </Link>
            </li>
            <li>
              <h3>The money is the person&apos;s</h3>
              <p>
                Payouts arrive in USDC in the person&apos;s own wallet, or, on the private rail, are collected with a
                one-time link to any address. Turning USDC into local currency happens outside Sage today, wherever the
                person already does it.
              </p>
              <Link href="/docs/payments" className="more">
                How payouts reach people
              </Link>
            </li>
            <li>
              <h3>A lender reads it</h3>
              <p>
                Borrowing capacity as published arithmetic over verified income. An advance drawn against it is repaid
                from the next verified payouts, automatically.
              </p>
              <Link href="/lender" className="more">
                The lender&apos;s view
              </Link>
            </li>
          </ol>
        </section>

        <section className="read-sec" id="currencies">
          <h2>Priced in the region&apos;s money, paid in digital dollars</h2>
          <p>
            Work is written in the currency the seller thinks in and converted once, at a stamped rate with its source
            named. It is always paid in USDC, so the money spends anywhere and the record compares everywhere. The
            currencies of the diaspora that sends work home are priced the same way.
          </p>
          <ul className="read-chips" aria-label="Caribbean currencies">
            {region.map((c) => (
              <li key={c.code} className={settled.has(c.code) ? "on" : undefined} title={c.name}>
                {c.symbol} {c.code}
              </li>
            ))}
          </ul>
          <ul className="read-chips" aria-label="Diaspora currencies">
            {senders.map((c) => (
              <li key={c.code} className={settled.has(c.code) ? "on" : undefined} title={c.name}>
                {c.symbol} {c.code}
              </li>
            ))}
          </ul>
          {corridors.length > 0 && (
            <>
              <p>What sending $200 into these countries costs today, from the World Bank&apos;s latest published figures:</p>
              <div className="read-table wide">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Receiving country</th>
                      <th scope="col">Cost of sending $200</th>
                      <th scope="col">On Sage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corridors.map((c) => (
                      <tr key={c.country}>
                        <td>{c.countryName}</td>
                        <td className="num">
                          {c.pct!.toFixed(2)}% <span className="faint">({c.year})</span>
                        </td>
                        <td>No fee taken from the payout</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="read-src">
                Source: <a href={r.corridorSource.url}>{r.corridorSource.name}</a>, fetched {r.corridorSource.fetchedOn}.
                More readings on <Link href="/outcomes">outcomes</Link>.
              </p>
            </>
          )}
        </section>

        <section className="read-sec" id="institutions">
          <h2>For institutions</h2>
          <p>
            Everything a lender, a programme or a payroll needs is a page or a call. Records are public by default, so
            there is no data-sharing agreement to negotiate to read one.
          </p>
          <div className="read-table wide">
            <table>
              <thead>
                <tr>
                  <th scope="col">Need</th>
                  <th scope="col">Where</th>
                  <th scope="col">What you get</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>A worker&apos;s verified income record</td>
                  <td>
                    <code>GET /api/record/&lt;wallet&gt;</code>
                  </td>
                  <td>
                    JSON (<code>sage.work-record.v4</code>): every verified payout with its transaction, the income signals
                    with their formula version, linked wallets and advances.
                  </td>
                </tr>
                <tr>
                  <td>The same record for a spreadsheet</td>
                  <td>
                    <code>GET /api/record/&lt;wallet&gt;/export</code>
                  </td>
                  <td>One row per payout: date, payer, job, amount, transaction, receipt.</td>
                </tr>
                <tr>
                  <td>A statement to hand to a bank</td>
                  <td>
                    <code>/record/&lt;wallet&gt;/statement</code>
                  </td>
                  <td>A printable verified income statement, with a link to the live record and a digest that matches it.</td>
                </tr>
                <tr>
                  <td>Underwriting on verified income</td>
                  <td>
                    <Link href="/lender">/lender</Link>
                  </td>
                  <td>Borrowing capacity as published arithmetic. The lender sets the multiple.</td>
                </tr>
                <tr>
                  <td>Paying your own people</td>
                  <td>Team, in the app</td>
                  <td>
                    Paste a list (a cooperative&apos;s members, a cohort, a team) and get one single-use invite per person to
                    forward on WhatsApp. They join with an email, and every payment lands on their record. Each
                    member&apos;s record and statement open from the same screen.
                  </td>
                </tr>
                <tr>
                  <td>Paying one person for one thing</td>
                  <td>
                    <Link href="/launch?do=pay&invite=1&one=1">Post, pay one person</Link>
                  </td>
                  <td>
                    A supplier, a contractor, a grantee: say what must be true, price it in your currency, share the invite.
                    Checked before it pays.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="read-sec" id="controls">
          <h2>The controls a lender asks about first</h2>
          <div className="read-figs three">
            <div className="read-fig">
              <div className="read-fig-v">{r.refused}</div>
              <div className="read-fig-k">refusals on record</div>
              <p>Work that does not meet the brief is declined with the reason beside it. A record is worth reading only when the money behind it was checked before it moved.</p>
            </div>
            <div className="read-fig">
              <div className="read-fig-v">1</div>
              <div className="read-fig-k">person, one slot</div>
              <p>Public work can ask for a one-time proof of personhood, with no name and no document, so a bounty for fifty people is earned by fifty people.</p>
            </div>
            <div className="read-fig">
              <div className="read-fig-v">0</div>
              <div className="read-fig-k">amounts a model may set</div>
              <p>The AI proposes; the funded plan and the vault set the amount. The limits are code the AI cannot change.</p>
            </div>
          </div>
          <p>
            Ethereum-style wallets are checked against the US sanctions list when they submit work and again before an
            automatic payout. The full statement of controls, custody and what is not covered is in{" "}
            <Link href="/docs/trust#compliance">Safety and limits</Link>.
          </p>
        </section>

        <section className="read-sec" id="proven">
          <h2>Proven so far</h2>
          <div className="read-table wide">
            <table>
              <thead>
                <tr>
                  <th scope="col">Claim</th>
                  <th scope="col">Status</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Payouts on real money, decided by the agent</td>
                  <td>
                    <span className="read-status">live</span>
                  </td>
                  <td>
                    <Link href="/ledger">The ledger</Link>: {r.payouts} payouts, {r.refused} refusals
                  </td>
                </tr>
                <tr>
                  <td>Private payouts: the receipt proves the payment without naming who collected it</td>
                  <td>
                    <span className="read-status">live</span>
                  </td>
                  <td>
                    <Link href={`/proof/${PRIVATE}`}>A private receipt</Link>
                  </td>
                </tr>
                <tr>
                  <td>Verified income records, statements and the lender&apos;s view</td>
                  <td>
                    <span className="read-status">live</span>
                  </td>
                  <td>
                    <Link href="/record">Records</Link> and <Link href="/lender">the lender&apos;s view</Link>
                  </td>
                </tr>
                <tr>
                  <td>Work priced in {r.currenciesSupported} currencies at a stamped rate</td>
                  <td>
                    <span className="read-status">live</span>
                  </td>
                  <td>
                    <Link href="/launch">Post work</Link>
                  </td>
                </tr>
                <tr>
                  <td>A grant priced in Jamaican dollars, paid in two milestones</td>
                  <td>
                    <span className="read-status">6 Sep 2026</span>
                  </td>
                  <td>
                    J$1,600 in two milestones of J$800, each released on the private rail when its evidence checked out. A
                    rehearsal, with our own wallet standing in for the seller:{" "}
                    <Link href={`/proof/${JMD_ONE}`}>receipt one</Link>, <Link href={`/proof/${JMD_TWO}`}>receipt two</Link>
                  </td>
                </tr>
                <tr>
                  <td>A working-capital advance, drawn and repaid from the next payout</td>
                  <td>
                    <span className="read-status">6 Sep 2026</span>
                  </td>
                  <td>
                    In the same rehearsal: $1.85 drawn against verified income twelve minutes after the first payout, repaid
                    in full from the second. <Link href={`/record/${REHEARSAL}`}>The record</Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="read-sec" id="next">
          <h2>Not built yet</h2>
          <p>
            Each of these needs a licensed partner in its market. Sage never holds anyone&apos;s money in a local currency.
          </p>
          <ul>
            <li>
              <strong>Cash out in local currency</strong>, to a bank account or a mobile wallet, through a licensed
              partner who does the identity checks.
            </li>
            <li>
              <strong>Fund work from a bank account or a card</strong>, so a cooperative never has to touch a crypto
              exchange.
            </li>
            <li>
              <strong>Post, deliver and get paid on WhatsApp</strong>, the way the Telegram door works today.
            </li>
          </ul>
        </section>

        <section className="read-sec" id="talk">
          <h2>Built for the institutions that pay many people</h2>
          <p>
            An MSME programme that wants its grants checked before they pay. A cooperative paying members for delivered
            work. A payroll for contractors across islands. A lending desk that would rather price verified income than
            collateral. Twenty minutes with any of them is the next step.
          </p>
          <div className="read-cta">
            <Link href="/company#contact" className="btn btn-primary">
              Talk to us
            </Link>
            <Link href="/start" className="btn btn-quiet">
              Start free
            </Link>
          </div>
        </section>

        <div className="read-foot">
          <p>
            Every figure on this page is read from the <Link href="/ledger">ledger</Link> as it loads. The four readings
            behind it, with their arithmetic, are on <Link href="/outcomes">outcomes</Link>.
          </p>
        </div>
      </div>
    </ReadPage>
  );
}
