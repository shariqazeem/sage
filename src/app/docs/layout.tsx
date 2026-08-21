import type { ReactNode } from "react";
import Link from "next/link";
import "../content.css";
import "./docs.css";
import { DocsNav } from "./nav";

/**
 * The docs shell. One sidebar, one content column, shared by every page under /docs.
 *
 * The founder AppShell rail is deliberately not mounted here: it is chrome for someone with an
 * account and a funded vault, and offering a stranger a Dashboard link is a nav item that promises
 * something they do not have yet. The conversion path out of docs is the footer, which points at
 * the things a reader can actually do — see a real payout, or launch.
 */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs-shell">
      <aside className="docs-side">
        <Link href="/" className="docs-brand">
          <span className="docs-brand-mark" aria-hidden="true">S</span>
          <span>
            Sage
            <span className="docs-brand-tag">Documentation</span>
          </span>
        </Link>

        <DocsNav />

        <div className="docs-side-foot">
          <Link href="/case-studies/autonomous-paid-testing">Case study</Link>
          <Link href="/vs/beta-testers">vs. beta testers</Link>
          <Link href="/faq">FAQ</Link>
          <a href="https://github.com/shariqazeem/sage">GitHub</a>
          <Link href="/launch">Launch a campaign →</Link>
        </div>
      </aside>

      <main className="docs-main">{children}</main>
    </div>
  );
}
