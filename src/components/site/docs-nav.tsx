"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_PAGES } from "@/lib/site/docs-pages";

/**
 * THE DOCS SIDEBAR, and the previous and next links under each page. Both sit in the docs layout.
 *
 * A client leaf for one reason: a layout is not re-rendered when the reader moves between its
 * pages, so the current page has to be read from the address (`usePathname`). It still renders on
 * the server first, so the links and the marked page are in the HTML before any script runs.
 * `aria-current` both styles the current page and tells a screen reader where it is.
 *
 * Below 880px the same list becomes one row of tabs that scrolls sideways (docs-site.css).
 */
function current(pathname: string | null): number {
  const path = (pathname ?? "").replace(/\/+$/, "") || "/";
  return DOCS_PAGES.findIndex((p) => p.href === path);
}

export function DocsNav() {
  const at = current(usePathname());
  const list = useRef<HTMLUListElement>(null);
  // On a narrow screen the list is one row that scrolls sideways: bring the current page's tab into
  // view, or the last page's tab starts off-screen. On a wide screen nothing overflows and this is a no-op.
  useEffect(() => {
    const ul = list.current;
    const el = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!ul || !el || ul.scrollWidth <= ul.clientWidth) return;
    const offset = el.getBoundingClientRect().left - ul.getBoundingClientRect().left;
    ul.scrollLeft += offset - (ul.clientWidth - el.offsetWidth) / 2;
  }, [at]);
  return (
    <nav className="docs-nav" aria-label="Docs">
      <span className="docs-nav-label">Docs</span>
      <ul className="docs-nav-list" ref={list}>
        {DOCS_PAGES.map((p, i) => (
          <li key={p.href}>
            <Link href={p.href} className="docs-nav-link" aria-current={i === at ? "page" : undefined}>
              <p.icon size={16} strokeWidth={1.75} aria-hidden />
              <span>{p.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DocsPager() {
  const at = current(usePathname());
  if (at < 0) return null;
  const prev = at > 0 ? DOCS_PAGES[at - 1] : null;
  const next = at < DOCS_PAGES.length - 1 ? DOCS_PAGES[at + 1] : null;
  return (
    <nav className="doc-pager" aria-label="Previous and next">
      {prev && (
        <Link href={prev.href} className="doc-pager-link prev" rel="prev">
          <span className="doc-pager-dir">Previous</span>
          <span className="doc-pager-title">{prev.title}</span>
        </Link>
      )}
      {next && (
        <Link href={next.href} className="doc-pager-link next" rel="next">
          <span className="doc-pager-dir">Next</span>
          <span className="doc-pager-title">{next.title}</span>
        </Link>
      )}
    </nav>
  );
}
