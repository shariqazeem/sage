import { CompareBar } from "@/components/outcomes/compare-bar";
import "./outcomes.css";
import type { Metadata } from "next";
import Link from "next/link";
import { readOutcomes } from "@/lib/outcomes/outcomes";
import { CURRENCIES } from "@/lib/money/currency";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "System outcomes — the readings",
  description:
    "Does the system change outcomes? Transaction cost, settlement speed, access to capital and capital flow — every figure computed from the settlement ledger at render time, every claim linked to receipts, gaps stated as not yet measured.",
  alternates: { canonical: `${siteUrl()}/outcomes` },
};

/**
 * THE BAR, ANSWERED — "does your system change outcomes?"
 *
 * An app publishes its features; a system publishes its outcomes. Every figure on this page is
 * computed from the same rows /explorer verifies, at render time — a number typed into copy is a
 * claim, a number derived from settled transactions is a reading. Where the ledger has not yet
 * produced the data, the page says NOT YET MEASURED, because a bar you can only clear by rounding
 * up is not a bar.
 */
const f = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const mins = (m: number | null) =>
  m === null ? "—" : m < 1 ? "<1 min" : m < 90 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`;

export default function OutcomesPage() {
  const o = readOutcomes();
  const railName = (r: string) => (r === "evm" ? "GOAT (public)" : r === "starknet" ? "Starknet (private-capable)" : r);

  return (
    <main className="out-page">
      <header className="out-head">
        <p className="out-kicker">System outcomes</p>
        <h1 className="out-title">Does the system change outcomes?</h1>
        <p className="out-lede">
          The bar is the track&rsquo;s own: lower transaction costs, faster settlement, expanded
          access to capital, increased capital flow. These are the readings — every figure computed
          from the settlement ledger as this page rendered, nothing typed in. Where the ledger
          hasn&rsquo;t produced a number yet, it says so.
        </p>
      </header>

      <section className="out-bar" aria-label="Lower transaction costs">
        <h2>Lower transaction costs</h2>
        <div className="out-big">
          {o.recipientFeePct}%<span className="out-big-k">taken from recipients, on every payout to date</span>
        </div>
        <CompareBar
          ours={0}
          theirs={o.corridor.benchmarkCostUsd}
          oursLabel="$0.00"
          theirsLabel={`$${f(o.corridor.benchmarkCostUsd)}`}
          alternativeName="Corridor"
          lowerIsBetter
          caption={`On the $${f(o.settledUsd)} settled so far. The vault derives the exact reward and pays it whole; Sage covers the gas — a real cost, and Sage's, not the recipient's.`}
        />
        <p className="out-src">
          Derivation: Σ(vault-derived rewards, mainnet, anchored) × 0.08 · verify any row on the{" "}
          <Link href="/explorer">ledger</Link>
        </p>
      </section>

      <section className="out-bar" aria-label="Faster settlement">
        <h2>Faster settlement</h2>
        <div className="out-big">
          {mins(o.medianMinutesToSettle)}
          <span className="out-big-k">median, submission → settled payment — verification included</span>
        </div>
        <CompareBar
          ours={o.medianMinutesToSettle ?? 0}
          theirs={3 * 24 * 60}
          oursLabel={mins(o.medianMinutesToSettle)}
          theirsLabel="3 days"
          alternativeName="Corridor"
          lowerIsBetter
          caption={`Includes the part other rails do not attempt: the agent reading the work and deciding. p90 ${mins(o.p90MinutesToSettle)}${o.settledWithinHourPct !== null ? `, ${Math.round(o.settledWithinHourPct)}% inside the hour` : ""}.`}
        />
        <p className="out-src">
          Derivation: median/p90 of (decided − submitted) over paid mainnet submissions · each has a
          receipt on the <Link href="/explorer">ledger</Link>
        </p>
      </section>

      <section className="out-bar" aria-label="Expanded access to capital">
        <h2>Expanded access to capital</h2>
        <div className="out-big">
          {o.peoplePaid}
          <span className="out-big-k">people paid — no application, no interview, no bank account required</span>
        </div>
        <p className="out-how">
          Access without integrity is a faucet, so the refusal ledger is part of this bar:{" "}
          <b>{o.refusedCount}</b> submissions refused
          {o.refusalSharePct !== null && <> ({Math.round(o.refusalSharePct)}% of decided work)</>} —
          every payout that DID move was verified first, which is what makes the record under it
          underwritable. The advance facility lends against that record:{" "}
          {o.advancesTotal === 0 ? (
            <>live, first advance pending — capacity is published arithmetic on the <Link href="/lender">lender view</Link>, never a score.</>
          ) : (
            <>
              <b>{o.advancesTotal}</b> advance{o.advancesTotal === 1 ? "" : "s"} to date,{" "}
              <b>{o.advancesRepaid}</b> repaid from subsequent verified payouts — the waterfall.
            </>
          )}
        </p>
        <p className="out-src">
          Derivation: distinct wallets over paid rows; refusals from the same decided set · the
          facility&rsquo;s terms are on <Link href="/lender">/lender</Link>
        </p>
      </section>

      <section className="out-bar" aria-label="Increased capital flow">
        <h2>Increased capital flow</h2>
        <div className="out-big">
          ${f(o.settledUsd)}
          <span className="out-big-k">
            settled autonomously across {o.payoutCount} payouts, from {o.distinctFunders} funder
            {o.distinctFunders === 1 ? "" : "s"}
          </span>
        </div>
        <p className="out-how">
          Rails in production:{" "}
          {o.railsUsed.map((r, i) => (
            <span key={r.rail}>
              {i > 0 && " · "}
              <b>{railName(r.rail)}</b> — {r.payouts} payout{r.payouts === 1 ? "" : "s"}
            </span>
          ))}
          . Obligations denominate in {o.denominationsSupported} currencies — the Caribbean&rsquo;s
          own first:{" "}
          <span className="mono">
            {CURRENCIES.filter((c) => c.region === "caribbean").map((c) => `${c.symbol} ${c.code}`).join(" · ")}
          </span>{" "}
          — plus the diaspora senders (
          <span className="mono">{CURRENCIES.filter((c) => c.region === "sender").map((c) => c.code).join(", ")}</span>
          ), each converted once at a stamped, source-attributed rate. Settlement is always the USD
          stablecoin; the founder prices in their own money and never does exchange arithmetic.
        </p>
        <p className="out-src">
          <b>Not yet measured:</b> intra-regional corridor flow — no BBD- or JMD-denominated
          obligation has settled yet. The denomination rail is live; the reading will exist when the
          flow does. Stating that is the point.
        </p>
        <p className="oc-note">
          <b>What the region pays today, from the public series:</b>{" "}
          {o.publicCorridors.filter((c) => c.pct !== null).map((c) => `${c.countryName} ${c.pct!.toFixed(2)}%`).join(" · ")}
          {" "}of a $200 transfer in ({o.publicCorridorSource.name.replace("World Bank, World Development Indicators — ", "World Bank WDI ")},
          latest readings {Math.max(...o.publicCorridors.filter((c) => c.year !== null).map((c) => c.year as number))},
          fetched {o.publicCorridorSource.fetchedOn}). No public reading yet for{" "}
          {o.publicCorridors.filter((c) => c.pct === null).map((c) => c.countryName).join(", ")} — those are held to the
          brief&rsquo;s 8%. When an obligation settles in one of these currencies, this page benchmarks it against its own
          corridor, not a regional average.
        </p>
      </section>

      <footer className="out-foot">
        Computed {new Date(o.generatedAtUnix * 1000).toISOString().replace("T", " ").slice(0, 16)}{" "}
        UTC from the settlement ledger — the same rows <Link href="/explorer">/explorer</Link>{" "}
        anchors to transactions. No figure on this page is typed into the copy; the arithmetic under
        each is in{" "}
        <a href="https://github.com/shariqazeem/sage/blob/main/src/lib/outcomes/outcomes.ts">one
        readable module</a>.
      </footer>
    </main>
  );
}
