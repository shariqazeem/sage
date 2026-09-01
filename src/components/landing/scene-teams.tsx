import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Reveal } from "./reveal";

/**
 * INSIDE A COMPANY — Sage for teams. An employer or MSME hands gigs and milestone grants to
 * its own staff, contractors or grantees, off the public board, verified and paid the same
 * way. Shipped 2026-09-02; every line below describes what the product does today.
 */
export function SceneTeams() {
  return (
    <section id="teams" className="tm scene" aria-label="Sage for teams">
      <div className="wrap tm-grid">
        <Reveal className="reveal tm-copy">
          <span className="eyebrow">Inside a company</span>
          <h2 className="h2">Pay your own people for verified work — off the public board.</h2>
          <p className="lede tm-lede">
            Tick <b>Only people I invite</b> when you compose a gig or a milestone grant. The
            campaign never appears on the marketplace; you share its door with your team,
            contractors or grantees. Sage verifies each deliverable and pays it exactly as it
            would anyone else&rsquo;s — and every payout still lands on the person&rsquo;s own
            verified record.
          </p>
          <ul className="tm-list">
            <li><Check size={14} strokeWidth={2.6} /> Payroll for deliverables — no HR system, no invoices, no bank account on their side</li>
            <li><Check size={14} strokeWidth={2.6} /> Private-capable payouts: a team&rsquo;s pay is neither a public ledger nor a public listing</li>
            <li><Check size={14} strokeWidth={2.6} /> Price in your own currency; Sage converts once at a stamped rate</li>
          </ul>
          <Link href="/launch?do=pay" className="btn btn-primary tm-cta">
            Pay your team <ArrowRight size={16} strokeWidth={2.2} />
          </Link>
        </Reveal>
        <Reveal className="reveal tm-panel-wrap" threshold={0.2}>
          <div className="tm-panel">
            <div className="tm-panel-h mono">How it runs</div>
            <ol className="tm-steps">
              <li><b>Compose</b> the gig or grant — what, who, how it&rsquo;s verified, how much</li>
              <li><b>Invite only</b> — one checkbox keeps it off every public board</li>
              <li><b>Share the door</b> — your people open the link, do the work, submit</li>
              <li><b>Verified, paid, on record</b> — Sage judges, the vault releases, the receipt lands</li>
            </ol>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
