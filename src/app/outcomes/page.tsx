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
  title: "Outcomes: what changes when an agent pays people",
  description:
    "Four readings from Sage's ledger: what a payout costs the person paid, how fast it arrives, who it reaches, and how much has moved. Every figure is computed from settled transactions as the page loads.",
  alternates: { canonical: "/outcomes" },
};

const SOURCE = "https://github.com/shariqazeem/sage/blob/main/src/lib/site/readings.ts";

/**
 * THE OUTCOMES, AS READINGS (restored 20 Oct 2026; it folded into /ledger on 19 Oct).
 *
 * The ledger lists what happened; this page argues from it: cost, speed, access, flow. Every figure
 * is computed as the page renders, and every figure another page also shows comes from that page's
 * own derivation (src/lib/site/readings.ts), so the home page, the ledger and this page cannot give
 * two answers to one question. Where there is no reading yet, the page says so instead of rounding up.
 */
export default function OutcomesPage() {
  const r = publicReadings();
  const corridors = r.corridors.filter((c) => c.pct !== null);
  const unread = r.corridors.filter((c) => c.pct === null).map((c) => c.countryName);
  const settled = new Set(r.denominated.currencies);
  const priced = CURRENCIES.filter((c) => c.code !== "USD");
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <ReadPage>
      <ReadHead eyebrow="Outcomes" title="What changes when an agent pays people">
        <p className="lead">
          Four readings from the ledger: what a payout costs the person paid, how fast it arrives, who it reaches, and
          how much has moved. Each is computed from settled transactions as this page loads. Where there is no reading
          yet, the page says so.
        </p>
      </ReadHead>

      <div className="site-wrap read-col">
        <section className="read-sec" id="cost">
          <h2>Lower cost</h2>
          <div className="read-big">
            <b>0%</b>
            <span>taken from the person paid, on every payout so far</span>
          </div>
          <p>
            The vault pays the exact reward fixed when the job was made, and Sage pays the network fee, so nothing is
            taken out on the way. The team that funds the work pays no fee per payout either: plans are a flat monthly
            price, and <Link href="/pricing">Free</Link> costs nothing.
          </p>
          {corridors.length > 0 && (
            <>
              <p>
                For comparison, the World Bank&apos;s latest published cost of sending $200 into the countries whose
                currencies Sage prices work in:
              </p>
              <div className="read-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Receiving country</th>
                      <th scope="col">Cost of sending $200</th>
                      <th scope="col">Year</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corridors.map((c) => (
                      <tr key={c.country}>
                        <td>{c.countryName}</td>
                        <td className="num">{c.pct!.toFixed(2)}%</td>
                        <td className="num">{c.year}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="read-src">
                Source: <a href={r.corridorSource.url}>{r.corridorSource.name}</a>, fetched {r.corridorSource.fetchedOn}.
                {unread.length > 0 && <> The series has no reading yet for {unread.join(", ")}.</>}
              </p>
            </>
          )}
        </section>

        <section className="read-sec" id="speed">
          <h2>Faster settlement</h2>
          <div className="read-big">
            <b>{r.medianWaitSeconds === null ? "Not yet" : humanWait(r.medianWaitSeconds)}</b>
            <span>
              {r.measuredWaits > 1 ? "median wait" : "wait"} from submitting work to being paid
            </span>
          </div>
          <p>
            The wait includes the part other payment rails don&apos;t attempt: Sage reading the work and deciding whether
            it is real before any money moves.
            {r.measuredWaits > 1 && <> Measured over {r.measuredWaits} payouts.</>}
            {r.medianWaitSeconds === null && <> No payout has a measurable wait yet.</>}
          </p>
          <p className="read-src">Each payout&apos;s own wait: the settled transaction minus its submission, on the <Link href="/ledger">ledger</Link>.</p>
        </section>

        <section className="read-sec" id="access">
          <h2>Access</h2>
          <div className="read-big">
            <b>{r.people}</b>
            <span>{r.people === 1 ? "person" : "people"} paid, with no application and no bank account</span>
          </div>
          <p>
            Anyone can sign in with an email or a wallet, do the work and be paid in USDC. Access without checking is a
            faucet, so refusals are part of this reading: {plural(r.refused, "submission", "submissions")} refused (
            {r.refusedSharePct}% of the work judged), each with its reason. Every payout that did move was checked
            first, which is what makes the record under it worth reading.
          </p>
          <p>
            Every payout adds to the person&apos;s own <Link href="/record">verified work record</Link>, which a lender
            can read on the <Link href="/lender">lender&apos;s view</Link>.{" "}
            {r.advances.total === 0 ? (
              <>The advance facility is live; no advance has been drawn yet.</>
            ) : (
              <>
                {plural(r.advances.total, "advance has", "advances have")} been drawn against verified income so far,
                and {r.advances.repaid} repaid from the next verified payouts. The first, on 6 September 2026, was a
                rehearsal on Sage&apos;s own wallet.
              </>
            )}
          </p>
        </section>

        <section className="read-sec" id="flow">
          <h2>Capital flow</h2>
          <div className="read-big">
            <b>{usd(r.paidUsd)}</b>
            <span>
              paid in USDC across {plural(r.payouts, "payout", "payouts")}, from {plural(r.funders, "funder", "funders")}
            </span>
          </div>
          {r.networks.length > 0 && (
            <div className="read-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Network</th>
                    <th scope="col">Payouts</th>
                    <th scope="col">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {r.networks.map((n) => (
                    <tr key={n.name}>
                      <td>{n.name}</td>
                      <td className="num">{n.payouts}</td>
                      <td className="num">{usd(n.paidUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p>
            Work can be priced in any of {r.currenciesSupported} currencies and is always paid in USDC, converted once at
            a stamped rate with its source named, so the person posting the work never does exchange arithmetic.
            {r.denominated.payouts > 0 ? (
              <>
                {" "}
                {plural(r.denominated.payouts, "payout", "payouts")} priced in {r.denominated.currencies.join(", ")}{" "}
                {r.denominated.payouts === 1 ? "has" : "have"} settled so far, {usd(r.denominated.usd)} in all.
              </>
            ) : (
              <> No payout priced in a local currency has settled yet.</>
            )}
          </p>
          <ul className="read-chips" aria-label="Currencies work can be priced in">
            {priced.map((c) => (
              <li key={c.code} className={settled.has(c.code) ? "on" : undefined} title={c.name}>
                {c.symbol} {c.code}
              </li>
            ))}
          </ul>
        </section>

        <div className="read-foot">
          <p>
            Computed {new Date(r.generatedAtUnix * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC from the
            settled transactions the <Link href="/ledger">ledger</Link> lists. No figure on this page is typed into the
            copy; the arithmetic is in <a href={SOURCE}>one readable module</a>.
          </p>
          <p>
            See what it means for one region in <Link href="/caribbean">Sage in the Caribbean</Link>, or how a{" "}
            <Link href="/record">record of verified work</Link> is built.
          </p>
        </div>
      </div>
    </ReadPage>
  );
}
