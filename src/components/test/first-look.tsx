import Image from "next/image";
import { Pill, type PillTone } from "@/components/sage/pill";
import { count } from "@/lib/site/when";
import type { FirstLookView, LookProblemView } from "@/lib/test-page/first-look";

/**
 * WHAT SAGE NOTICED: its own first look at the product, before anyone is paid.
 *
 * Draws only what it is given. Each problem is a row of three things a builder can check without
 * trusting Sage: where it happened (the step and the address), the exact text Sage recorded there,
 * and the frame from that step. Then one fix. With nothing recorded it says so in one line.
 */
const KIND: Record<LookProblemView["kind"], string> = {
  request: "Failed request",
  console: "Browser error",
  "no-change": "Nothing happened",
  unreachable: "Couldn't press",
  wall: "Stopped",
  slow: "Slow",
  blank: "Empty without scripts",
  visual: "Seen in the frame",
};

const VERDICT: Record<NonNullable<FirstLookView["read"]["verdict"]>, { label: string; tone: PillTone }> = {
  matches: { label: "Reads as it says", tone: "ink" },
  partly: { label: "Partly reads as it says", tone: "accent" },
  differs: { label: "Reads as something else", tone: "accent" },
};

/** "3 things to fix", for a stage's meta. */
export function lookMeta(look: FirstLookView | null): string | null {
  if (!look) return null;
  return look.problems.length > 0 ? count(look.problems.length, "thing to fix", "things to fix") : look.ran ? "nothing broken" : null;
}

function Problem({ p, n }: { p: LookProblemView; n: number }) {
  // a control's own words are already in the title; an error line or a failed address is the proof itself
  const showRecorded = p.kind === "console" || p.kind === "request" || p.kind === "visual" || p.kind === "wall";
  return (
    <article className="sg-t-look-item">
      <span className="sg-t-look-n">{String(n).padStart(2, "0")}</span>
      <div className="sg-t-look-main">
        <h3 className="sg-t-look-title">{p.title}</h3>
        <p className="sg-t-look-where">
          <span>{KIND[p.kind]}</span>
          {p.step !== null ? <span>Step {p.step}</span> : null}
          <span>{p.where}</span>
          {p.times > 1 ? <span>{p.times} times</span> : null}
        </p>
        {showRecorded ? <blockquote className="sg-t-look-rec">{p.recorded}</blockquote> : null}
        <p className="sg-t-look-fix">
          <b>Fix</b>
          {p.fix}
        </p>
      </div>
      {p.frame ? (
        <a className="sg-t-look-shot" href={p.frame} target="_blank" rel="noreferrer noopener" aria-label={`Open the frame from step ${p.step ?? 1}`}>
          <Image src={p.frame} alt={`What Sage's browser showed at step ${p.step ?? 1}`} width={320} height={200} sizes="160px" />
        </a>
      ) : null}
    </article>
  );
}

export function FirstLook({ look }: { look: FirstLookView }) {
  const { read } = look;
  const verdict = read.verdict ? VERDICT[read.verdict] : null;
  const hasRead = !!(read.says || read.firstScreen);
  return (
    <div className="sg-t-look">
      {look.tried ? <p className="sg-small">{look.tried}</p> : null}
      {hasRead ? (
        <section className="sg-t-read" aria-label="What a stranger would take it for">
          <div className="sg-t-read-side">
            <span className="sg-label">It says it is</span>
            <p>{read.says ?? "Sage found no line on the site that says what it is."}</p>
          </div>
          <div className="sg-t-read-side">
            <span className="sg-label">The first screen shows</span>
            <p>{read.firstScreen ?? "Sage kept no picture of the first screen."}</p>
            {read.looksFor.length > 0 ? <p className="sg-t-read-for">Looks made for: {read.looksFor.join(", ")}</p> : null}
          </div>
          {read.strangerReads && verdict ? (
            <p className="sg-t-read-line">
              <Pill tone={verdict.tone}>{verdict.label}</Pill>
              <span>{read.strangerReads}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {look.problems.length > 0 ? (
        <div className="sg-t-look-list">
          {look.problems.map((p, i) => (
            <Problem key={p.id} p={p} n={i + 1} />
          ))}
        </div>
      ) : (
        <p className="sg-t-look-none">
          {look.ran
            ? `Sage recorded no browser errors, no failed requests and no button that did nothing in ${count(look.steps, "step", "steps")}. That is what it saw in one visit, not a clean bill of health.`
            : "Sage read this product's pages and did not use it in a browser, so it has nothing of its own to report yet."}
        </p>
      )}
    </div>
  );
}
