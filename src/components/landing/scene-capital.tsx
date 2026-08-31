import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { usd } from "@/lib/format";
import { Reveal } from "./reveal";

/**
 * CAPITAL — what the payouts BECOME.
 *
 * Every other scene is about money going out: define the work, verify it, settle it. This is the
 * act that makes Sage infrastructure rather than a payments feature — the record it leaves behind
 * is an underwritable asset, and it is the only one on this page that speaks to a lender rather
 * than a founder.
 *
 * It sits after Proof deliberately. "A file you can lend against" is a claim nobody should accept
 * before they have seen the receipts it is built from, so the ledger has to come first and this
 * has to be its consequence.
 *
 * Every number here is settled money, never a projection: an advance figure Sage invented would be
 * the same failure as a model naming a payout amount.
 */
export function SceneCapital({
  totals,
}: {
  totals: { paidUsd: number; payoutCount: number; blockedCount: number };
}) {
  const decided = totals.payoutCount + totals.blockedCount;
  const refusalPct = decided > 0 ? Math.round((totals.blockedCount / decided) * 100) : 0;

  return (
    <section className="cap" id="capital" aria-label="Verified cash flow and underwriting">
      <Reveal className="reveal cap-in">
        <span className="eyebrow cap-eyebrow">
          <span className="dot" aria-hidden />
          Verified cash flow
        </span>

        <h2 className="cap-h">
          Every payout leaves a record
          <br />
          <span className="soft">a lender can underwrite.</span>
        </h2>

        <p className="cap-lede">
          For millions of people, the work is real and the paperwork does not exist. No payslip, no
          filings, no bureau file — so the credit is not available either. Sage already verified the
          work and moved the money, which means the evidence a lender needs was produced as a
          by-product of getting someone paid.
        </p>

        <div className="cap-grid">
          <article className="cap-card">
            <span className="cap-k mono">01</span>
            <h3 className="cap-ch">Settlement</h3>
            <p className="cap-cb">
              Each payout is anchored to an on-chain transaction, inside caps the agent cannot
              exceed. Refusals are recorded with the same weight as approvals.
            </p>
            <Link href="/explorer" className="cap-link">
              Every settlement and refusal <ArrowRight size={13} strokeWidth={2} />
            </Link>
          </article>

          <article className="cap-card">
            <span className="cap-k mono">02</span>
            <h3 className="cap-ch">The credit file</h3>
            <p className="cap-cb">
              Inflow over 30 and 90 days, refusal rate, distinct counterparties, tenure and
              recency — computed from settled transactions by published formulas. Sage states
              facts and scores nobody.
            </p>
            <span className="cap-note">Every earner has one, at /record</span>
          </article>

          <article className="cap-card">
            <span className="cap-k mono">03</span>
            <h3 className="cap-ch">The advance</h3>
            <p className="cap-cb">
              A lender supplies the multiple; Sage applies it to verified 90-day inflow and
              publishes the arithmetic. Capital can move before the next invoice clears, and only
              under the same policy that releases every other dollar.
            </p>
            <Link href="/lender" className="cap-link">
              Underwrite verified cash flow <ArrowRight size={13} strokeWidth={2} />
            </Link>
          </article>
        </div>

        <div className="cap-stats mono">
          <span className="cap-stat">
            <b>{usd(totals.paidUsd)}</b> settled
          </span>
          <span className="cap-dot" aria-hidden />
          <span className="cap-stat">
            <b>{totals.payoutCount}</b> anchored transaction{totals.payoutCount === 1 ? "" : "s"}
          </span>
          <span className="cap-dot" aria-hidden />
          {/* The refusal rate is the compliance story, not a blemish: a file that only ever says
              yes proves nothing about the ones it approved. */}
          <span className="cap-stat">
            <b>{refusalPct}%</b> refused on record
          </span>
        </div>
      </Reveal>
    </section>
  );
}
