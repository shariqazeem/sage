import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { marketplace } from "@/lib/campaigns/marketplace";
import { MarketplaceBoard } from "@/components/marketplace/marketplace-board";
import { PayoutProof } from "@/components/marketplace/payout-proof";
import "@/styles/tester-board.css";
import "@/styles/marketplace.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get paid to test products",
  description:
    "Every paid testing mission open on Sage right now. Pick one, do the task, describe what you saw, and get paid in USDC. No application and no interview: an AI agent checks your evidence against what it observed in the product itself.",
  alternates: { canonical: "/marketplace" },
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/**
 * /marketplace — the public board of paid testing work.
 *
 * Sage could only be found one campaign at a time, through a link a founder sent. This is the other
 * side of the market: founders get testers they never had to recruit, testers get a list of paid
 * work. Mission-first and horizontal, because people pick a TASK and want to compare rewards without
 * opening three pages to do it.
 *
 * Only work that can actually pay is listed — live campaign, open mission, unfilled slot. An empty
 * marketplace says so plainly rather than dressing up nothing as something.
 */
export default function MarketplacePage() {
  const { rows, totals, recentPayouts, paidToDate } = marketplace();

  return (
    <main className="sb-board mk-page">
      <header className="mk-hero">
        <div>
          <div className="sage-eyebrow">Marketplace</div>
          <h1 className="dash-display mk-title">Get paid to test real products.</h1>
          <p className="mk-lede">
            Founders fund a vault up front. Do one short, specific task, describe what you actually
            saw, and the agent pays you in USDC. No application, no interview.
          </p>
        </div>
        {totals.slots > 0 && (
          <div className="mk-hero-stats">
            <span className="mk-hstat">
              <span className="mk-hstat-v mono">{usd(totals.usd)}</span>
              <span className="mk-hstat-k">available now</span>
            </span>
            <span className="mk-hstat">
              <span className="mk-hstat-v mono">{totals.slots}</span>
              <span className="mk-hstat-k">open slots</span>
            </span>
            <span className="mk-hstat">
              <span className="mk-hstat-v mono">{totals.missions}</span>
              <span className="mk-hstat-k">{totals.missions === 1 ? "mission" : "missions"}</span>
            </span>
          </div>
        )}
      </header>

      <div className="mk-cols">
        <div className="mk-main">
          {rows.length === 0 ? (
            <section className="mk-empty">
              {/*
                AN EMPTY BOARD IS A MOMENT, NOT A VERDICT.
                Every mission is backed by a funded vault, so the list empties whenever the last
                slot fills — which is the system working, not failing. But the page led with the
                emptiness while the proof that any of it works sat demoted in the side column, so
                the first thing a visitor met was "nothing here" and "$0.00 available". Lead with
                what has actually been paid; the absence is the second sentence, not the headline.
              */}
              <h2 className="dash-h3">
                {paidToDate.count > 0
                  ? `${paidToDate.count} payouts to real testers so far.`
                  : "No missions are open right now."}
              </h2>
              <p className="sage-hint">
                {paidToDate.count > 0
                  ? "Every mission here is backed by a funded vault, so the board empties whenever the last slot fills — that is the system working, not failing. New work appears as founders launch, and every payout is anchored on-chain and checkable."
                  : "Every mission here is backed by a funded vault, so the list is empty whenever no campaign has an unfilled slot. It fills up again as founders launch."}
              </p>
              <div className="mk-empty-actions">
                <Link href="/explorer" className="sage-btn">
                  See every payout and refusal <ArrowRight size={15} />
                </Link>
                <Link href="/launch" className="sage-btn sage-btn-primary">
                  Launch your own campaign <ArrowRight size={15} />
                </Link>
              </div>
            </section>
          ) : (
            <MarketplaceBoard rows={rows} />
          )}
        </div>
        <PayoutProof
          payouts={recentPayouts}
          paidToDate={paidToDate}
          availableUsd={totals.usd}
          openSlots={totals.slots}
        />
      </div>

      <footer className="mk-foot">
        <p className="sage-hint">
          <ShieldCheck size={13} /> Every payout comes from an on-chain vault the agent cannot
          exceed, and publishes a receipt you can verify yourself.
        </p>
      </footer>
    </main>
  );
}
