import Link from "next/link";
import { SageMark } from "@/components/brand/sage-mark";
import "./public-nav.css";

/**
 * THE PUBLIC NAV — for content pages that are neither app surfaces nor sent artifacts.
 *
 * Measured on prod 2026-08-31: /faq, /agents/sage, /vs/beta-testers, /vs/bug-bounty and the case
 * study rendered with NO navigation of any kind. A reader who arrived from search had one way out
 * of each — the browser back button — and no way to reach the ledger, the marketplace, or the
 * lender view from any of them.
 *
 * Not the landing nav: that one carries a "#how" anchor which resolves to nothing off the landing
 * page, and it is styled by landing-v2.css, which these pages would have to pull in whole. Every
 * destination here is a real route.
 *
 * Not the app rail either. These readers have no account, and a Dashboard link promises one — the
 * same reason /docs keeps its own sidebar.
 */
const LINKS = [
  { href: "/explorer", label: "Live proof" },
  { href: "/marketplace", label: "Find work" },
  { href: "/lender", label: "For lenders" },
  { href: "/docs", label: "Docs" },
] as const;

export function PublicNav() {
  return (
    <nav className="pubnav" aria-label="Sage">
      <Link href="/" className="pubnav-brand" aria-label="Sage home">
        <SageMark size={22} />
        <span>Sage</span>
      </Link>
      <div className="pubnav-links">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
        <Link href="/launch" className="pubnav-cta">
          Launch a campaign
        </Link>
      </div>
    </nav>
  );
}
