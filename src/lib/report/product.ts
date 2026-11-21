import { REACHED, REACHED_REPORT, splitCoreAccount, type Again, type Reached } from "@/lib/core-test/shape";
import { firstSentence, matchSageProblem, type Finding, type PaidAnswer, type Read, type Understood } from "./core";

/**
 * THE FINDINGS AS A PRODUCT REPORT: the pure half (the core, 21 Nov 2026).
 *
 * "What 10 strangers found, and what to fix first." Every NUMBER here is counted in this file from
 * rows: paid answers, what each person tapped, and one checked label per first impression. A model
 * may have chosen how answers group and suggested a fix; it never wrote a count, and nothing here
 * reads one from it.
 *
 *   1. UNDERSTOOD IT   X of N, from one label per core answer, with each person's own sentence.
 *   2. THE MAIN ACTION N finished, the rest on the rung where they stopped, from their taps.
 *   3. PROBLEMS        ranked by how many people hit them, with a fix and "Sage saw this too".
 *   4. FIX FIRST       the top three, by people.
 */
export type Quote = { submissionId: string; text: string };

export interface CoreReport {
  /** paid answers to the core mission: the N every count below is out of */
  asked: number;
  /** the product's main action, in the mission's own words ("start a drop"), or null */
  mainAction: string | null;
  understood: {
    /** what the product says it is */
    says: string | null;
    /** answers that carry a label; `asked - sorted` are shown in their words and not counted */
    sorted: number;
    yes: number;
    partly: number;
    no: number;
    /** each person's first-impression sentence, exactly as written */
    words: (Quote & { read: Read | null })[];
  };
  action: {
    /** answers that carry a tap */
    tapped: number;
    finished: number;
    /** every rung, in order, with how many people ended there and what they wrote about it */
    rungs: { reached: Reached; label: string; count: number; quotes: Quote[] }[];
  };
  again: { tapped: number; yes: number; maybe: number; no: number; words: (Quote & { again: Again | null })[] };
}

export interface CoreTaps {
  reached: Reached;
  again: Again;
}

/** The main action, read back from the core mission's third question: "You tried to start a drop. Which…". */
export function mainActionOf(evidenceList: readonly string[] | null | undefined): string | null {
  for (const q of evidenceList ?? []) {
    const m = /^You tried to (.{3,90}?)\. Which screens/.exec(q);
    if (m) return m[1]!;
  }
  return null;
}

const quote = (id: string, text: string | undefined): Quote[] => {
  const q = text ? firstSentence(text) : null;
  return q ? [{ submissionId: id, text: q }] : [];
};

/** The counts of the core mission, from its paid answers, the taps, and the labels. Pure. */
export function coreReport(input: {
  /** paid answers to the core mission, oldest first */
  answers: readonly PaidAnswer[];
  taps: ReadonlyMap<string, CoreTaps>;
  understood: readonly Understood[];
  says: string | null;
  mainAction: string | null;
}): CoreReport | null {
  const { answers } = input;
  if (answers.length === 0) return null;
  const ids = new Set(answers.map((a) => a.id));
  const label = new Map(input.understood.filter((u) => ids.has(u.submissionId)).map((u) => [u.submissionId, u.read]));
  const parts = new Map(answers.map((a) => [a.id, splitCoreAccount(a.text)]));

  const words = answers.flatMap((a) => {
    const p = parts.get(a.id);
    // an answer that is not the four-part form has no first impression to show or to count
    return p ? [{ submissionId: a.id, text: p.impression, read: label.get(a.id) ?? null }] : [];
  });
  const counted = words.filter((w) => w.read !== null);
  const n = (r: Read) => counted.filter((w) => w.read === r).length;

  const tapped = answers.filter((a) => input.taps.has(a.id));
  const rungs = REACHED.map((reached) => {
    const here = tapped.filter((a) => input.taps.get(a.id)!.reached === reached);
    return { reached, label: REACHED_REPORT[reached], count: here.length, quotes: here.flatMap((a) => quote(a.id, parts.get(a.id)?.action)) };
  });
  const a = (v: Again) => tapped.filter((x) => input.taps.get(x.id)!.again === v).length;

  return {
    asked: answers.length,
    mainAction: input.mainAction,
    understood: { says: input.says, sorted: counted.length, yes: n("yes"), partly: n("partly"), no: n("no"), words },
    action: { tapped: tapped.length, finished: rungs.find((r) => r.reached === "finished")!.count, rungs },
    again: {
      tapped: tapped.length,
      yes: a("yes"),
      maybe: a("maybe"),
      no: a("no"),
      words: answers.flatMap((x) => quote(x.id, parts.get(x.id)?.verdict).map((q) => ({ ...q, again: input.taps.get(x.id)?.again ?? null }))),
    },
  };
}

/* ─────────────────────────────────────────────────────── problems, ranked ── */

