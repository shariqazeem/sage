import Link from "next/link";
import type { ReactNode } from "react";
import { Pill, type PillTone } from "@/components/sage/pill";
import { ProductSort } from "@/components/sage/test-card";
import { short } from "@/lib/format";
import type { FindingsView } from "@/lib/report";
import type { TestFact } from "@/lib/test-page/before";

/**
 * THE PIECES OF A TEST'S PAGE that only draw what they are given: the head, a stage on the rule, a
 * mission, the facts, the findings. No state and no fetching, so the page before money and the page
 * after it are built from the same parts and read as one document.
 */

export function TestHead({
  host,
  href,
  state,
  tone,
  children,
  sub,
}: {
  host: string;
  /** the product's own address, opened in a new tab */
  href?: string | null;
  state: string;
  tone: PillTone;
  /** the one line that says where the test stands */
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <header className="sg-t-head">
      <div className="sg-t-product">
        <ProductSort name={host} />
        {href ? (
          <a className="sg-t-domain" href={href} target="_blank" rel="noreferrer noopener">
            {host}
          </a>
        ) : (
          <span className="sg-t-domain">{host}</span>
        )}
        <Pill tone={tone}>{state}</Pill>
      </div>
      <h1 className="sg-t-line">{children}</h1>
      {sub ? <p className="sg-t-sub">{sub}</p> : null}
    </header>
  );
}

export type StageState = "done" | "now" | "next";

/** One stage of the test, on the rule. A stage that hasn't happened shows its name and nothing else. */
export function Stage({ state, title, meta, children, id }: { state: StageState; title: ReactNode; meta?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <section className="sg-t-stage" data-s={state} id={id} aria-current={state === "now" ? "step" : undefined}>
      <header className="sg-t-stage-head">
        <h2 className="sg-t-stage-title">{title}</h2>
        {meta ? <span className="sg-t-stage-meta">{meta}</span> : null}
      </header>
      {children ? <div className="sg-t-stage-body">{children}</div> : null}
    </section>
  );
}

export function Facts({ facts }: { facts: TestFact[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="sg-t-facts">
      {facts.map((f) => (
        <div className="sg-t-fact" key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface MissionShape {
  missionKey: string;
  title: string;
  objective: string;
  instructions: string;
  criteria: string[];
  /** already formatted: "$2.00" */
  each: string;
  /** "4 people", or "3 of 4 left" once it is live */
  places: string;
}

/** A mission, closed to its title and what it pays; open, to what a person does and what counts. */
export function MissionItem({ n, mission, open }: { n: number; mission: MissionShape; open?: boolean }) {
  return (
    <details className="sg-t-mission" open={open}>
      <summary>
        <span className="sg-t-mission-n">{String(n).padStart(2, "0")}</span>
        <span className="sg-t-mission-title">{mission.title}</span>
        <span className="sg-t-mission-econ">
          <b>{mission.each}</b> · {mission.places}
        </span>
      </summary>
      <div className="sg-t-mission-body">
        {mission.objective ? <p>{mission.objective}</p> : null}
        {mission.instructions ? (
          <div className="sg-stack sg-gap-2">
            <span className="sg-label">What to do</span>
            <p>{mission.instructions}</p>
          </div>
        ) : null}
        {mission.criteria.length > 0 ? (
          <div className="sg-stack sg-gap-2">
            <span className="sg-label">What counts</span>
            <ul className="sg-t-list">
              {mission.criteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

const KIND_WORDS: Record<string, string> = { stuck: "Got stuck", bug: "Broken", liked: "Liked", idea: "Idea", other: "" };

/**
 * WHAT PEOPLE FOUND. Each finding is a count of people (counted in code from their paid answers),
 * its name, and what they wrote, word for word. The first quote shows; the rest are one tap away.
 * Every person behind a finding links their receipt.
 */
export function Findings({ view }: { view: Pick<FindingsView, "findings"> }) {
  if (view.findings.length === 0) return null;
  return (
    <div className="sg-t-findings">
      {view.findings.map((f, i) => {
        const [first, ...rest] = f.quotes;
        const receipts = f.people.filter((p) => p.receipt);
        // an answer laid out by itself is named by its own first words: the quote says it once
        const named = !first || !first.text.startsWith(f.title.replace(/…$/, "").trim());
        return (
          <article className="sg-t-finding" key={`${f.title}:${i}`}>
            <div className="sg-t-finding-count" aria-label={`${f.count} ${f.count === 1 ? "person" : "people"}`}>
              {f.count}
              <small>{f.count === 1 ? "person" : "people"}</small>
            </div>
            <div className="sg-t-finding-main">
              {named ? (
                <h3 className="sg-t-finding-title">
                  {f.title}
                  {KIND_WORDS[f.kind] ? <Pill>{KIND_WORDS[f.kind]}</Pill> : null}
                </h3>
              ) : null}
              {first ? <blockquote className="sg-t-quote">{first.text}</blockquote> : null}
              {rest.length > 0 ? (
                <details className="sg-t-quote-more">
                  <summary>
                    {rest.length} more in their own words
                  </summary>
                  {rest.map((q) => (
                    <blockquote className="sg-t-quote" key={q.submissionId}>
                      {q.text}
                    </blockquote>
                  ))}
                </details>
              ) : null}
              {receipts.length > 0 ? (
                <div className="sg-t-receipts">
                  {receipts.map((p) => (
                    <Link key={p.submissionId} href={p.receipt!}>
                      {short(p.wallet)}
                      {p.paidBase != null ? ` $${(p.paidBase / 1_000_000).toFixed(2)}` : ""}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
