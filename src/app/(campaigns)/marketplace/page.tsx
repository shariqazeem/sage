import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { marketplace } from "@/lib/campaigns/marketplace";
import { MarketplaceBoard } from "@/components/marketplace/marketplace-board";
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
  const { rows, totals } = marketplace();

  return (
    <main className="sb-shell mk-shell">
      <header className="mk-hero sage-stagger">
        <div className="sage-eyebrow">Marketplace</div>
        <h1 className="dash-display mk-title">Get paid to test real products.</h1>
        <p className="mk-lede">
          Founders fund a vault up front. You do one short, specific task and describe what you
          actually saw. Sage checks the evidence and pays in USDC — no application, no interview.
        </p>

        {totals.slots > 0 && (
          <div className="mk-totals mono">
            <span>
              <strong>{totals.slots}</strong> open {totals.slots === 1 ? "slot" : "slots"}
            </span>
            <span aria-hidden>·</span>
            <span>
              <strong>{totals.missions}</strong> {totals.missions === 1 ? "mission" : "missions"}
            </span>
            <span aria-hidden>·</span>
            <span>
              <strong>{usd(totals.usd)}</strong> available now
            </span>
          </div>
        )}
      </header>

      {rows.length === 0 ? (
        <section className="mk-empty">
          <h2 className="dash-h3">No missions are open right now.</h2>
          <p className="sage-hint">
            Every mission here is backed by a funded vault, so the list is empty whenever no campaign
            has an unfilled slot. It fills up again as founders launch.
          </p>
          <Link href="/launch" className="sage-btn sage-btn-primary">
            Launch your own campaign <ArrowRight size={15} />
          </Link>
        </section>
      ) : (
        <MarketplaceBoard rows={rows} />
      )}

      <footer className="mk-foot">
        <p className="sage-hint">
          <ShieldCheck size={13} /> Every payout comes from an on-chain vault the agent cannot
          exceed, and publishes a receipt you can verify yourself.
        </p>
      </footer>
    </main>
  );
}