export interface SageProblem {
  id: string;
  title: string;
  fix: string;
  /** title plus the exact recorded text: what a finding's words are matched against */
  text: string;
}

export interface RankedFinding extends Finding {
  /** distinct people, counted here */
  count: number;
  /** the matching problem from Sage's own first look, when code confirms it */
  sage: SageProblem | null;
  /** the fix to show: the model's checked sentence, else Sage's own fix for the matching problem */
  suggestedFix: string | null;
}

const PROBLEM_KINDS = new Set(["stuck", "bug"]);
const KIND_ORDER: Record<Finding["kind"], number> = { stuck: 0, bug: 0, idea: 1, liked: 2, other: 3 };

/**
 * Every finding with its count, its match in Sage's first look and its fix; problems first, then by
 * how many people, then (on a tie) the ones Sage saw too. A stored `sageSaw` id that no longer exists
 * is ignored, and a finding with none is matched here by shared words, strictly.
 */
export function rankFindings(findings: readonly Finding[], sage: readonly SageProblem[]): RankedFinding[] {
  const byId = new Map(sage.map((p) => [p.id, p]));
  return findings
    .map((f, i) => {
      const matched = (f.sageSaw ? byId.get(f.sageSaw) : undefined) ?? (PROBLEM_KINDS.has(f.kind) || f.kind === "other" ? byId.get(matchSageProblem(f, [...sage]) ?? "") : undefined) ?? null;
      const count = new Set(f.submissionIds).size;
      return { f: { ...f, count, sage: matched, suggestedFix: f.fix ?? matched?.fix ?? null }, i };
    })
    .sort((a, b) => KIND_ORDER[a.f.kind] - KIND_ORDER[b.f.kind] || b.f.count - a.f.count || Number(!!b.f.sage) - Number(!!a.f.sage) || a.i - b.i)
    .map((x) => x.f);
}

/* ─────────────────────────────────────────────────────────── fix these first ── */

export interface FixFirst {
  title: string;
  fix: string;
  /** how many people hit it; 0 when only Sage saw it */
  people: number;
  /** where it comes from: grouped answers, the main-action taps, the first-impression labels, or Sage's own run */
  from: "people" | "main-action" | "understanding" | "sage";
  sageSawToo: boolean;
}

const RUNG_FIX: Record<Exclude<Reached, "finished">, string> = {
  "first-screen": "Make the first screen say what this is and show one obvious way to start. These people never left it.",
  "found-start": "People find the way in and it doesn't open for them. Try the start yourself in a fresh browser and on a phone.",
  started: "People begin and don't finish. Read where each one stopped, and cut or fix that step.",
};

/**
 * The top three things to fix, by how many people hit each. Candidates: every problem finding that has
 * a fix, the rung where the most people stopped, a first impression most people got wrong, and then
 * (only to fill the list) problems Sage recorded itself that no tester has reported.
 */
export function fixFirst(input: { ranked: readonly RankedFinding[]; core: CoreReport | null; sage: readonly SageProblem[]; max?: number }): FixFirst[] {
  const out: FixFirst[] = [];
  for (const f of input.ranked) {
    if (!PROBLEM_KINDS.has(f.kind) || !f.suggestedFix) continue;
    out.push({ title: f.title, fix: f.suggestedFix, people: f.count, from: "people", sageSawToo: !!f.sage });
  }
  const core = input.core;
  if (core) {
    const stopped = core.action.rungs.filter((r) => r.reached !== "finished" && r.count > 0).sort((a, b) => b.count - a.count)[0];
    if (stopped) {
      out.push({ title: `${stopped.label}: ${stopped.count} of ${core.action.tapped}`, fix: RUNG_FIX[stopped.reached as Exclude<Reached, "finished">], people: stopped.count, from: "main-action", sageSawToo: false });
    }
    const missed = core.understood.partly + core.understood.no;
    if (core.understood.sorted >= 2 && missed > core.understood.yes) {
      out.push({
        title: `${missed} of ${core.understood.sorted} did not take it for what it says it is`,
        fix: "Rewrite the first screen's headline to say what it is and who it is for. Their own sentences show what they took it for.",
        people: missed,
        from: "understanding",
        sageSawToo: false,
      });
    }
  }
  out.sort((a, b) => b.people - a.people || Number(b.sageSawToo) - Number(a.sageSawToo));
  const max = input.max ?? 3;
  const top = out.slice(0, max);
  // not enough from people yet: what Sage recorded itself fills the list, and says so
  const named = new Set(input.ranked.filter((f) => f.sage).map((f) => f.sage!.id));
  for (const p of input.sage) {
    if (top.length >= max) break;
    if (named.has(p.id)) continue;
    top.push({ title: p.title, fix: p.fix, people: 0, from: "sage", sageSawToo: true });
  }
  return top;
}
