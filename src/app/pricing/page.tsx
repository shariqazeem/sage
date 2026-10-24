import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { SiteFrame } from "@/components/site/site-frame";
import { SAGE_X_URL } from "@/components/site/site-footer";
import { PLAN_ORDER, PLANS, WORKER_TERMS, type PlanId } from "@/lib/plans/catalog";
import { planPriceUsd } from "@/lib/plans/billing-math";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free to start, with real money. Pro $29 and Team $149 a month, paid in USDC on Metis, renewing like a card subscription. People who get paid never pay.",
  alternates: { canonical: "/pricing" },
};

/** Where each plan's button goes. Paid plans open the checkout on the plan, through sign-in if needed. */
function cta(id: PlanId): { href: string; label: string; external?: boolean } {
  if (id === "free") return { href: "/start", label: "Start free" };
  if (id === "programs") return { href: SAGE_X_URL, label: "Talk to us", external: true };
  return { href: `/checkout?plan=${id}`, label: `Get ${PLANS[id].name}` };
}

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: "How do I pay?",
    a: "Like a card subscription, in USDC on Metis. Pay from your Sage balance in one click and it renews itself every 30 days, with a reminder three days before; or pay from MetaMask or any wallet. Sage reads the payment on chain, your plan starts at once, and every payment gets a receipt.",
  },
  {
    q: "Can I cancel?",
    a: "Any time, in Settings: turn off renewal and your plan runs to the end of the month you paid for, then you're on Free. Nothing you launched stops paying the people doing the work.",
  },
  {
    q: "I have a promo code. Where does it go?",
    a: "At checkout, under \"Have a promo code?\". A code gives free days of a plan or money off your first payment, and each workspace can use a code once.",
  },
  {
    q: "What counts toward the monthly amount?",
    a: "The budget of the jobs you launch in any 30 days, real money only. A job you launched last month doesn't count against this one.",
  },
  {
    q: "What happens to my live jobs if a plan ends?",
    a: "They keep running and keep paying the people who do the work. A plan only decides what you can launch next. Nobody who did the work is ever left unpaid because of a plan.",
  },
  {
    q: "Can I change plans?",
    a: "Upgrade any time: the days left on your current plan are credited toward the new one. Moving to a smaller plan starts when your current period ends.",
  },
  {
    q: "Is there a fee on payouts?",
    a: "No. Your budget goes to the people you pay, and Sage pays the network fee on every payout. Your account pays its own small fees in METIS: about 0.05 METIS, a few cents, launches a job.",
  },
  {
    q: "Do the people I pay need a plan?",
    a: "Never. Finding work, getting paid and owning a record of verified work are free, always.",
  },
];

export default function PricingPage() {
  return (
    <SiteFrame active="/pricing">
      <section className="page-head">
        <div className="site-wrap">
          <h1 className="display">Simple plans. Workers never&nbsp;pay.</h1>
          <p className="lead">Start free, with real money. When you pay people every week, upgrade: paid in USDC on Metis, renewing like a card, cancel any time.</p>
        </div>
      </section>

      <section className="sec sec-follow">
        <div className="site-wrap">
          <div className="plans">
            {PLAN_ORDER.map((id) => {
              const spec = PLANS[id];
              const price = planPriceUsd(id);
              const go = cta(id);
              return (
                <div key={id} id={id} className={`plan${id === "free" ? " featured" : ""}`}>
                  <span className={`plan-tag${id === "free" ? "" : " plan-tag-ghost"}`} aria-hidden={id !== "free"}>
                    Start here
                  </span>
                  <div className="plan-name">{spec.name}</div>
                  <div className="plan-blurb">{spec.blurb}</div>
                  <div className="plan-price">
                    {price === null ? <b>Custom</b> : <><b>${price}</b><span>{price === 0 ? "forever" : "a month"}</span></>}
                  </div>
                  {go.external ? (
                    <a href={go.href} className="btn btn-quiet" target="_blank" rel="noreferrer">
                      {go.label}
                    </a>
                  ) : (
                    <Link href={go.href} className={`btn ${id === "free" ? "btn-primary" : "btn-quiet"}`}>
                      {go.label}
                    </Link>
                  )}
                  <ul>
                    {spec.highlights.map((h) => (
                      <li key={h}>
                        <Check size={16} strokeWidth={2} />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="band band-after">
            <div>
              <strong>Getting paid is free, always.</strong>
              <p>{WORKER_TERMS.join(". ")}.</p>
            </div>
            <Link href="/marketplace" className="more">
              Find work
            </Link>
          </div>
        </div>
      </section>

      <section className="sec sec-white">
        <div className="site-wrap">
          <div className="sec-head">
            <h2 className="h2">Questions</h2>
          </div>
          <div className="qa">
            {QUESTIONS.map((x) => (
              <details key={x.q}>
                <summary>{x.q}</summary>
                <p>{x.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}
