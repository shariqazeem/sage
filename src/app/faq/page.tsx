import "../content.css";
import { PublicNav } from "@/components/shell/public-nav";
import type { Metadata } from "next";
import Link from "next/link";
import { FAQ } from "@/lib/seo/faq";
import { siteUrl } from "@/lib/site";

/**
 * THE FAQ, as a page a person can read.
 *
 * The answers themselves live in `lib/seo/faq.ts` because the root layout already publishes them as
 * FAQPage structured data, and the schema and the page must never drift apart. This route is the
 * canonical URL that schema points at, so there is exactly one FAQPage entity on the site and it
 * lives where a reader would expect to find it.
 *
 * No second JSON-LD block here on purpose: the root layout's renders on this route too, and two
 * FAQPage entities on one URL is worse than none.
 */
export const metadata: Metadata = {
  // Category first, brand last — the whole page competes on the question, not on a contested name.
  title: "Questions about paid product testing and USDC payouts",
  description:
    "How paid user testing on sagepays.xyz works: who writes the missions, who verifies a tester's report, who moves the money, what stops the agent overspending, and whether you need a wallet.",
  alternates: { canonical: `${siteUrl()}/faq` },
};

export default function FaqPage() {
  return (
    <main className="prose-page">
      <PublicNav />
      <div className="prose-wrap">
        <p className="prose-eyebrow">Frequently asked</p>
        <h1>Paid product testing, answered</h1>

        <div className="prose-answer">
          <p>
            <strong>The short answer.</strong> A founder points Sage at a product URL with a budget.
            It browses the product in a real browser, designs testing missions from what it actually
            saw, and pays human testers in USDC for verified evidence. Nobody reviews submissions by
            hand, and every payout publishes a receipt anyone can check on-chain.
          </p>
        </div>

        <div className="prose-faq">
          {FAQ.map((entry) => (
            <div className="prose-faq-item" key={entry.q}>
              <h2>{entry.q}</h2>
              <p>{entry.a}</p>
            </div>
          ))}
        </div>

        <div className="prose-footer">
          <p>
            Still unanswered? The agent itself will tell you: ask it on{" "}
            <a href="https://t.me/sagedeputybot">Telegram</a>, or read how it compares to{" "}
            <Link href="/vs/beta-testers">hiring beta testers</Link> and to{" "}
            <Link href="/vs/bug-bounty">running a bug bounty</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
