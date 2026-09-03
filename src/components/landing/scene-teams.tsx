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
          <span className="eyebrow">Sage for teams</span>
          <h2 className="h2">One workspace: invite your people, post the work, it gets verified and paid.</h2>
          <p className="lede tm-lede">
            Name a workspace and invite your team, contractors or grantees — by link, or by a
            Telegram link that gives them a wallet with no app and no seed phrase. Post a gig,
            a milestone grant or a testing run; members-only work never appears on a public board.
            Sage verifies each deliverable and pays it inside the budget you funded — and every
            payout still lands on the person&rsquo;s own verified record.
          </p>
          <ul className="tm-list">
            <li><Check size={14} strokeWidth={2.6} /> Free for you and two people; Pro for the whole team, paid in USDC from the same wallet</li>
            <li><Check size={14} strokeWidth={2.6} /> Private payouts on Starknet: a team&rsquo;s pay is neither a public ledger nor a public listing</li>
            <li><Check size={14} strokeWidth={2.6} /> Price in your own currency; Sage converts once at a stamped rate</li>
          </ul>
          <Link href="/workspace" className="btn btn-primary tm-cta">
            Open your workspace <ArrowRight size={16} strokeWidth={2.2} />
          </Link>
        </Reveal>
        <Reveal className="reveal tm-panel-wrap" threshold={0.2}>
          <div className="tm-panel">
            <div className="tm-panel-h mono">How it runs</div>
            <ol className="tm-steps">
              <li><b>Invite</b> — a link for wallets, a Telegram link for everyone else</li>
              <li><b>Post the work</b> — a gig, a grant or a testing run; members-only by default</li>
              <li><b>They deliver</b> — members see it in their workspace and on Telegram, and submit the link</li>
              <li><b>Verified, paid, on record</b> — Sage judges, the vault releases, the receipt lands</li>
            </ol>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
