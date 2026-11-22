import { OTHER_NOTES, type PaidAnswer } from "./core";
import { hitBy, signatureOf, type PlainContext } from "./plain";
import type { CoreReport, RankedFinding } from "./product";
import { CHANGE_WORDS, type ProblemChange } from "./change-words";

/**
 * WHAT CHANGED SINCE YOUR LAST TEST: the pure half (the core, 22 Nov 2026).
 *
 * A builder fixes the top problem, runs a second test of the same product, and asks one thing: did it
 * work? This sets the two tests side by side. Every number is counted here from rows:
 *
 *   - understood it, finished the main action, would come back: each "3 of 10 → 7 of 10", from the
 *     same counts each test's own report shows;
 *   - the top problems of the EARLIER test, each with how many people hit it then and how many of the
 *     new test's people ran into the same thing, by the plain report's own rule (a problem sentence
 *     that names two of the same things and fails the same way; `hitBy`). No model reads either side.
 *
 * IT NEVER SAYS "FIXED". Ten people are not proof, and two are not even a direction. A problem nobody
 * hit this time is "gone this time"; with few people on either side the line says so in plain words.
 */

export interface Ratio {
  n: number;
  of: number;
}
export { CHANGE_WORDS, type ProblemChange };

export interface ChangedLine {
  key: "understood" | "finished" | "again";
  label: string;
  then: Ratio;
  now: Ratio;
}
export interface ChangedProblem {
  /** the earlier test's own title for it */
  title: string;
  then: Ratio;
  now: Ratio;
  change: ProblemChange;
  /** too few people, then or now, for the change to mean much; null when there are enough */
  caution: string | null;
}
export interface Changed {
  lines: ChangedLine[];
  problems: ChangedProblem[];
  /** paid people on each side */
  people: { then: number; now: number };
  /** one plain sentence when either test is small; null when both have enough people */
  small: string | null;
}

/** Fewer paid people than this on either side and the comparison says it is small. */
export const SMALL_SAMPLE = 5;
/** A problem this few people hit the first time cannot be called gone when nobody hits it the second. */
export const THIN_PROBLEM = 2;
export const MAX_PROBLEMS_THEN = 3;


/**
 * The same product, by its address: the host without "www." and the path without a trailing slash.
 * The query and the fragment are left out (a campaign tag is not a different product). Null when the
 * address cannot be read.
 */
export function productKey(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export interface TestSide {
  core: CoreReport | null;
  /** this test's paid answers */
  answers: readonly PaidAnswer[];
  /** the person behind each answer (a wallet), so two answers from one person count once */
  personOf: (submissionId: string) => string;
  plain: PlainContext;
}

const peopleOf = (ids: readonly string[], personOf: TestSide["personOf"]): number => new Set(ids.map(personOf)).size;

function cautionFor(change: ProblemChange, then: Ratio, now: Ratio): string | null {
  const thin = then.n <= THIN_PROBLEM || now.of < SMALL_SAMPLE || then.of < SMALL_SAMPLE;
  if (!thin) return null;
  if (change === "gone") return "Too few people to call it fixed.";
  if (change === "fewer") return "Too few people to be sure.";
  return null;
}

/** Fewer, by share of people: 3 of 10 then 2 of 5 is not fewer. Cross-multiplied, so nothing is rounded. */
function changeOf(then: Ratio, now: Ratio): ProblemChange {
  if (now.n === 0) return "gone";
  return now.n * then.of < then.n * now.of ? "fewer" : "still";
}

/**
 * Set an earlier test beside this one. `ranked` is the earlier test's findings in their own order
 * (problems first, by people). Null when there is nothing to compare: no count both tests have, and
 * no problem the earlier test recorded.
 */
export function whatChanged(input: { then: TestSide & { ranked: readonly RankedFinding[] }; now: TestSide }): Changed | null {
  const { then, now } = input;
  const people = { then: peopleOf(then.answers.map((a) => a.id), then.personOf), now: peopleOf(now.answers.map((a) => a.id), now.personOf) };
  if (people.then === 0 || people.now === 0) return null;

  const lines: ChangedLine[] = [];
  const a = then.core;
  const b = now.core;
  if (a && b) {
    if (a.understood.sorted > 0 && b.understood.sorted > 0) {
      lines.push({ key: "understood", label: "Understood what it is", then: { n: a.understood.yes, of: a.understood.sorted }, now: { n: b.understood.yes, of: b.understood.sorted } });
    }
    if (a.action.tapped > 0 && b.action.tapped > 0) {
      lines.push({ key: "finished", label: "Finished the main action", then: { n: a.action.finished, of: a.action.tapped }, now: { n: b.action.finished, of: b.action.tapped } });
      lines.push({ key: "again", label: "Would come back", then: { n: a.again.yes, of: a.again.tapped }, now: { n: b.again.yes, of: b.again.tapped } });
    }
  }

  const problems: ChangedProblem[] = [];
  for (const f of then.ranked) {
    if (problems.length >= MAX_PROBLEMS_THEN) break;
    // a problem in people's words; a rung's own finding is already the "finished" line above
    if ((f.kind !== "stuck" && f.kind !== "bug") || f.rung || f.title === OTHER_NOTES) continue;
    const sig = signatureOf(f);
    if (sig.words.size === 0) continue;
    const t: Ratio = { n: peopleOf(f.submissionIds, then.personOf), of: people.then };
    const n: Ratio = { n: peopleOf(hitBy(sig, now.answers, now.plain), now.personOf), of: people.now };
    const change = changeOf(t, n);
    problems.push({ title: f.title, then: t, now: n, change, caution: cautionFor(change, t, n) });
  }

  if (lines.length === 0 && problems.length === 0) return null;
  const small =
    people.then < SMALL_SAMPLE || people.now < SMALL_SAMPLE
      ? `Small numbers: ${people.then} ${people.then === 1 ? "person" : "people"} then, ${people.now} now. Read this as a direction, not as proof.`
      : null;
  return { lines, problems, people, small };
}
