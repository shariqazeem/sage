"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The docs section nav. Client-only because the current page has to be marked, and
 * `aria-current` is the thing that both styles the active item and tells a screen reader
 * where it is — so it is one attribute doing both jobs rather than a class doing neither.
 */
export const SECTIONS: { label: string; items: { href: string; title: string }[] }[] = [
  {
    label: "Start here",
    items: [
      { href: "/docs", title: "Overview" },
      { href: "/docs/how-it-works", title: "How it works" },
    ],
  },
  {
    label: "The agent",
    items: [
      { href: "/docs/architecture", title: "Architecture" },
      { href: "/docs/operator", title: "Fund once, it decides" },
      { href: "/docs/missions", title: "Missions & budget" },
      { href: "/docs/judging", title: "Judging evidence" },
      { href: "/docs/settlement", title: "Settlement & proof" },
    ],
  },
  {
    label: "Guarantees",
    items: [
      { href: "/docs/safety", title: "The safety model" },
      { href: "/docs/privacy", title: "Private payouts" },
      { href: "/docs/compliance", title: "Compliance & controls" },
    ],
  },
  {
    label: "Interfaces",
    items: [
      { href: "/docs/interfaces", title: "Web, Telegram & API" },
      { href: "/docs/build-on-sage", title: "Build on Sage" },
    ],
  },
];

export function DocsNav() {
  const pathname = usePathname() ?? "/docs";
  return (
    <>
      {SECTIONS.map((group) => (
        <div key={group.label}>
          <p className="docs-group-label">{group.label}</p>
          <nav className="docs-nav" aria-label={group.label}>
            {group.items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className="docs-link"
                aria-current={pathname === it.href ? "page" : undefined}
              >
                {it.title}
              </Link>
            ))}
          </nav>
        </div>
      ))}
    </>
  );
}
