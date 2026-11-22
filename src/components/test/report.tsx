import Link from "next/link";
import { Pill } from "@/components/sage/pill";
import { short } from "@/lib/format";
import type { FindingsView } from "@/lib/report";
import { CHANGE_WORDS } from "@/lib/report/change-words";
import type { ChangedProblem, Ratio } from "@/lib/report/changed";
import { count } from "@/lib/site/when";

/**
 * WHAT PEOPLE FOUND, AS A PRODUCT REPORT. Its parts, in the order a builder asks them:
 *
 *   0. Since your last test      only when this builder tested the same product before: the same
 *                                counts then and now, and what became of the problems people hit.
 *   1. Did they understand it?   X of N, and each person's own sentence.
 *   2. The main action           how many finished, and where the rest stopped.
 *   3. What they ran into        ranked by people, in their words, with a fix and "Sage saw this too".
 *   4. Fix these first           the top three.
 *
 * It draws only what it is given. Every number arrived already counted from rows (paid answers, taps,
 * one checked label per first impression); a part with nothing to count says so, or is not drawn.
 */
type View = Pick<FindingsView, "findings" | "core" | "fixFirst" | "paid"> & { changed?: FindingsView["changed"] };
type Quote = { submissionId: string; text: string };

const READ_WORDS = { yes: "Understood", partly: "Partly", no: "Did not" } as const;
const KIND_WORDS: Record<string, string> = { stuck: "Got stuck", bug: "Broken", liked: "Liked", idea: "Idea", other: "" };
const FROM_WORDS = { people: "", "main-action": "From what people tapped", understanding: "From their first impressions", sage: "Sage saw this itself. No tester has reported it yet." } as const;

function Quotes({ quotes, show = 1 }: { quotes: Quote[]; show?: number }) {
  if (quotes.length === 0) return null;
  const first = quotes.slice(0, show);
  const rest = quotes.slice(show);
  return (
    <>
      {first.map((q) => (
        <blockquote className="sg-t-quote" key={`${q.submissionId}:${q.text}`}>
          {q.text}
        </blockquote>
      ))}
      {rest.length > 0 ? (
        <details className="sg-t-quote-more">
          <summary>{rest.length} more in their own words</summary>
          {rest.map((q) => (
            <blockquote className="sg-t-quote" key={`${q.submissionId}:${q.text}`}>
              {q.text}
            </blockquote>
          ))}
        </details>
      ) : null}
    </>
  );
}

/** N of M, set large: the one number a part is about. */
function Big({ n, of, words }: { n: number; of: number; words: string }) {
  return (
    <p className="sg-t-rep-big">
      <b>
        {n} <span>of</span> {of}
      </b>
      <span>{words}</span>
    </p>
  );
}

/** "3 of 10 → 7 of 10": the same count in the last test and in this one. */
function ThenNow({ then, now }: { then: Ratio; now: Ratio }) {
  return (
    <span className="sg-t-rep-then" role="img" aria-label={`${then.n} of ${then.of} then, ${now.n} of ${now.of} now`}>
      <span aria-hidden>
        {then.n} of {then.of}
      </span>
      <i aria-hidden>→</i>
      <b aria-hidden>
        {now.n} of {now.of}
      </b>
    </span>
  );
}

const CHANGE_TONE: Record<ChangedProblem["change"], "neutral" | "ink" | "accent"> = { gone: "ink", fewer: "ink", still: "accent" };

