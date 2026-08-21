import type { ReactNode } from "react";
import Link from "next/link";

/** One doc page's frame: the eyebrow crumb, the prose column, and the next-page pair. */
export function Doc({ crumb, children }: { crumb: string; children: ReactNode }) {
  return (
    <article className="prose-page in-docs">
      <div className="prose-wrap">
        <p className="docs-crumb">{crumb}</p>
        {children}
      </div>
    </article>
  );
}

export function Next({ items }: { items: { href: string; title: string; label?: string }[] }) {
  return (
    <div className="docs-next">
      {items.map((i) => (
        <Link key={i.href} href={i.href}>
          <span className="lbl">{i.label ?? "Next"}</span>
          <span className="ttl">{i.title} →</span>
        </Link>
      ))}
    </div>
  );
}

export function Cards({ items }: { items: { href: string; title: string; body: string }[] }) {
  return (
    <div className="docs-cards">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="docs-card">
          <h3>{i.title}</h3>
          <p>{i.body}</p>
        </Link>
      ))}
    </div>
  );
}
