import type { Metadata } from "next";
import Link from "next/link";
import { ReadHead, ReadPage } from "@/components/site/read-page";
import { FAQ } from "@/lib/seo/faq";

export const metadata: Metadata = {
  // Category first, brand last: the page competes on the question, not on a contested name.
  title: "Questions about paying people for verified work in USDC",
  description:
    "How Sage at sagepays.xyz works: what work it pays for, how it checks a submission, what stops the agent overspending, what it costs, which networks it pays on, and what the people paid keep.",
  alternates: { canonical: "/faq" },
};

/**
 * THE FAQ, AS A PAGE A PERSON CAN READ (restored 20 Oct 2026).
 *
 * The answers live in `lib/seo/faq.ts` because the root layout publishes them as FAQPage structured
 * data, and the schema and the page must never drift apart. This route is the canonical URL that
 * schema points at, so there is exactly one FAQPage entity on the site and it lives where a reader
 * would look for it. No second JSON-LD block here on purpose: the root layout's renders on this route
 * too, and two FAQPage entities on one URL is worse than none.
 */
export default function FaqPage() {
  return (
    <ReadPage>
      <ReadHead eyebrow="Frequently asked" title="Paying people for verified work, answered">
        <p className="lead">
          Describe the work and set a budget. Sage checks every submission and pays people in USDC from a vault it cannot
          overspend, with a public receipt for every payout.
        </p>
      </ReadHead>

      <div className="site-wrap read-col">
        <div className="read-faq">
          {FAQ.map((entry) => (
            <div className="read-faq-item" key={entry.q}>
              <h2>{entry.q}</h2>
              <p>{entry.a}</p>
            </div>
          ))}
        </div>

        <div className="read-foot">
          <p>
            Still unanswered? Ask Sage itself on <a href="https://t.me/sagedeputybot">Telegram</a>, read the{" "}
            <Link href="/docs">docs</Link>, or see how it compares to <Link href="/vs/beta-testers">hiring beta testers</Link>{" "}
            and to <Link href="/vs/bug-bounty">running a bug bounty</Link>.
          </p>
        </div>
      </div>
    </ReadPage>
  );
}
