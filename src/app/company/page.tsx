import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Receipt, UsersRound } from "lucide-react";
import { SiteFrame } from "@/components/site/site-frame";
import { SAGE_TELEGRAM_URL, SAGE_X_URL } from "@/components/site/site-footer";
import { getAgentIdentities } from "@/lib/erc8004/identity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Company",
  description: "Sage builds AI agents you can trust with money: limits enforced in code, and a public receipt for everything they do. Products: Sage and Called by Sage.",
  alternates: { canonical: "/company" },
};

/** What has actually happened, each line checkable. No line here is a plan dressed as a fact. */
const MILESTONES: { when: string; what: string; href?: string; link?: string }[] = [
  {
    when: "July 2026",
    what: "First autonomous payout. Sage read a person's account of their work, judged it real and paid them $1 in USDC on GOAT Network, with no one in the loop.",
    href: "/proof/0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069",
    link: "See the receipt",
  },
  {
    when: "August 2026",
    what: "First place, Grand Champion, at the OpenClaw Summer Bootcamp, from Metis, GOAT Network, ClawUp and CryptoChicks.",
  },
  {
    when: "August 2026",
    what: "Payouts on Starknet, judged and settled by Sage without a person approving each one.",
  },
  {
    when: "October 2026",
    what: "Live on Arc, and presented at Future Caribbean's Demo Day.",
  },
  {
    when: "October 2026",
    what: "Sage becomes a company: Metis and GOAT Network as its primary networks, paid plans, and a second product, Called by Sage.",
  },
];

export default function CompanyPage() {
  const ids = getAgentIdentities();
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  return (
    <SiteFrame active="/company">
      <section className="page-head">
        <div className="site-wrap">
          <h1 className="display">We build AI agents you can trust with money.</h1>
          <p className="lead">
            An agent that pays people should not need anyone&apos;s trust. So every Sage agent works inside limits enforced in code, and leaves a public receipt for everything it does.
          </p>
        </div>
      </section>

      <section className="sec sec-follow">
        <div className="site-wrap grid-3">
          <div className="card">
            <span className="card-icon"><BadgeCheck size={20} strokeWidth={1.75} /></span>
            <h2 className="h3">The AI proposes. Code decides.</h2>
            <p>Models can be wrong and can be fooled. So the amount, the caps and who gets paid are enforced where no prompt can reach them.</p>
          </div>
          <div className="card">
            <span className="card-icon"><Receipt size={20} strokeWidth={1.75} /></span>
            <h2 className="h3">Every claim has a receipt.</h2>
            <p>When Sage pays someone, there is a public page that proves it, down to the transaction. When it refuses, the reason is written down.</p>
          </div>
          <div className="card">
            <span className="card-icon"><UsersRound size={20} strokeWidth={1.75} /></span>
            <h2 className="h3">People before plans.</h2>
            <p>The people who do the work never pay, own their record, and are never left unpaid because a customer&apos;s plan changed.</p>
          </div>
        </div>
      </section>

      <section className="sec sec-white">
        <div className="site-wrap site-narrow">
          <div className="sec-head">
            <h2 className="h2">So far</h2>
          </div>
          <ol className="timeline">
            {MILESTONES.map((m) => (
              <li key={m.what}>
                <span className="timeline-when mono">{m.when}</span>
                <p>
                  {m.what}
                  {m.href && (
                    <>
                      {" "}
                      <Link href={m.href} className="more">
                        {m.link}
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="sec" id="identity">
        <div className="site-wrap split">
          <div>
            <span className="eyebrow">Agent identity</span>
            <h2 className="h2">A registered agent. A reputation it can&apos;t write itself.</h2>
            <p className="lead">
              Sage is registered under ERC-8004, the open standard for on-chain agent identity. Its reputation is its record: every payout and every refusal, each with a receipt. The same registry runs on Metis.
            </p>
            <p className="hero-cta left">
              <Link href="/agents/sage" className="more">
                See Sage&apos;s public record
              </Link>
            </p>
          </div>
          <div className="limits" aria-label="Sage's on-chain identity">
            <div className="limits-head">
              <span>Sage on chain</span>
              <span className="faint">ERC-8004</span>
            </div>
            {ids.map((id) => (
              <div key={id.chainId} className="limit">
                <span>{id.network}</span>
                <b>{id.registered && id.agentId ? `agent #${id.agentId}` : "registration pending"}</b>
              </div>
            ))}
            <div className="limit"><span>Registry</span><b>{short(ids[0].registry)}</b></div>
            {ids[0].address && <div className="limit"><span>Agent wallet</span><b>{short(ids[0].address)}</b></div>}
          </div>
        </div>
      </section>

      <section className="sec sec-white">
        <div className="site-wrap">
          <div className="sec-head">
            <span className="eyebrow">Products</span>
            <h2 className="h2">Two agents. One promise.</h2>
          </div>
          <div className="family">
            <Link href="/" className="family-card">
              <span className="eyebrow">Sage</span>
              <h3 className="h2">Work, verified. Then paid.</h3>
              <p>Describe the work and set a budget. Sage checks every submission and pays people in USDC, inside limits it can never exceed.</p>
              <span className="more">Explore Sage</span>
            </Link>
            <Link href="/called" className="family-card dark">
              <span className="eyebrow">Called by Sage</span>
              <h3 className="h2">Trading calls with a record nobody can fake.</h3>
              <p>Every call is written on chain before the market moves, so an agent&apos;s track record is public and permanent.</p>
              <span className="more">Learn about Called</span>
            </Link>
          </div>
          <p className="nets band-after">
            <span>Primary networks: <b>Metis</b> and <b>GOAT Network</b></span>
            <span>Also settles on <b>Arc</b> and <b>Starknet</b></span>
          </p>
        </div>
      </section>

      <section className="sec close" id="contact">
        <div className="site-wrap">
          <h2 className="h2">Talk to us.</h2>
          <p className="lead">Running a programme that pays many people? Building on Sage? Message us on X and a person answers.</p>
          <div className="hero-cta">
            <a href={SAGE_X_URL} className="btn btn-primary" target="_blank" rel="noreferrer">
              Message us on X
            </a>
            <a href={SAGE_TELEGRAM_URL} className="btn btn-quiet" target="_blank" rel="noreferrer">
              Try Sage on Telegram
            </a>
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}
