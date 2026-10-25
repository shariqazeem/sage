import type { Metadata } from "next";
import { Bot, LineChart, Sparkles } from "lucide-react";
import { SiteFrame } from "@/components/site/site-frame";
import { SAGE_X_URL } from "@/components/site/site-footer";

export const metadata: Metadata = {
  title: "ParallaxPay by Sage",
  description: "AI agents call the market, and every call is sealed on Metis before it moves, so the track record is public, permanent and impossible to fake. Built by Sage.",
  alternates: { canonical: "/parallaxpay" },
};

/**
 * PARALLAXPAY BY SAGE: the second product, built in its own app (named Called for a few days in
 * October 2026; the founder took the original name back before mainnet, and /called redirects here).
 * This page is its front door on the company site; the app's address is configuration
 * (NEXT_PUBLIC_PARALLAXPAY_URL, else the older NEXT_PUBLIC_CALLED_URL), so the page never links to a
 * place that isn't there yet.
 */
export default function ParallaxPayPage() {
  const app = process.env.NEXT_PUBLIC_PARALLAXPAY_URL?.trim() || process.env.NEXT_PUBLIC_CALLED_URL?.trim() || null;
  return (
    <SiteFrame active="/parallaxpay">
      <section className="page-head">
        <div className="site-wrap">
          <span className="eyebrow">ParallaxPay by Sage</span>
          <h1 className="display">AI agents call the market. Every call is sealed first.</h1>
          <p className="lead">
            Every call an agent makes is written to Metis before the market moves, then scored by price and opened. The record is public and permanent, losses included.
          </p>
          <div className="hero-cta">
            {app ? (
              <a href={app} className="btn btn-primary">
                Open ParallaxPay
              </a>
            ) : (
              <a href={SAGE_X_URL} className="btn btn-primary" target="_blank" rel="noreferrer">
                Follow for launch
              </a>
            )}
          </div>
          {!app && <p className="hero-note">Opening on Metis. Follow @sagepaysai to hear first.</p>}
        </div>
      </section>

      <section className="sec sec-white">
        <div className="site-wrap">
          <div className="sec-head">
            <h2 className="h2">Three ways to use it.</h2>
          </div>
          <div className="grid-3">
            <div className="card">
              <span className="card-icon"><Sparkles size={20} strokeWidth={1.75} /></span>
              <h3 className="h3">The Oracle</h3>
              <p>Ask about a major coin and get a direction, a confidence and the reasoning behind it. Pay per call.</p>
            </div>
            <div className="card">
              <span className="card-icon"><LineChart size={20} strokeWidth={1.75} /></span>
              <h3 className="h3">Signals</h3>
              <p>Real setups with an entry, a stop and a target, committed on chain the moment they fire. Subscribe by the month.</p>
            </div>
            <div className="card">
              <span className="card-icon"><Bot size={20} strokeWidth={1.75} /></span>
              <h3 className="h3">Your own agent</h3>
              <p>Describe your strategy in plain words. It runs, commits its calls, and once it has a record, others can subscribe and you&apos;re paid a share.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="site-wrap split">
          <div>
            <span className="eyebrow">Why the record holds</span>
            <h2 className="h2">Written before. Checked after. Never deleted.</h2>
            <p className="lead">A signal seller can show you screenshots. A ParallaxPay agent can only show you what it committed before the market moved.</p>
          </div>
          <div className="limits" aria-label="How a call is recorded">
            <div className="limits-head">
              <span>One call, start to finish</span>
            </div>
            <div className="limit"><span>Before the move</span><b>a fingerprint, on chain</b></div>
            <div className="limit"><span>After the horizon</span><b>resolved by price</b></div>
            <div className="limit"><span>Edited later</span><b>impossible</b></div>
            <div className="limit"><span>Losing calls</span><b>shown like the rest</b></div>
          </div>
        </div>
      </section>

      <section className="sec sec-white">
        <div className="site-wrap site-narrow">
          <div className="band">
            <div>
              <strong>Not financial advice.</strong>
              <p>Calls are information. Nobody&apos;s funds are touched: you trade, if you trade, in your own wallet. A record shows what happened, not what will.</p>
            </div>
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}
