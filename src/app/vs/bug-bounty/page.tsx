import type { Metadata } from "next";
import Link from "next/link";
import { ReadHead, ReadPage } from "@/components/site/read-page";

export const metadata: Metadata = {
  title: "Paid user testing vs a bug bounty",
  description:
    "A bug bounty pays for security vulnerabilities after someone finds one. Sage pays for verified evidence that ordinary user journeys work, at a price fixed before anyone starts. When to use which, and why most products need both.",
  alternates: { canonical: "/vs/bug-bounty" },
};

/**
 * COMPARISON PAGE (restored 20 Oct 2026, in the company frame). Same shape as /vs/beta-testers: the
 * question as the heading, the answer under it, and the limits stated as plainly as the strengths.
 */
export default function VsBugBountyPage() {
  return (
    <ReadPage>
      <ReadHead eyebrow="Comparison" title="Sage vs a bug bounty" />

      <div className="site-wrap read-col">
        <div className="read-answer">
          <p>
            <strong>The short answer.</strong> A bug bounty pays for security vulnerabilities, after someone finds one, at a
            price you negotiate. Sage pays for verified evidence that ordinary user journeys work or do not, at a price fixed
            before anyone starts. They solve different problems, and most products need the second one first.
          </p>
        </div>

        <section className="read-sec">
          <h2>When is a bug bounty the right tool?</h2>
          <p>
            When your product holds funds or sensitive data and you need adversarial security research. Bounties are
            unbounded by design, and that is the point: you cannot know in advance what a researcher will find or what it
            is worth, so the price is settled afterwards.
          </p>
        </section>

        <section className="read-sec">
          <h2>When is paid testing the right tool?</h2>
          <p>
            When you need to know whether a first-time visitor understands what your product is and can reach the thing it
            is for. That is a bounded, describable job, which is why it can be priced up front and judged mechanically.
          </p>
        </section>

        <section className="read-sec">
          <h2>How does the judging actually work?</h2>
          <p>
            Sage browses the product before any tester does and keeps a private record of what it saw. A tester&apos;s
            account is checked against that record. Because the record is built from Sage&apos;s own observation and fixed
            before the task is published, an answer cannot be reverse-engineered from the page.
          </p>
          <p>
            There is deliberately no live feedback before a submission is judged. A strength meter or an as-you-type hint
            would be an answer key: someone could submit nothing and read the expected evidence off the meter. Knowing
            where not to build is part of the guarantee.
          </p>
        </section>

        <section className="read-sec">
          <h2>Can I run both?</h2>
          <p>
            Yes, and for anything holding real value you probably should. They cover different failures: a bounty finds the
            exploit a determined researcher can construct, and paid testing finds the ordinary person who could not work
            out what to do on your first screen. Neither replaces the other.
          </p>
          <div className="read-note">
            <p>
              <strong>What Sage will never do.</strong> It does not look for vulnerabilities, and it will never ask a tester
              for credentials, a seed phrase or a private key. When a login or Connect Wallet screen stops it, it reads the
              product&apos;s own documentation to understand what is behind the wall and designs tasks for a tester who
              already has their own account.
            </p>
          </div>
        </section>

        <div className="read-foot">
          <p>
            Compare it instead to <Link href="/vs/beta-testers">hiring beta testers</Link>, read the{" "}
            <Link href="/case-studies/autonomous-paid-testing">case study</Link> or the <Link href="/faq">FAQ</Link>.
          </p>
        </div>
      </div>
    </ReadPage>
  );
}
