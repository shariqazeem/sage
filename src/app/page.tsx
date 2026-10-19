import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Coins, FlaskConical, Gauge, KeyRound, Landmark, Layers, ShieldCheck, UsersRound } from "lucide-react";
import { SiteFrame } from "@/components/site/site-frame";
import { ReceiptCard, ReceiptRows } from "@/components/site/receipt-card";
import { liveProof } from "@/lib/site/live-proof";
import { PLAN_ORDER, PLANS } from "@/lib/plans/catalog";
import { planPriceUsd } from "@/lib/plans/billing-math";

// Live numbers on every request: the hero receipt, the totals and the rows are the ledger as it
// is now, never a build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * CATEGORY FIRST, BRAND LAST: "Sage" alone loses to Sage Group, Sage Pay and Ask Sage, and the
 * category has no incumbent. Written to be quoted: concrete nouns (USDC, vault, receipt), no dashes.
 */
export const metadata: Metadata = {
  title: "Pay people for verified work, in USDC | Sage",
  description:
    "Describe the work and set a budget. Sage checks every submission with AI and pays real people in USDC from an on-chain vault it cannot overspend, with a public receipt for every payout and every refusal. Free to start.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Sage: work, verified. Then paid.",
    description: "An AI agent that checks the work and pays people in USDC, inside limits enforced in code. A public receipt for everything it does.",
    type: "website",
  },
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

