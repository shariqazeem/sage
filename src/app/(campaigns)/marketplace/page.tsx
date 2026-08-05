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
  title: "Marketplace — get paid to test products | Sage",
  description:
    "Every mission currently open on Sage. Do the work, describe what you saw, get paid in USDC from an on-chain vault with hard spending limits.",
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
              <h2 className="dash-h3">No missions are open right now.</h2>
              <p className="sage-hint">
                Every mission here is backed by a funded vault, so the list is empty whenever no
                campaign has an unfilled slot. It fills up again as founders launch.
              </p>
              <Link href="/launch" className="sage-btn sage-btn-primary">
                Launch your own campaign <ArrowRight size={15} />
              </Link>
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
