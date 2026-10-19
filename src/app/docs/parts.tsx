import type { ReactNode } from "react";

/**
 * The pieces every docs page is made of: a head (eyebrow, title, lead, and the page's own contents),
 * then sections. A page names its sections once, in one object; the contents list and each section's
 * heading both read it, and a section id that isn't in it does not compile. The ids are also the
 * anchors old docs addresses redirect to (src/lib/site/redirects-docs.ts).
 */
export type Toc = Record<string, string>;

export function DocHead({ eyebrow, title, lead, toc }: { eyebrow: string; title: string; lead: ReactNode; toc?: Toc }) {
  return (
    <header className="doc-head">
      <span className="eyebrow">{eyebrow}</span>
      <h1 className="doc-title">{title}</h1>
      <p className="lead">{lead}</p>
      {toc && (
        <ul className="doc-toc" aria-label="On this page">
          {Object.entries(toc).map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

export function DocSection<T extends Toc>({ toc, id, children }: { toc: T; id: keyof T & string; children: ReactNode }) {
  return (
    <section className="doc-sec" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{toc[id]}</h2>
      {children}
    </section>
  );
}