export default function HomePage() {
  const proof = liveProof(5);
  const hero = proof.receipts[0] ?? null;

  return (
    <SiteFrame active="/">
      {/* 1 — what it is */}
      <section className="hero">
        <div className="site-wrap">
          <h1 className="display rise">Work, verified. Then&nbsp;paid.</h1>
          <p className="lead rise rise-2">
            Describe the work and set a budget. Sage checks every submission and pays people in USDC, inside limits it can never exceed. Every payout gets a public receipt, and every refusal comes with its reason.
          </p>
          <div className="hero-cta rise rise-3">
            <Link href="/start" className="btn btn-primary">
              Start free
            </Link>
            <Link href="#how" className="btn btn-quiet">
              See how it works
            </Link>
          </div>
          <p className="hero-note">No card. Your first job pays real people on the Free plan.</p>
          {hero && (
            <div className="hero-shot rise rise-3">
              <ReceiptCard r={hero} />
            </div>
          )}
        </div>
      </section>

      {/* 2 — how it works */}
      <section className="sec sec-white" id="how">
        <div className="site-wrap">
          <div className="sec-head">
            <span className="eyebrow">How it works</span>
            <h2 className="h2">One sentence in. Verified work out.</h2>
          </div>
          <div className="grid-3">
            <div className="card">
              <span className="card-n">01</span>
              <h3 className="h3">Say what you need</h3>
              <p>Write it the way you&apos;d brief a person: test my signup, review my docs, ship milestone one. Then set a budget.</p>
            </div>
            <div className="card">
              <span className="card-n">02</span>
              <h3 className="h3">Sage designs and checks</h3>
              <p>It turns your sentence into clear tasks with a fair price each, then checks every submission against them: the links, the chain, and what it saw for itself.</p>
            </div>
            <div className="card">
              <span className="card-n">03</span>
              <h3 className="h3">People get paid</h3>
              <p>Verified work is paid in USDC straight to the person&apos;s wallet. Work that isn&apos;t real is refused, and the reason is written down.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 3 — it is real */}
      <section className="sec">
        <div className="site-wrap">
          <div className="sec-head">
            <span className="eyebrow">Live</span>
            <h2 className="h2">Real money. Real receipts.</h2>
            <p className="lead">Read from the chain and Sage&apos;s ledger as this page loads. Real money only.</p>
          </div>
          <div className="stats">
            <div className="stat">
              <div className="stat-v">{usd(proof.paidUsd)}</div>
              <div className="stat-l">paid in USDC</div>
            </div>
            <div className="stat">
              <div className="stat-v">{proof.payouts}</div>
              <div className="stat-l">verified payouts</div>
            </div>
            <div className="stat">
              <div className="stat-v">{proof.refused}</div>
              <div className="stat-l">refused, each with a reason</div>
            </div>
          </div>
          <div className="site-narrow proof-rows">
            <ReceiptRows receipts={proof.receipts} />
          </div>
          <div className="sec-foot">
            <Link href="/ledger" className="more">
              Open the ledger
            </Link>
          </div>
        </div>
      </section>

      {/* 4 — what for */}
      <section className="sec sec-white">
        <div className="site-wrap">
          <div className="sec-head">
            <h2 className="h2">One budget. Any kind of work.</h2>
          </div>
          <div className="grid-3">
            <div className="card">
              <span className="card-icon"><FlaskConical size={20} strokeWidth={1.75} /></span>
              <h3 className="h3">Product testing</h3>
              <p>Real people use your product and show you where it breaks. Sage browses it first, so it knows when someone really did.</p>
            </div>
            <div className="card">
              <span className="card-icon"><Coins size={20} strokeWidth={1.75} /></span>
              <h3 className="h3">Gigs and bounties</h3>
              <p>A task, a reward and proof of delivery. The moment the work checks out, the person is paid.</p>
            </div>
            <div className="card">
              <span className="card-icon"><Landmark size={20} strokeWidth={1.75} /></span>
              <h3 className="h3">Milestone grants</h3>
              <p>Release funding one milestone at a time, priced in dollars or a local currency, each verified before it pays.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 5 — why it can be trusted */}
      <section className="sec">
        <div className="site-wrap split">
          <div>
            <span className="eyebrow">Limits in code</span>
            <h2 className="h2">The AI proposes. The vault decides.</h2>
            <p className="lead">Your budget sits in a vault on chain that pays only inside the limits you set. Even someone who fools the AI can&apos;t get past them.</p>
            <ul>
              <li><BadgeCheck size={18} strokeWidth={1.75} /><span>Rewards are fixed when the job is made. The AI never sets an amount.</span></li>
              <li><Gauge size={18} strokeWidth={1.75} /><span>Daily limits and one payout per wallet per task, enforced on chain.</span></li>
              <li><ShieldCheck size={18} strokeWidth={1.75} /><span>Farm detection: linked wallets and copied work are caught and refused.</span></li>
              <li><KeyRound size={18} strokeWidth={1.75} /><span>Your money stays yours. Sage holds a bounded role and nothing more.</span></li>
            </ul>
          </div>
          <div className="limits" aria-label="An example of a job's limits">
            <div className="limits-head">
              <span>Example: one job&apos;s limits</span>
              <span className="faint">on chain</span>
            </div>
            <div className="limit"><span>Budget</span><b>$100.00</b></div>
            <div className="limit"><span>Reward per task</span><b>fixed at launch</b></div>
            <div className="limit"><span>Paid out per day</span><b>at most $25.00</b></div>
            <div className="limit"><span>Payouts per person</span><b>1</b></div>
            <div className="limit"><span>Who can move the rest</span><b>only you</b></div>
          </div>
        </div>
      </section>

      {/* 6 — the people who get paid */}
      <section className="sec sec-ink">
        <div className="site-wrap split">
          <div>
            <span className="eyebrow">For the people doing the work</span>
            <h2 className="h2">Get paid for real work. Free, always.</h2>
            <p className="lead">Find paid work, do it, and get paid in USDC to your own wallet. Every payout adds to a record of verified work that&apos;s yours to keep.</p>
            <div className="hero-cta left">
              <Link href="/marketplace" className="btn btn-primary">
                Find work
              </Link>
            </div>
          </div>
          <div className="grid-2">
            <div className="card">
              <span className="card-icon"><UsersRound size={20} strokeWidth={1.75} /></span>
              <h3 className="h3">No account to buy</h3>
              <p>Sign in with an email or any wallet. Nothing to pay, nothing to install.</p>
            </div>
            <div className="card">
              <span className="card-icon"><Layers size={20} strokeWidth={1.75} /></span>
              <h3 className="h3">A record that travels</h3>
              <p>Lenders and teams can read what you&apos;ve been paid for, and every line links to its receipt.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 7 — price */}
      <section className="sec">
        <div className="site-wrap">
          <div className="sec-head">
            <h2 className="h2">Free to start.</h2>
            <p className="lead">Post your first job and pay real people on Free. Upgrade when you pay people every week.</p>
          </div>
          <div className="plans">
            {PLAN_ORDER.map((id) => {
              const price = planPriceUsd(id);
              return (
                <div key={id} className="plan">
                  <div className="plan-name">{PLANS[id].name}</div>
                  <div className="plan-blurb">{PLANS[id].blurb}</div>
                  <div className="plan-price">
                    {price === null ? <b>Custom</b> : <><b>${price}</b><span>{price === 0 ? "forever" : "a month"}</span></>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="sec-foot">
            <Link href="/pricing" className="more">
              Compare plans
            </Link>
          </div>
        </div>
      </section>

      {/* 8 — the company */}
      <section className="sec sec-white">
        <div className="site-wrap">
          <div className="sec-head">
            <span className="eyebrow">More from Sage</span>
            <h2 className="h2">AI agents you can trust with money.</h2>
            <p className="lead">Every agent Sage builds works inside limits enforced in code, and leaves a receipt anyone can check.</p>
          </div>
          <div className="family">
            <Link href="/called" className="family-card dark">
              <span className="eyebrow">Called by Sage</span>
              <h3 className="h2">Trading calls with a record nobody can fake.</h3>
              <p>AI trading agents that write every call on chain before the market moves, so the track record is public and permanent.</p>
              <span className="more">Learn about Called</span>
            </Link>
            <Link href="/company#identity" className="family-card">
              <span className="eyebrow">Agent identity</span>
              <h3 className="h2">A registered agent, with a public reputation.</h3>
              <p>Sage is a registered on-chain agent (ERC-8004). Its reputation is built from its receipts, not from what it says about itself.</p>
              <span className="more">How it works</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 9 — begin */}
      <section className="sec close">
        <div className="site-wrap">
          <h2 className="h2">Put Sage to work.</h2>
          <p className="lead">Start free. Your first job can be live in minutes, paying real people for real work.</p>
          <div className="hero-cta">
            <Link href="/start" className="btn btn-primary">
              Start free
            </Link>
            <Link href="/pricing" className="btn btn-quiet">
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}
