import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, HandCoins, Link2, LogIn, MousePointerClick, Receipt, ScanSearch, Send, UsersRound, Wallet } from "lucide-react";
import { DOCS_PAGES } from "@/lib/site/docs-pages";
import { DocHead, DocSection } from "./parts";
import { BUILDER_SIGN_IN, TEST, onePlaceLines } from "./facts";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "How Sage works: paste your product's link, Sage tries it in a real browser, real people try it, and each is paid in USDC only for an honest try Sage checked. You see how far everyone got and what they found. Start here.",
  alternates: { canonical: "/docs" },
};

const TOC = {
  "what-sage-is": "What Sage is",
  loop: "How a test runs",
  start: "Start a test",
  testers: "Try products and get paid",
  "read-on": "Read on",
} as const;

export default function DocsOverview() {
  return (
    <article>
      <DocHead
        eyebrow="Docs"
        title="Sage docs"
        lead="Paste your product's link. Sage tries it, real people try it, and each is paid only for an honest try. Start here."
        toc={TOC}
      />

      <DocSection toc={TOC} id="what-sage-is">
        <p>
          Sage tests your product with real people. You paste a link. Sage opens the product in a real browser and
          tries it first. Then people try it, and each one is paid in USDC only for an honest try that Sage checked.
        </p>
        <p>
          You see how far everyone got: who saw the test, who opened your product, who answered and who was paid. You
          read what they found, in their own words.
        </p>
        <p>
          The AI never holds the money. Each test&apos;s money sits in its own vault on Metis: a contract with the
          test&apos;s limits written into it. Sage can ask the vault to pay. Only the vault can pay, and only inside
          those limits. Every payout has a public receipt.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="loop">
        <ol className="doc-steps">
          <li className="doc-step">
            <span className="card-icon">
              <Link2 size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Paste</h3>
            <p>Give Sage your product&apos;s link. That is the whole brief.</p>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <ScanSearch size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Sage tries it</h3>
            <p>Sage uses the product the way a stranger would. It shows you what it hit, and writes the missions.</p>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <UsersRound size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>People try it</h3>
            <p>You choose how many people and what each earns, and pay. Each person takes one place and answers.</p>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <HandCoins size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Checked and paid</h3>
            <p>Sage checks each answer against what it saw itself. An honest try is paid from the vault. The rest is not.</p>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <ClipboardList size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>What they found</h3>
            <p>The paid answers are grouped into findings, each with the exact words people wrote.</p>
          </li>
        </ol>
        <p>
          You decide twice: when you set the offer, and when you pay. Sage does the rest and shows you what it did.{" "}
          <Link href="/docs/how-it-works">How it works</Link> goes through each step.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="start">
        <ol className="doc-steps three">
          <li className="doc-step">
            <span className="card-icon">
              <Send size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Paste a link</h3>
            <p>Sage&apos;s first look is free. Nothing is paid until you decide to bring people in.</p>
            <Link href="/" className="more">
              Start a test
            </Link>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <LogIn size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Sign in</h3>
            <p>Use {BUILDER_SIGN_IN}. The test is then yours to come back to.</p>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <Wallet size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Pay what testers earn</h3>
            <p>
              You pay from your own wallet, in USDC on Metis. A test starts at {TEST.people} people and {TEST.each}{" "}
              each: {TEST.total}, all of it to them.
            </p>
            <Link href="/pricing" className="more">
              Pricing
            </Link>
          </li>
        </ol>
        <p>
          Sage takes no fee. What is not paid to testers comes back to your wallet when you end the test.{" "}
          <Link href="/docs/payments#account">Paying for a test</Link> has the details.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="testers">
        <ol className="doc-steps three">
          <li className="doc-step">
            <span className="card-icon">
              <MousePointerClick size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Pick a test</h3>
            <p>Every open test is listed with what it pays. Each one was paid for before it was listed.</p>
            <Link href="/earn" className="more">
              Open tests
            </Link>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <LogIn size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Sign in and try it</h3>
            <p>{onePlaceLines()[0]} Then you try the product and say what happened.</p>
          </li>
          <li className="doc-step">
            <span className="card-icon">
              <Receipt size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <h3>Get paid</h3>
            <p>An honest try is paid in USDC on Metis, to the wallet you signed in with. Getting stuck earns the same as finishing.</p>
          </li>
        </ol>
        <p>
          Testers never pay Sage anything. <Link href="/docs/how-it-works#testers">If you are the tester</Link> has the
          rest.
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
