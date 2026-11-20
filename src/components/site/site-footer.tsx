import Link from "next/link";
import { SageMark } from "@/components/brand/sage-mark";

export const SAGE_X_URL = "https://x.com/sagepaysai";
export const SAGE_TELEGRAM_URL = "https://t.me/sagedeputybot";

/**
 * Where everything lives. Every public page is one click from every other (the founder's rule,
 * 20 Oct 2026: no address is ever removed, and a page nobody can reach is a page that was removed in
 * all but name). Since the relaunch it is set as an index, like the fine print of a receipt, not as
 * a wall of columns. The advance and the lenders' page are retired from the front: their routes
 * stay alive, and nothing here links them.
 */
const ROWS = [
  {
    title: "Product",
    links: [
      { href: "/", label: "Test your product" },
      { href: "/earn", label: "Earn" },
      { href: "/pricing", label: "Pricing" },
      { href: "/record", label: "Records" },
    ],
  },
  {
    title: "Proof",
    links: [
      { href: "/ledger", label: "Ledger" },
      { href: "/outcomes", label: "Outcomes" },
      { href: "/case-studies/autonomous-paid-testing", label: "Case study" },
      { href: "/caribbean", label: "Sage in the Caribbean" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/faq", label: "FAQ" },
      { href: "/docs/build", label: "Build on Sage" },
      { href: "/docs/trust", label: "Safety and limits" },
      { href: "/vs/beta-testers", label: "Sage vs beta testers" },
      { href: "/vs/bug-bounty", label: "Sage vs bug bounties" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/company", label: "About" },
      { href: "/parallaxpay", label: "ParallaxPay by Sage" },
      { href: SAGE_X_URL, label: "X" },
      { href: SAGE_TELEGRAM_URL, label: "Telegram" },
    ],
  },
] as const;

/** The footer, on the new screens and the company pages alike. Styled by sage.css (`sg-foot`). */
export function SiteFooter() {
  return (
    <footer className="sg-foot">
      <div className="sg-wrap">
        <div className="sg-foot-top">
          <Link href="/" className="sg-bar-brand" aria-label="Sage, home">
            <SageMark size={22} />
            <span>Sage</span>
          </Link>
          <p className="sg-foot-line">Real people try what you built, and each is paid in USDC only for an honest try Sage can check.</p>
        </div>
        <dl className="sg-foot-rows">
          {ROWS.map((r) => (
            <div key={r.title} className="sg-foot-row">
              <dt>{r.title}</dt>
              <dd>
                {r.links.map((l) =>
                  l.href.startsWith("http") ? (
                    <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
                      {l.label}
                    </a>
                  ) : (
                    <Link key={l.href} href={l.href}>
                      {l.label}
                    </Link>
                  ),
                )}
              </dd>
            </div>
          ))}
        </dl>
        <div className="sg-foot-base">
          <span>© {new Date().getUTCFullYear()} Sage</span>
          <span>Paid in USDC on Metis</span>
        </div>
      </div>
    </footer>
  );
}
