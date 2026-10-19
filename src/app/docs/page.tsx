import type { Metadata } from "next";
import Link from "next/link";
import { HandCoins, LogIn, PenLine, Receipt, ScanSearch, Send, Wallet } from "lucide-react";
import { DOCS_PAGES } from "@/lib/site/docs-pages";
import { PLANS } from "@/lib/plans/catalog";
import { DocHead, DocSection } from "./parts";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "How Sage works: describe the work and set a budget, Sage checks every submission and pays people in USDC from an on-chain vault it cannot overspend, with a public receipt for every payout. Start here.",
  alternates: { canonical: "/docs" },
};

const TOC = {
  "what-sage-is": "What Sage is",
  loop: "How a job runs",
  start: "Start in three steps",
  "read-on": "Read on",
} as const;

/** Free's limits, read from the catalog the server enforces, so this line can't go stale. */
const free = PLANS.free;
const FREE_LINE = `The Free plan runs ${free.liveJobs === 1 ? "one live job" : `${free.liveJobs} live jobs`} at a time and up to $${free.monthlyUsd.toLocaleString("en-US")} of work a month, with real money.`;

export default function DocsOverview() {
  return (
    <article>
      <DocHead
        eyebrow="Docs"
        title="Sage docs"
        lead="Sage checks work and pays people for it in USDC, inside limits it can never exceed. Start here."
        toc={TOC}
      />

      <DocSection toc={TOC} id="what-sage-is">
        <p>
          Sage is an AI agent that pays people for verified work. You say what you need and set a budget. Sage turns
          that into clear tasks, each with a fixed reward. It checks every submission, pays for the work that holds up,
          and refuses the rest with a written reason.
        </p>
        <p>
          The AI never holds the money. Each job&apos;s budget sits in a vault on chain: a contract with the job&apos;s
          limits written into it. The AI can recommend a payout. Only the vault can make one, and only inside those
          limits.
        </p>
        <p>Use it for product testing, gigs and bounties, and milestone grants. The people who do the work never pay.</p>
      </DocSection>

      <DocSection toc={TOC} id="loop">
        <ol className="doc-steps">
          <li className="doc-step">
            <span className="card-icon">
              <PenLine size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Post</h3>
            <p>Describe the work and set a budget. Sage drafts the tasks and a reward for each. You approve the plan and fund it.</p>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <ScanSearch size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Verify</h3>
            <p>People claim a task, do it and submit. Sage checks each submission against evidence it gathers itself.</p>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <HandCoins size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Pay</h3>
            <p>Work that holds up is paid in USDC from the job&apos;s vault. Work that doesn&apos;t is refused, with the reason.</p>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <Receipt size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Receipt</h3>
            <p>Every payout gets a public page tied to its transaction on chain. Anyone can check it.</p>
          </li>
        </ol>
        <p>
          You decide twice: when you approve the plan, and when you fund it. Sage does the rest and shows you what it
          did. <Link href="/docs/how-it-works">How it works</Link> goes through each step.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="start">
        <ol className="doc-steps three">
          <li className="doc-step">
            <span className="card-icon">
              <LogIn size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Sign in</h3>
            <p>Use an email or a wallet you already have. With an email, Sage keeps a wallet for you. Nothing to install.</p>
            <Link href="/start" className="more">
              Sign in
            </Link>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <Wallet size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Fund your account</h3>
            <p>Your account is a wallet Sage keeps for you. Send it USDC from any wallet or exchange. Withdraw any time.</p>
            <Link href="/workspace/account" className="more">
              Your account
            </Link>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <Send size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Post one sentence</h3>
            <p>Write the job the way you&apos;d brief a person. Set the budget, check the plan, and launch.</p>
            <Link href="/launch?do=pay" className="more">
              Post work
            </Link>
          </li>
        </ol>
        <p>
          Testing a product? <Link href="/launch">Give Sage its address</Link> instead. Sage looks at the product
          itself before it writes a single task.
        </p>
        <p>
          {FREE_LINE} <Link href="/pricing">Pricing</Link> has the rest.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="read-on">
        <div className="doc-cards">
          {DOCS_PAGES.filter((p) => p.href !== "/docs").map((p) => (
            <Link key={p.href} href={p.href} className="doc-card">
              <span className="card-icon">
                <p.icon size={18} strokeWidth={1.75} aria-hidden />
              </span>
              <h3>{p.title}</h3>
              <p>{p.summary}</p>
              <span className="more">Read</span>
            </Link>
          ))}
        </div>
      </DocSection>
    </article>
  );
}
