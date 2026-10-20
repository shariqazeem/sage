import "@/styles/read.css";
import type { ReactNode } from "react";
import { SiteFrame } from "./site-frame";

/**
 * A READING PAGE in the company frame: a centred head, then one column of prose under it. The pages
 * folded on 19 Oct 2026 came back on this (the Caribbean, outcomes, records, the comparisons, the case
 * study, the FAQ), so a stranger arriving from an old link reads the company site, not a leftover.
 */
export function ReadPage({ active, children }: { active?: string; children: ReactNode }) {
  return (
    <SiteFrame active={active}>
      <article className="read">{children}</article>
    </SiteFrame>
  );
}

/** What the page is, the question it answers, and the answer in a sentence. */
export function ReadHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="read-head">
      <div className="site-wrap">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="read-title">{title}</h1>
        {children}
      </div>
    </header>
  );
}
