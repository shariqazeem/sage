import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Lock, X } from "lucide-react";
import { usd, short, since } from "@/lib/format";
import { chainConfig } from "@/lib/deputy/networks";
import type { PayoutReceipt } from "@/lib/deputy/chain";

/**
 * HERO — say what it is and who it is for, and put the product beside it.
 *
 * The previous hero was a riddle ("It sees the work. It does it again. Then it pays.") next
 * to a hand-drawn browser: clever, and the first thing a judge read was a puzzle beside a
 * sketch. Infrastructure introduces itself plainly and shows the real thing — so the right
 * column is now the live settlement rail: real amounts, real rails, real transactions, each
 * one a receipt anyone can open. No fabricated row ever appears here (the standing rule); an
 * empty feed renders an honest waiting state.
 */
export function SceneHero({
  paidUsd,
  payoutCount,
  refusedCount,
  networkName,
  feed,
  now,
}: {
  paidUsd: number;
  payoutCount: number;
  refusedCount: number;
  networkName: string;
  feed: PayoutReceipt[];
  now: number;
}) {
  const rows = feed.slice(0, 5);
  return (
    <section className="hero" aria-label="Sage — payment infrastructure for verified work">
      <div className="hero-in">
        <div className="hero-copy">
          <span className="hero-eyebrow eyebrow">
            <span className="dot" aria-hidden />
            Payment infrastructure for verified work
          </span>

          <h1 className="display">
            Pay your people for work
            <br />
            <span className="soft">an AI has verified.</span>
          </h1>

          <p className="lede hero-lede">
            Invite your team, contractors or grantees. Post the work, fund it once. An agent checks
            every deliverable and pays it from a vault it cannot exceed — every payout a receipt.
          </p>

          <div className="hero-actions">
            <Link href="/start" className="btn btn-primary">
              Get started <ArrowRight size={17} strokeWidth={2.2} />
            </Link>
            <Link href="/explorer" className="btn btn-ghost">
              See every payout
            </Link>
          </div>

          <div className="hero-stat">
            <span className="hero-stat-v mono">{usd(paidUsd)}</span>
            <span className="hero-stat-k mono">
              settled · {payoutCount} verified payout{payoutCount === 1 ? "" : "s"} ·{" "}
              {refusedCount} refused · {networkName}
            </span>
          </div>

          <span className="hero-note">
            <Lock size={13} strokeWidth={2} />
            Founder-funded. Sage never touches your keys.
          </span>
        </div>

        {/* ── the live settlement rail: the product, not a picture of it ── */}
        <div className="hero-stage-col">
          <div className="hl" aria-label="Latest settlements, live">
            <div className="hl-h">
              <span className="hl-title">Latest settlements</span>
              <span className="hl-live mono">
                <span className="hl-dot" aria-hidden /> live · mainnet
              </span>
            </div>
            {rows.length === 0 ? (
              <div className="hl-empty mono">Watching for work — receipts land here as Sage settles.</div>
            ) : (
              <ul className="hl-rows">
                {rows.map((r) => (
                  <li key={r.txHash}>
                    <Link href={`/proof/${r.txHash}`} className="hl-row">
                      <span className={`hl-ic ${r.settled ? "ok" : "no"}`}>
                        {r.settled ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={2.8} />}
                      </span>
                      <span className="hl-main">
                        <span className="hl-line">
                          {r.settled ? "Paid" : "Refused"}{" "}
                          <span className="mono">{short(r.recipient)}</span>
                        </span>
                        <span className="hl-sub mono">
                          {chainConfig(r.chainId).chipLabel} · {short(r.txHash)}
                        </span>
                      </span>
                      <span className={`hl-amt mono ${r.settled ? "ok" : "no"}`}>
                        {r.settled ? usd(r.amount) : "held"}
                      </span>
                      <span className="hl-ago mono">{since(r.timestamp, now)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="hl-f">
              <span className="mono">Every row is a transaction you can open.</span>
              <Link href="/explorer" className="hl-all mono">
                All {payoutCount} <ArrowUpRight size={12} strokeWidth={2.2} />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── who it is for — three doors, each to its real surface ── */}
      <div className="dr wrap" aria-label="Who Sage is for">
        <Link href="/start" className="dr-card">
          <span className="dr-k mono">For teams &amp; programmes</span>
          <span className="dr-t">Invite your people, post the work, fund it once.</span>
          <span className="dr-s">Gigs, milestone grants, product testing — verified by Sage and paid inside limits you set. Free for three people.</span>
          <span className="dr-cta">Open a workspace <ArrowRight size={13} strokeWidth={2.2} /></span>
        </Link>
        <Link href="/start" className="dr-card">
          <span className="dr-k mono">For the people doing the work</span>
          <span className="dr-t">Do verified work, get paid in USDC.</span>
          <span className="dr-s">Join with the link your team sent you — no application, no bank account. Every payout builds a record that is yours.</span>
          <span className="dr-cta">Join your team <ArrowRight size={13} strokeWidth={2.2} /></span>
        </Link>
      </div>
    </section>
  );
}
