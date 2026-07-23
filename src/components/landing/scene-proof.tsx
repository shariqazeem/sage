import Link from "next/link";
import { Check, X, ArrowUpRight, Radio } from "lucide-react";
import { usd, short, since } from "@/lib/format";
import type { PayoutReceipt } from "@/lib/deputy/chain";
import { Reveal } from "./reveal";

/**
 * PROOF — "Every decision leaves a receipt." One featured settled receipt, then the live
 * chronological rail of settled AND held decisions, each linking to its real /proof/<tx>.
 * Every number comes from the same server `feed`, so nothing here can disagree with the
 * hero. Empty feed → an honest waiting state, never fabricated rows.
 */
export function SceneProof({
  feed,
  totals,
  networkName,
  now,
}: {
  feed: PayoutReceipt[];
  totals: { paidUsd: number; payoutCount: number; blockedCount: number };
  networkName: string;
  now: number;
}) {
  const settled = feed.filter((r) => r.settled);
  const featured = settled[0] ?? null;
  const rail = feed.filter((r) => r !== featured).slice(0, 6);

  return (
    <section id="proof" className="pf scene" aria-label="Live proof">
      <div className="wrap">
        <div className="pf-head">
          <span className="eyebrow">Proof, not promises</span>
          <h2 className="h2">Every decision leaves a receipt.</h2>
          <p className="lede pf-lede">
            What Sage saw, what it replayed, why it paid or held, and what moved on-chain —
            publicly checkable. Live on {networkName}.
          </p>
          <div className="pf-stats mono">
            <span><b>{usd(totals.paidUsd)}</b> settled</span>
            <span><b>{totals.payoutCount}</b> verified payout{totals.payoutCount === 1 ? "" : "s"}</span>
            <span><b>{totals.blockedCount}</b> blocked on-chain</span>
          </div>
        </div>

        {featured ? (
          <div className="pf-grid">
            <Reveal className="reveal pf-featured-wrap">
              <Link href={`/proof/${featured.txHash}`} className="pf-featured">
                <div className="pf-featured-top">
                  <span className="pf-badge">
                    <Check size={13} strokeWidth={3} /> Payout settled · verified
                  </span>
                  <span className="pf-net mono">{networkName}</span>
                </div>
                <div className="pf-featured-amt mono">{usd(featured.amount)}</div>
                <div className="pf-featured-sub">
                  Reproduced by Sage, then settled to a real tester inside the approved policy.
                </div>
                <dl className="pf-meta">
                  <div>
                    <dt className="mono">recipient</dt>
                    <dd className="mono">{short(featured.recipient)}</dd>
                  </div>
                  <div>
                    <dt className="mono">transaction</dt>
                    <dd className="mono">{short(featured.txHash)}</dd>
                  </div>
                  <div>
                    <dt className="mono">settled</dt>
                    <dd className="mono">{since(featured.timestamp, now)}</dd>
                  </div>
                </dl>
                <span className="pf-featured-link mono">
                  View the full receipt <ArrowUpRight size={14} strokeWidth={2.2} />
                </span>
              </Link>
            </Reveal>

            <Reveal className="reveal pf-rail" threshold={0.1}>
              <div className="pf-rail-h mono">
                <Radio size={13} strokeWidth={2} /> Decision rail
              </div>
              {rail.length === 0 ? (
                <div className="pf-rail-empty mono">More receipts land here as Sage works.</div>
              ) : (
                rail.map((r, i) => (
                  <Link key={`${r.txHash}-${i}`} href={`/proof/${r.txHash}`} className={`pf-row${r.settled ? "" : " held"}`}>
                    <span className={`pf-row-ic ${r.settled ? "ok" : "no"}`}>
                      {r.settled ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={2.8} />}
                    </span>
                    <span className="pf-row-main">
                      <span className="pf-row-title">{r.settled ? "Payout settled" : "Attempt blocked"}</span>
                      <span className="pf-row-sub mono">{short(r.recipient)}</span>
                    </span>
                    <span className="pf-row-amt mono">{r.settled ? usd(r.amount) : "held"}</span>
                    <span className="pf-row-ago mono">{since(r.timestamp, now)}</span>
                  </Link>
                ))
              )}
              <Link href="/agents/sage" className="pf-rail-all mono">
                Full agent record <ArrowUpRight size={13} strokeWidth={2.2} />
              </Link>
            </Reveal>
          </div>
        ) : (
          <div className="pf-empty">
            <span className="pf-empty-ic"><Radio size={18} strokeWidth={2} /></span>
            <div>
              <div className="pf-empty-t">Wallet live — watching for work.</div>
              <div className="pf-empty-s mono">
                When Sage settles a verified payout, its receipt appears here — public and
                checkable. No rows are shown until a real payout settles.
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
