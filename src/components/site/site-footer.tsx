import Link from "next/link";
import { SageMark } from "@/components/brand/sage-mark";

export const SAGE_X_URL = "https://x.com/sagepaysai";
export const SAGE_TELEGRAM_URL = "https://t.me/sagedeputybot";

/**
 * Where everything lives. Every public page is one click from every other: the pages folded on 19 Oct
 * 2026 came back on the 20th (outcomes, the Caribbean, the comparisons, the case study, the FAQ), the
 * records got a page of their own at /record, and a page nobody can reach is a page that was folded in
 * all but name.
 */
const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/", label: "Sage" },
      { href: "/pricing", label: "Pricing" },
      { href: "/marketplace", label: "Find work" },
      { href: "/record", label: "Records" },
      { href: "/lender", label: "For lenders" },
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

/** The company footer: who Sage is, where everything lives, and the networks money moves on. */
export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="site-wrap">
        <div className="site-foot-grid">
          <div className="site-foot-about">
            <Link href="/" className="site-brand" aria-label="Sage home">
              <SageMark size={22} />
              <span>Sage</span>
            </Link>
            <p>Sage builds AI agents you can trust with money: limits enforced in code, and a public receipt for everything they do.</p>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h4>{c.title}</h4>
              <ul>
                {c.links.map((l) => (
                  <li key={l.href}>
                    {l.href.startsWith("http") ? (
                      <a href={l.href} target="_blank" rel="noreferrer">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href}>{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="site-foot-base">
          <span>© {new Date().getUTCFullYear()} Sage</span>
          <span>Payments in USDC on Metis. Also on Arc and Starknet.</span>
        </div>
      </div>
    </footer>
  );
}
