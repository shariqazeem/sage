import Link from "next/link";
import { ArrowRight, Lock, MousePointer2, Check, ShieldCheck } from "lucide-react";
import { usd } from "@/lib/format";
import { Reveal } from "./reveal";

/**
 * HERO — "It sees the work. It does it again. Then it pays."
 * Fully visible at first paint (no reveal gate on the copy or the stage frame). The
 * Sage Browser Stage is a real HTML/CSS/SVG object: a floating browser with a URL in
 * the bar, a terracotta agent cursor travelling to an observed control, observed-fact
 * chips, an event rail, and a verification receipt — a controlled, truthful depiction
 * of the mechanism. No fabricated amount, tester, or transaction appears here; the one
 * real money figure is the live aggregate below the copy.
 */
export function SceneHero({
  paidUsd,
  payoutCount,
  networkName,
}: {
  paidUsd: number;
  payoutCount: number;
  networkName: string;
}) {
  return (
    <section className="hero" aria-label="Sage — autonomous product testing">
      <div className="hero-in">
        <div className="hero-copy">
          <span className="hero-eyebrow eyebrow">
            <span className="dot" aria-hidden />
            Autonomous product testing
          </span>

          <h1 className="display">
            It sees the work.
            <br />
            It does it again.
            <br />
            <span className="soft">Then it pays.</span>
          </h1>

          <p className="lede hero-lede">
            Give Sage a product and a budget. It explores the product, creates paid
            testing missions from what it actually observed, independently replays
            verifiable actions, and settles successful work on-chain.
          </p>

          <div className="hero-actions">
            <Link href="/dashboard" className="btn btn-primary">
              Launch a campaign <ArrowRight size={17} strokeWidth={2.2} />
            </Link>
            <a href="#how" className="btn btn-ghost">
              Watch Sage work
            </a>
            <Link href="/c/founding-testers" className="btn btn-quiet">
              Explore live missions <ArrowRight size={13} strokeWidth={2} />
            </Link>
          </div>

          <div className="hero-stat">
            <span className="hero-stat-v mono">{usd(paidUsd)}</span>
            <span className="hero-stat-k mono">
              paid to real testers · {payoutCount} verified payout
              {payoutCount === 1 ? "" : "s"} on {networkName}
            </span>
          </div>

          <span className="hero-note">
            <Lock size={13} strokeWidth={2} />
            Founder-funded. Sage never touches your keys.
          </span>
        </div>

        {/* ── Sage Browser Stage ── */}
        <div className="hero-stage-col">
          <Reveal className="stage">
            <div className="stage-browser">
              <div className="stage-chrome">
                <span className="stage-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="stage-url">
                  <Lock size={12} strokeWidth={2.4} className="lock" />
                  app.yourproduct.com
                  <span className="caret" aria-hidden />
                </span>
              </div>

              <div className="stage-viewport" role="img" aria-label="Sage exploring a product, observing a control, and permitting a payout after verification">
                <div className="stage-skeleton" aria-hidden>
                  <div className="sk-title" />
                  <div className="sk-row w-72" />
                  <div className="sk-row w-40" />
                  <div className="sk-row w-56" />
                  <div className="sk-card">
                    <div className="sk-row w-40" style={{ flex: 1 }} />
                    <span className="sk-cta scanned">Start</span>
                  </div>
                </div>
                <span className="stage-tag t1" aria-hidden>observed · heading</span>
                <span className="stage-tag t2" aria-hidden>observed · row</span>
                <span className="stage-tag t3" aria-hidden>action · Start</span>
                <MousePointer2 className="stage-cursor" size={20} strokeWidth={2.2} aria-hidden fill="currentColor" />
              </div>
            </div>

            <div className="stage-rail" aria-hidden>
              <span className="rail-ev on"><span className="tick" />Product opened</span>
              <span className="rail-ev on"><span className="tick" />Control observed</span>
              <span className="rail-ev on"><span className="tick" />Action replayed</span>
              <span className="rail-ev on"><span className="tick" />Outcome matched</span>
              <span className="rail-ev pay"><span className="tick" />Payout permitted</span>
            </div>

            <div className="stage-receipt">
              <div className="rc-top">
                <span className="rc-check"><Check size={11} strokeWidth={3.2} /></span>
                Replay reproduced
              </div>
              <div className="rc-amt">Payout permitted</div>
              <div className="rc-sub">
                <ShieldCheck size={11} strokeWidth={2} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                settles only within the approved policy
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
