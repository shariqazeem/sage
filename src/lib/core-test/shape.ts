/**
 * THE CORE OF EVERY TEST, as plain values (the core, 21 Nov 2026). Safe for a browser: no database,
 * no model, no product text.
 *
 * Every test carries one mission that asks a stranger the three things a builder most needs to know:
 * what do you think this is, how far did you get with the one thing it is for, and would you come
 * back. The written answers are judged like any other (against what Sage saw itself). Two of the
 * three also have a TAP, so the report can count them without a model ever reading a word:
 *
 *   - `reached`: how far the person got with the main action, on a ladder that is the same for every
 *     product. It names no screen and no button, so it tells a tester nothing about what Sage saw
 *     (NO CORPUS ORACLE), and it needs no model to sort.
 *   - `again`: would they use it again.
 *
 * A tap is the tester's own claim, exactly as their sentence is. It is never judged and never paid
 * on: an honest "I got stuck on the first screen" earns the same as "I finished".
 */
export const CORE_MISSION_KEY = "core-first-try";

export const isCoreMission = (missionKey: string | null | undefined): boolean => missionKey === CORE_MISSION_KEY;

export const REACHED = ["first-screen", "found-start", "started", "finished"] as const;
export type Reached = (typeof REACHED)[number];

export const AGAIN = ["yes", "maybe", "no"] as const;
export type Again = (typeof AGAIN)[number];

/** What a tester taps, in their voice. */
export const REACHED_TAP: Record<Reached, string> = {
  "first-screen": "I didn't get past the first screen",
  "found-start": "I found where to start, but couldn't begin",
  started: "I started, but couldn't finish",
  finished: "I finished it",
};

/** The same rungs, as a builder reads them in the report. */
export const REACHED_REPORT: Record<Reached, string> = {
  "first-screen": "Stopped on the first screen",
  "found-start": "Found where to start, couldn't begin",
  started: "Started, couldn't finish",
  finished: "Finished",
};

export const AGAIN_TAP: Record<Again, string> = { yes: "Yes", maybe: "Maybe", no: "No" };

export const isReached = (v: unknown): v is Reached => typeof v === "string" && (REACHED as readonly string[]).includes(v);
export const isAgain = (v: unknown): v is Again => typeof v === "string" && (AGAIN as readonly string[]).includes(v);

/**
 * The core mission asks four questions, in this order. The door keeps each answer to one paragraph
 * and joins them with a blank line, so the report can show a person's first impression apart from
 * the rest. Only ever the tester's own words: the questions are never written into the answer.
 */
export const CORE_PARTS = ["impression", "detail", "action", "verdict"] as const;
export type CorePart = (typeof CORE_PARTS)[number];

/** One answer as one paragraph: a blank line inside it would read as the next question's answer. */
export function oneParagraph(answer: string): string {
  return answer.replace(/\r\n?/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

/** The four answers as the one account Sage judges. Every part is required. */
export function composeCoreAccount(answers: readonly (string | undefined)[]): string {
  return CORE_PARTS.map((_, i) => oneParagraph(answers[i] ?? "")).join("\n\n");
}

/**
 * The account back into its four parts. Each part is an exact substring of the account (so a quote of
 * it is verbatim). Null when the account is not four paragraphs: an answer from before the form
 * existed, or one sent by another door. The caller then shows the whole answer and counts nothing.
 */
export function splitCoreAccount(account: string | null | undefined): Record<CorePart, string> | null {
  const parts = (account ?? "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim());
  if (parts.length !== CORE_PARTS.length || parts.some((p) => p.length === 0)) return null;
  return { impression: parts[0]!, detail: parts[1]!, action: parts[2]!, verdict: parts[3]! };
}
