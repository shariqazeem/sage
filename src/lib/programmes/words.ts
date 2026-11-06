/**
 * "EVERY WEEK, FOR 8 WEEKS", READ FROM THE FOUNDER'S OWN WORDS (6 Nov 2026).
 *
 * A founder who hands Sage "pay my 40 ambassadors $5 for a thread about Metis every week for 8 weeks" said
 * how often and for how long. The card arrives with Repeats already set, and the founder only checks it.
 * Pure and deterministic: no model reads a schedule, so it costs nothing and can't invent one. A weekly
 * job with no count starts at 4 weeks, on the stepper the founder changes with a tap.
 */

export const ROUNDS_MIN = 2;
export const ROUNDS_CAP = 26;
export const DEFAULT_WEEKS = 4;

const WEEKLY = /\b(?:every|each|per|once a)\s+week\b|\bweekly\b|\bevery\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bweek\s+(?:after|by)\s+week\b/i;
/** "for 8 weeks" counts only next to a weekly signal: alone it is a duration ("hire a designer for 2 weeks"). */
const FOR_N = /\bfor\s+(?:the\s+next\s+)?(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+weeks?\b/i;
/** "an 8-week programme" is a repeat on its own. */
const N_WEEK_RUN = /\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[-\s]weeks?\s+(?:programme|program|season|series)\b/i;
const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const num = (raw: string | undefined) => (raw ? (WORDS[raw.toLowerCase()] ?? Number(raw)) : 0);
const clamp = (n: number) => Math.min(ROUNDS_CAP, Math.max(ROUNDS_MIN, n));

/** How many weekly rounds the words ask for, or 0 for a job that happens once. */
export function repeatFromWords(text: string): number {
  const t = text ?? "";
  const run = num(N_WEEK_RUN.exec(t)?.[1]);
  if (run >= ROUNDS_MIN) return clamp(run);
  if (!WEEKLY.test(t)) return 0;
  const count = num(FOR_N.exec(t)?.[1]);
  return count >= ROUNDS_MIN ? clamp(count) : DEFAULT_WEEKS;
}
