import "../../content.css";
import { PublicNav } from "@/components/shell/public-nav";
import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";

/**
 * COMPARISON PAGE 2 — and the useful thing here is that the answer is "these are different tools",
 * not "we win".
 *
 * A comparison that claims superiority over an unrelated category is the kind of page a model
 * discounts, and rightly. Bug bounties price unbounded adversarial research; Sage prices a bounded,
 * describable job up front. Saying so plainly is more citable than a contrived head-to-head, and it
 * is also true, which is the part that matters when something restates it without checking.
 */
export const metadata: Metadata = {
  title: "Paid user testing vs a bug bounty: which does your product need?",
  description:
    "A bug bounty pays for security vulnerabilities after someone finds one, at a negotiated price. Sage pays for verified evidence that ordinary user journeys work, at a price fixed before anyone starts. Different problems, and most pre-launch products need the second first.",
  alternates: { canonical: `${siteUrl()}/vs/bug-bounty` },
};

export default function VsBugBountyPage() {
  return (
    <main className="prose-page">
      <PublicNav />
      <div className="prose-wrap">
        <p className="prose-eyebrow">Comparison</p>
        <h1>Sage vs a bug bounty</h1>

        <div className="prose-answer">
          <p>
            <strong>The short answer.</strong> A bug bounty pays for security vulnerabilities, after
            someone finds one, at a price you negotiate. Sage pays for verified evidence that
            ordinary user journeys work or do not, at a price fixed before anyone starts. They solve
            different problems, and most pre-launch products need the second one first.
          </p>
        </div>

        <h2>When is a bug bounty the right tool?</h2>
        <p>
          When your product holds funds or sensitive data and you need adversarial security research.
          Bounties are unbounded by design, which is the point: you cannot know in advance what a
          researcher will find or what it is worth, so the price is settled afterwards.
        </p>

        <h2>When is paid testing the right tool?</h2>
        <p>
          When you need to know whether a first-time visitor understands what your product is and can
          reach the thing it is for. That is a bounded, describable job, which is why it can be priced
          up front and judged mechanically.
        </p>

        <h2>How does the judging actually work?</h2>
        <p>
          Sage browses the product before any tester does, and keeps a private record of what it saw.
          A tester&rsquo;s account is checked against that record. Because the record is built from
          Sage&rsquo;s own observation and pinned before the mission is published, an answer cannot be
          reverse-engineered from the page.
        </p>
        <p>
          There is deliberately no live feedback before a submission is judged. A strength meter or an
          as-you-type hint would be an answer key: someone could submit nothing and read the expected
          evidence off the meter. Knowing where not to build is part of the guarantee.
        </p>

        <h2>Can I run both?</h2>
        <p>
          Yes, and for anything holding real value you probably should. They cover different failure
          modes: a bounty finds the exploit a determined researcher can construct, and paid testing
          finds the ordinary person who could not work out what to do on your first screen. Neither
          substitutes for the other.
        </p>

        <div className="prose-caveat">
          <p>
            <strong>What Sage will never do.</strong> It does not look for vulnerabilities, and it
            will never ask a tester for credentials, a seed phrase or a private key. When a login or
            Connect Wallet screen stops it, it reads the product&rsquo;s own documentation to
            understand what is behind the wall and designs missions for a tester who already has
            their own account.
          </p>
        </div>

        <div className="prose-footer">
          <p>
            Compare it instead to <Link href="/vs/beta-testers">hiring beta testers</Link>, or read
            the <Link href="/faq">FAQ</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