function Changed({ changed }: { changed: NonNullable<View["changed"]> }) {
  return (
    <section className="sg-t-rep-sec" aria-labelledby="rep-changed">
      <h3 className="sg-t-rep-h" id="rep-changed">
        Since your last test
      </h3>
      <p className="sg-small">
        The same counts in <Link href={changed.previous.path}>your last test of this product</Link> and in this one{changed.live ? ", so far" : ""}. Counted from what people tapped and wrote, by the same rules both times.
      </p>
      {changed.lines.length > 0 ? (
        <ul className="sg-t-rep-changes">
          {changed.lines.map((l) => (
            <li key={l.key}>
              <span className="sg-t-rep-change-label">{l.label}</span>
              <ThenNow then={l.then} now={l.now} />
            </li>
          ))}
        </ul>
      ) : null}
      {changed.problems.length > 0 ? (
        <>
          <span className="sg-label">What people hit last time</span>
          <ul className="sg-t-rep-changes">
            {changed.problems.map((p, i) => (
              <li key={`${p.title}:${i}`}>
                <span className="sg-t-rep-change-label">
                  {p.title}
                  <Pill tone={CHANGE_TONE[p.change]}>{CHANGE_WORDS[p.change]}</Pill>
                </span>
                <ThenNow then={p.then} now={p.now} />
                {p.caution ? <span className="sg-t-rep-change-note">{p.caution}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {changed.small ? <p className="sg-small">{changed.small}</p> : null}
    </section>
  );
}

function Understood({ core }: { core: NonNullable<View["core"]> }) {
  const u = core.understood;
  if (u.words.length === 0) return null;
  const unsorted = u.words.length - u.sorted;
  return (
    <section className="sg-t-rep-sec" aria-labelledby="rep-understood">
      <h3 className="sg-t-rep-h" id="rep-understood">
        Did they understand it?
      </h3>
      {u.sorted > 0 ? (
        <>
          <Big n={u.yes} of={u.sorted} words="understood what it is, from the first screen alone" />
          {/* one cell per person, in the order understood, partly, did not */}
          <div className="sg-t-rep-cells" role="img" aria-label={`${u.yes} understood, ${u.partly} partly, ${u.no} did not`}>
            {[...Array.from({ length: u.yes }, () => "yes"), ...Array.from({ length: u.partly }, () => "partly"), ...Array.from({ length: u.no }, () => "no")].map((read, i) => (
              <i key={i} data-read={read} />
            ))}
          </div>
          <p className="sg-t-rep-key">
            <span data-read="yes">{u.yes} understood</span>
            <span data-read="partly">{u.partly} partly</span>
            <span data-read="no">{u.no} did not</span>
          </p>
        </>
      ) : (
        <p className="sg-small">{count(u.words.length, "person", "people")} said what they took it to be before clicking. Sage has not sorted their answers yet, so here they are as written.</p>
      )}
      {u.says ? (
        <p className="sg-t-rep-says">
          <span className="sg-label">It says it is</span>
          {u.says}
        </p>
      ) : null}
      <span className="sg-label">What they took it for</span>
      <ul className="sg-t-rep-words">
        {u.words.map((w) => (
          <li key={w.submissionId}>
            <blockquote className="sg-t-quote">{w.text}</blockquote>
            {w.read ? <Pill tone={w.read === "yes" ? "ink" : "neutral"}>{READ_WORDS[w.read]}</Pill> : null}
          </li>
        ))}
      </ul>
      {u.sorted > 0 && unsorted > 0 ? <p className="sg-small">{count(unsorted, "answer is", "answers are")} not sorted yet, so the count above leaves {unsorted === 1 ? "it" : "them"} out.</p> : null}
    </section>
  );
}

function MainAction({ core }: { core: NonNullable<View["core"]> }) {
  const a = core.action;
  if (a.tapped === 0) return null;
  return (
    <section className="sg-t-rep-sec" aria-labelledby="rep-action">
      <h3 className="sg-t-rep-h" id="rep-action">
        The main action{core.mainAction ? <span>: {core.mainAction}</span> : null}
      </h3>
      <Big n={a.finished} of={a.tapped} words="finished it" />
      <ol className="sg-t-rep-rungs">
        {a.rungs.map((r) => (
          <li key={r.reached} data-empty={r.count === 0 || undefined} data-end={r.reached === "finished" || undefined}>
            <div className="sg-t-rep-rung">
              <span className="sg-t-rep-rung-n">{r.count}</span>
              <span className="sg-t-rep-rung-label">{r.label}</span>
              {/* one cell per person who tapped; the filled ones ended on this rung */}
              <span className="sg-t-rep-cells" aria-hidden>
                {Array.from({ length: a.tapped }, (_, i) => (
                  <i key={i} data-read={i < r.count ? "yes" : undefined} />
                ))}
              </span>
            </div>
            {r.reached !== "finished" ? <Quotes quotes={r.quotes} /> : null}
          </li>
        ))}
      </ol>
      <p className="sg-t-rep-again">
        <span className="sg-label">Would use it again</span>
        <span>
          <b>{core.again.yes}</b> yes
        </span>
        <span>
          <b>{core.again.maybe}</b> maybe
        </span>
        <span>
          <b>{core.again.no}</b> no
        </span>
      </p>
      <p className="sg-small">Counted from what each person tapped when they answered. The words are theirs.</p>
    </section>
  );
}

function RanInto({ view }: { view: View }) {
  if (view.findings.length === 0) return null;
  return (
    <section className="sg-t-rep-sec" aria-labelledby="rep-found">
      <h3 className="sg-t-rep-h" id="rep-found">
        What they ran into
      </h3>
      <div className="sg-t-findings">
        {view.findings.map((f, i) => {
          const receipts = f.people.filter((p) => p.receipt);
          const first = f.quotes[0];
          // an answer laid out by itself is named by its own first words: the quote says it once
          // (a finding of several people always carries its title: it is the name of what they share)
          const named = f.count > 1 || !first || !first.text.toLowerCase().startsWith(f.title.replace(/…$/, "").trim().toLowerCase());
          return (
            <article className="sg-t-finding" key={`${f.title}:${i}`}>
              <div className="sg-t-finding-count" aria-label={`${f.count} of ${count(f.of, "person", "people")}`}>
                {f.count}
                <small>of {f.of}</small>
              </div>
              <div className="sg-t-finding-main">
                {named || f.sageSaw || f.stoppedOn ? (
                  <h4 className="sg-t-finding-title">
                    {named ? f.title : null}
                    {KIND_WORDS[f.kind] ? <Pill>{KIND_WORDS[f.kind]}</Pill> : null}
                    {f.stoppedOn ? <Pill>{f.stoppedOn}</Pill> : null}
                    {f.sageSaw ? <Pill tone="ink">Sage saw this too</Pill> : null}
                  </h4>
                ) : null}
                <Quotes quotes={f.quotes} show={f.count > 1 ? 2 : 1} />
                {f.sageSaw && f.sageTitle ? <p className="sg-t-rep-sage">In its own run, Sage noted: {f.sageTitle}.</p> : null}
                {f.fix ? (
                  <p className="sg-t-look-fix">
                    <b>Fix</b>
                    {f.fix}
                  </p>
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
    </section>
  );
}

function FixFirst({ view }: { view: View }) {
  if (view.fixFirst.length === 0) return null;
  return (
    <section className="sg-t-rep-sec sg-t-rep-fix" aria-labelledby="rep-fix">
      <h3 className="sg-t-rep-h" id="rep-fix">
        {view.fixFirst.length === 1 ? "Fix this first" : view.fixFirst.length === 2 ? "Fix these two first" : "Fix these three first"}
      </h3>
      <ol className="sg-t-rep-fixes">
        {view.fixFirst.map((f, i) => (
          <li key={`${f.title}:${i}`}>
            <span className="sg-t-rep-fix-n">{i + 1}</span>
            <div className="sg-t-rep-fix-main">
              <b>{f.title}</b>
              <p>{f.fix}</p>
              <span className="sg-t-rep-fix-from">
                {f.from === "sage" ? FROM_WORDS.sage : [f.from === "people" ? count(f.people, "person", "people") : FROM_WORDS[f.from], f.sageSawToo ? "Sage saw this too" : ""].filter(Boolean).join(" · ")}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Report({ view }: { view: View }) {
  return (
    <div className="sg-t-rep">
      {view.changed ? <Changed changed={view.changed} /> : null}
      {view.core ? <Understood core={view.core} /> : null}
      {view.core ? <MainAction core={view.core} /> : null}
      <RanInto view={view} />
      <FixFirst view={view} />
    </div>
  );
}
