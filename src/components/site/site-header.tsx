import Link from "next/link";
import { Menu } from "lucide-react";
import { SageMark } from "@/components/brand/sage-mark";

/**
 * THE COMPANY HEADER. Five places a stranger can go, one way in. The mobile menu is a <details>
 * element, so it works before (and without) any JavaScript.
 *
 * "Find work" is in the header on purpose: working for Sage's customers is free, always, and the
 * people who get paid are half of every job.
 */
export const SITE_NAV = [
  { href: "/marketplace", label: "Find work" },
  { href: "/pricing", label: "Pricing" },
  { href: "/ledger", label: "Ledger" },
  { href: "/docs", label: "Docs" },
  { href: "/company", label: "Company" },
] as const;

export function SiteHeader({ active }: { active?: string }) {
  return (
    <header className="site-head">
      <div className="site-wrap site-head-in">
        <Link href="/" className="site-brand" aria-label="Sage home">
          <SageMark size={24} />
          <span>Sage</span>
        </Link>
        <nav className="site-nav" aria-label="Sage">
          {SITE_NAV.map((l) => (
            <Link key={l.href} href={l.href} aria-current={active === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="site-actions">
          <Link href="/start" className="site-signin">
            Sign in
          </Link>
          <Link href="/start" className="btn btn-primary btn-sm">
            Start free
          </Link>
        </div>
        <details className="site-menu">
          <summary aria-label="Menu">
            <Menu size={20} strokeWidth={1.75} />
          </summary>
          <div className="site-menu-sheet">
            {SITE_NAV.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
            <Link href="/start">Sign in</Link>
            <Link href="/start" className="btn btn-primary">
              Start free
            </Link>
          </div>
        </details>
      </div>
    </header>
  );
}
