import "@/styles/landing.css";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, BadgeCheck, Bot, Check, FileCheck2, Gauge, HandCoins, KeyRound, ScrollText, ShieldCheck } from "lucide-react";
import { SiteFrame } from "@/components/site/site-frame";
import { ago } from "@/components/site/receipt-card";
import { SageMark } from "@/components/brand/sage-mark";
import type { LiveReceipt } from "@/lib/site/live-proof";
import { showableReceipts, workedPayout } from "@/lib/site/live-work";
import { publicReadings } from "@/lib/site/readings";
import { PLAN_ORDER, PLANS } from "@/lib/plans/catalog";
import { planPriceUsd } from "@/lib/plans/billing-math";
import { launchClosedReason } from "@/lib/launch/deployment-service";
import { METIS_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";
import { siteUrl } from "@/lib/site";

// Live numbers on every request: the hero's payout, the ticker, the totals are the ledger as it is
// now, never a build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * CATEGORY FIRST, BRAND LAST: "Sage" alone loses to Sage Group, Sage Pay and Ask Sage, and the
 * category has no incumbent. Written to be quoted: concrete nouns (USDC, vault, receipt), no dashes.
 */
export const metadata: Metadata = {
  title: "An AI agent that pays people for verified work | Sage",
  description:
    "Describe the work and set a budget. Sage checks every submission with AI and pays real people in USDC from an on-chain vault it cannot overspend, with a public receipt for every payout and a reason for every refusal. Free to start.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Sage: an AI agent that pays people for verified work",
    description: "It checks the work, then pays, inside limits enforced in code. A public receipt for everything it does.",
    type: "website",
  },
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
const short = (s: string) => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
const wait = (sec: number | null) => (sec === null ? null : sec < 90 ? `${Math.round(sec)} seconds` : `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`);

/**
 * THE FRONT DOOR (rebuilt 24 Oct 2026, after the founder found the 19 Oct page "so generic").
 *
 * The page shows the agent working instead of describing it: the hero is one real payout the way
 * Sage decided it (each criterion, the words from the evidence that met it, what it paid), a ticker
 * of the latest real payouts runs under it, and every number is the ledger's. Then the four moves of
 * a job, the account on Metis, the limits in code, the founder's own agent, the people who get paid,
 * their records, the plans and the company. No icon-card grids standing in for a product.
 */
export default function HomePage() {
  const latest = showableReceipts(6);
  const worked = workedPayout();
  const r = publicReadings();
  const metisOpening = launchClosedReason(METIS_MAINNET_CHAIN_ID) !== null;
  const mcpUrl = `${siteUrl()}/mcp`;

  return (
    <SiteFrame active="/">
      {/* 1. the agent, working */}
      <section className="lp-hero">
        <div className="site-wrap lp-hero-grid">
          <div className="lp-hero-copy">
            <span className="eyebrow lp-live"><i aria-hidden /> AI agents you can trust with money</span>
            <h1 className="lp-display rise">An AI agent that pays people for verified work.</h1>
            <p className="lead lp-lead rise rise-2">
              Describe the work and set a budget. Sage checks every submission and pays real people in USDC, from a vault it can never overspend. Every payout gets a public receipt, and every refusal, its reason.
            </p>
            <div className="hero-cta left rise rise-3">
              <Link href="/start" className="btn btn-primary">Start free</Link>
              <Link href={latest[0] ? `/proof/${latest[0].txHash}` : "/ledger"} className="btn btn-quiet">See a real payout</Link>
            </div>
            <dl className="lp-facts" aria-label="What Sage has done, read from the ledger">
              <div><dt>paid in USDC</dt><dd className="mono">{usd(r.paidUsd)}</dd></div>
              <div><dt>verified payouts</dt><dd className="mono">{r.payouts}</dd></div>
              <div><dt>people paid</dt><dd className="mono">{r.people}</dd></div>
              <div><dt>refused, with reasons</dt><dd className="mono">{r.refused}</dd></div>
            </dl>
          </div>
          <div className="lp-hero-shot rise rise-3">{latest.length > 0 && <LedgerCard receipts={latest} total={r.payouts} />}</div>
        </div>
      </section>

      {/* 2. a job, in four moves */}
      <section className="sec" id="how">
        <div className="site-wrap">
          <div className="lp-head">
            <span className="eyebrow">How it works</span>
            <h2 className="h2">One sentence in. Verified work out.</h2>
          </div>
          <ol className="lp-steps">
            <li>
              <span className="lp-step-n mono">01</span>
              <h3>You say what you need</h3>
              <p>The way you would brief a person, with a budget.</p>
              <blockquote className="lp-brief">Test our signup and tell us where it breaks. $20.</blockquote>
            </li>
            <li>
              <span className="lp-step-n mono">02</span>
              <h3>Sage designs the work</h3>
              <p>Tasks, a fair price for each, and what counts as done. You approve before anything moves.</p>
              <span className="lp-chip-row"><span className="lp-chip">2 tasks</span><span className="lp-chip">$2 each</span><span className="lp-chip">5 people</span></span>
            </li>
            <li>
              <span className="lp-step-n mono">03</span>
              <h3>Sage checks every submission</h3>
              <p>Against the links, the chain and what it saw for itself, with the evidence quoted for every point.</p>
              <span className="lp-chip-row"><span className="lp-chip ok"><Check size={12} /> 3 of 3 criteria met</span><span className="lp-chip">farm check passed</span></span>
            </li>
            <li>
              <span className="lp-step-n mono">04</span>
              <h3>People get paid</h3>
              <p>USDC straight to their wallet{wait(r.medianWaitSeconds) ? `, a median ${wait(r.medianWaitSeconds)} after they submit` : ""}. A public receipt every time.</p>
              <span className="lp-chip-row"><span className="lp-chip ok">paid</span><span className="lp-chip">receipt</span></span>
            </li>
          </ol>
          <p className="lp-under">Product tests, gigs, bounties and milestone grants, priced in dollars or a local currency.</p>
          {worked && (
            <div className="lp-decided">
              <div>
                <span className="eyebrow">A real decision</span>
                <h3 className="h3">Every point checked, with the evidence quoted.</h3>
                <p className="muted">This is how Sage decided one payout: the criteria it checked and the words from the submitted work that met each one. The receipt publishes the same record.</p>
              </div>
              <WorkedCard w={worked} />
            </div>
          )}
        </div>
      </section>

      {/* 3. the money: the account on Metis */}
      <section className="sec sec-white" id="account">
        <div className="site-wrap lp-split">
          <div>
            <span className="eyebrow">Your account {metisOpening && <span className="lp-soon">opening on Metis</span>}</span>
            <h2 className="h2">Sign in with an email. Pay people in USDC.</h2>
            <p className="lead lp-lead-sm">No wallet to install. Sage keeps an account for you on Metis: add money from an exchange or a wallet, swap it inside Sage, and send it anywhere. Sage spends it only inside the limit you set.</p>
            <ul className="lp-list">
              <li><ArrowDownLeft size={17} /><span><b>Add money</b> from Binance, OKX or any wallet on Metis, or bridge USDC from Ethereum.</span></li>
              <li><ArrowLeftRight size={17} /><span><b>Swap</b> METIS and USDC at the pool&apos;s price, with the least you&apos;ll receive shown before you confirm.</span></li>
              <li><ArrowUpRight size={17} /><span><b>Send</b> to any address. Each move is a one-time permit for that move alone.</span></li>
            </ul>
          </div>
          <div className="lp-account" aria-label="What the account looks like">
            <div className="lp-account-top"><span className="lp-k">Balance</span><span className="lp-k">Metis</span></div>
            <div className="lp-account-bal mono">$250.00 <small>USDC</small></div>
            <div className="lp-account-fee mono">0.42 METIS for network fees</div>
            <div className="lp-account-moves">
              <span><ArrowDownLeft size={14} /> Add money</span>
              <span className="on"><ArrowLeftRight size={14} /> Swap</span>
              <span><ArrowUpRight size={14} /> Send</span>
            </div>
            <div className="lp-account-quote">
              <div><span>You swap</span><b className="mono">10 METIS</b></div>
              <div><span>You get about</span><b className="mono">36.80 USDC</b></div>
              <div><span>At least</span><b className="mono">36.43 USDC</b></div>
            </div>
            <p className="lp-account-cap">An example account, drawn from the real screen.</p>
          </div>
        </div>
      </section>

      {/* 4. why it can be trusted */}
      <section className="sec">
        <div className="site-wrap lp-split">
          <div>
            <span className="eyebrow">Limits in code</span>
            <h2 className="h2">The AI proposes. The vault decides.</h2>
            <p className="lead lp-lead-sm">Your budget sits in a vault on chain that pays only inside the limits you set. Even someone who fools the AI can&apos;t get past them.</p>
            <ul className="lp-list">
              <li><BadgeCheck size={17} /><span>Rewards are fixed when the job is made. The AI never sets an amount.</span></li>
              <li><Gauge size={17} /><span>Daily limits and one payout per wallet per task, enforced on chain.</span></li>
              <li><ShieldCheck size={17} /><span>Farm detection: linked wallets and copied work are caught and refused.</span></li>
              <li><KeyRound size={17} /><span>Your money stays yours. Sage holds a bounded role and nothing more.</span></li>
            </ul>
          </div>
          <div className="limits" aria-label="An example of a job's limits">
            <div className="limits-head"><span>Example: one job&apos;s limits</span><span className="faint">on chain</span></div>
            <div className="limit"><span>Budget</span><b>$100.00</b></div>
            <div className="limit"><span>Reward per task</span><b>fixed at launch</b></div>
            <div className="limit"><span>Paid out per day</span><b>at most $25.00</b></div>
            <div className="limit"><span>Payouts per person</span><b>1</b></div>
            <div className="limit"><span>Who can move the rest</span><b>only you</b></div>
          </div>
        </div>
      </section>

      {/* 5. the founder's own agent */}
      <section className="sec sec-ink" id="agents">
        <div className="site-wrap lp-split">
          <div>
            <span className="eyebrow">Connect your own AI agent</span>
            <h2 className="h2">Your agent can run Sage too.</h2>
            <p className="lead lp-lead-sm">Give Claude, Cursor or your own code a key. It lists your jobs, plans new work in a sentence and, if you allow it, launches from your account. You can cut it off in one click, and it can never lift a limit.</p>
            <div className="hero-cta left">
              <Link href="/start?next=/workspace/settings%23agents" className="btn btn-primary">Connect an agent</Link>
              <Link href="/docs/build#agents" className="btn btn-quiet lp-on-ink">What it can do</Link>
            </div>
          </div>
          <div className="lp-code" aria-label="Adding Sage to Claude Code">
            <div className="lp-code-top"><Bot size={14} /> Claude Code</div>
            <pre className="mono">{`$ claude mcp add --transport http sage \\
    ${mcpUrl} \\
    --header "Authorization: Bearer sage_sk_…"

> plan a $30 gig: translate our docs into Spanish

  Plan ready: 3 deliverables, $10 each.
  Launch it from your account?`}</pre>
          </div>
        </div>
      </section>

      {/* 6. the people who get paid */}
      <section className="sec" id="work">
        <div className="site-wrap lp-split lp-split-rev">
          <div>
            <span className="eyebrow">For the people doing the work</span>
            <h2 className="h2">Get paid for real work. Free, always.</h2>
            <p className="lead lp-lead-sm">Find paid work, do it, and get paid in USDC to your own wallet. Sign in with an email; nothing to buy, nothing to install. Every payout adds a verified line to a record that is yours.</p>
            <div className="hero-cta left"><Link href="/marketplace" className="btn btn-primary">Find work</Link></div>
          </div>
          <ul className="lp-records" aria-label="What every payout leaves behind">
            <li><ScrollText size={18} /><div><b>The record</b><span>Every verified payout with its receipt, and income over 30 and 90 days. Never a score.</span><Link href="/record" className="more">How records work</Link></div></li>
            <li><FileCheck2 size={18} /><div><b>The statement</b><span>A printable statement of verified income for a bank, every line checkable on chain.</span><Link href="/record#statement" className="more">What&apos;s on it</Link></div></li>
            <li><HandCoins size={18} /><div><b>The advance</b><span>A lender reads verified income and sets the multiple; the next payouts repay it.</span><Link href="/lender" className="more">The lender&apos;s view</Link></div></li>
          </ul>
        </div>
      </section>

      {/* 7. price */}
      <section className="sec sec-white">
        <div className="site-wrap">
          <div className="lp-head">
            <span className="eyebrow">Pricing</span>
            <h2 className="h2">Free to start.</h2>
            <p className="lead lp-lead-sm">Post your first job and pay real people on Free. Upgrade when you pay people every week. Workers never pay.</p>
          </div>
          <div className="plans">
            {PLAN_ORDER.map((id) => {
              const price = planPriceUsd(id);
              return (
                <div key={id} className="plan">
                  <div className="plan-name">{PLANS[id].name}</div>
                  <div className="plan-blurb">{PLANS[id].blurb}</div>
                  <div className="plan-price">{price === null ? <b>Custom</b> : <><b>${price}</b><span>{price === 0 ? "forever" : "a month"}</span></>}</div>
                </div>
              );
            })}
          </div>
          <div className="sec-foot"><Link href="/pricing" className="more">Compare plans</Link></div>
        </div>
      </section>

      {/* 8. the company */}
      <section className="sec">
        <div className="site-wrap">
          <div className="lp-head">
            <span className="eyebrow">More from Sage</span>
            <h2 className="h2">AI agents you can trust with money.</h2>
            <p className="lead lp-lead-sm">Every agent Sage builds works inside limits enforced in code, and leaves a receipt anyone can check.</p>
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

      {/* 9. begin */}
      <section className="sec close">
        <div className="site-wrap">
          <h2 className="h2">Put Sage to work.</h2>
          <p className="lead">Start free. Your first job can be live in minutes, paying real people for real work.</p>
          <div className="hero-cta">
            <Link href="/start" className="btn btn-primary">Start free</Link>
            <Link href="/ledger" className="btn btn-quiet">Open the ledger</Link>
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}

/** One real payout, the way Sage decided it: the job, the checks with their quotes, the amount, the receipt. */
function WorkedCard({ w }: { w: NonNullable<ReturnType<typeof workedPayout>> }) {
  return (
    <Link href={`/proof/${w.txHash}`} className="lp-worked" aria-label={`A real payout: $${w.amountUsd.toFixed(2)} USDC on ${w.network}, with the checks Sage made`}>
      <div className="lp-worked-top">
        <span className="lp-worked-brand"><SageMark size={18} /> Sage checked the work</span>
        <span className="lp-worked-when">{ago(w.at)}</span>
      </div>
      {w.job && <p className="lp-worked-job">{w.job}</p>}
      <ol className="lp-checks">
        {w.checks.map((c, i) => (
          <li key={i}>
            <span className="lp-check-ic" aria-hidden><Check size={12} /></span>
            <span className="lp-check-t">{c.text}</span>
            {c.quote && <span className="lp-check-q">“{c.quote}”</span>}
          </li>
        ))}
      </ol>
      <div className="lp-worked-paid">
        <span className="lp-worked-amt mono">${w.amountUsd.toFixed(2)} <small>USDC</small></span>
        <span className="lp-worked-meta">paid{w.recipient ? ` to ${short(w.recipient)}` : ""} on {w.network}{w.confidencePct !== null ? ` · ${w.confidencePct}% confident` : ""}</span>
      </div>
      <span className="lp-worked-foot">Open the receipt <ArrowRight size={13} /></span>
    </Link>
  );
}

/** The latest real payouts, as a ledger: each row a transaction anyone can open, the newest marked live. */
function LedgerCard({ receipts, total }: { receipts: readonly LiveReceipt[]; total: number }) {
  return (
    <div className="lp-ledger" aria-label="The latest real payouts">
      <div className="lp-ledger-top">
        <span className="lp-ledger-title">Paid by Sage</span>
        <span className="lp-ledger-live"><i aria-hidden /> live · real money</span>
      </div>
      <ul className="lp-ledger-rows">
        {receipts.map((r) => (
          <li key={`${r.chainId}:${r.txHash}`}>
            <Link href={`/proof/${r.txHash}`} className="lp-ledger-row">
              <span className="lp-ledger-ic" aria-hidden><Check size={12} /></span>
              <span className="lp-ledger-main">
                <span className="lp-ledger-job">{r.job ?? "A verified payout"}</span>
                <span className="lp-ledger-meta">{r.network}{r.recipient ? ` · to ${short(r.recipient)}` : ""} · {ago(r.at)}</span>
              </span>
              <span className="lp-ledger-amt mono">${r.amountUsd.toFixed(2)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/ledger" className="lp-ledger-foot">
        <span>Every row is a transaction you can open.</span>
        <span className="more">All {total}</span>
      </Link>
    </div>
  );
}
