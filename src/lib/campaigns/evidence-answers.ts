/**
 * THE FORM A MISSION ASKS FOR.
 *
 * A tester used to face one box labelled "What you did and saw", and nothing told them what "and
 * saw" had to contain. So they wrote what anyone writes into an empty box — two honest sentences —
 * and the observation bar, which needs three distinct details only a real user could know, held them.
 * Measured on a real corpus: a terse genuine account reached 0 distinct sources, a narrative one
 * reached 1, and the only account that cleared the bar did so by echoing marketing copy.
 *
 * The mission already knows what it needs. `evidenceRequirements` is authored per product by the
 * mission brain, from what Sage actually saw while browsing — so it is different for a pizza form, a
 * drawing canvas and a launch wizard, without a single product-specific string anywhere in the code.
 * Turning that list into the FIELDS OF THE FORM is what makes a terse tester a paid tester: asked
 * three specific questions, an honest person writes three specific answers, and specific answers are
 * exactly what the bar is looking for.
 *
 * The judged account is composed of the tester's OWN WORDS ONLY. The prompts are public text from the
 * mission card, and folding them into the account would put words the tester never wrote in front of
 * the verifier — at best noise, at worst credit for language they only read.
 */

/** How many questions a tester is asked. Beyond this it stops being a form and becomes a chore. */
export const MAX_EVIDENCE_PROMPTS = 4;

/**
 * How long the composed account may be. Sized for the FORM, not for one box: up to
 * {@link MAX_EVIDENCE_PROMPTS} answers, each long enough to describe a screen properly.
 *
 * The old limit was 500 — correct when a tester faced a single textarea, and wrong the moment the
 * mission started asking several questions. A real submission on the yara campaign (two thorough,
 * specific answers, exactly the kind the observation bar pays for) came to roughly 700 characters and
 * was refused. A cap that rejects the accounts most likely to clear is fighting its own product.
 */
export const MAX_ACCOUNT_CHARS = 4000;

/** The minimum a single answer must contain before it counts as answered at all. */
const MIN_ANSWER_CHARS = 3;

/**
 * The questions this mission puts to a tester. Empty when the mission carries no requirements, in
 * which case the caller falls back to one open box — an honest degradation, never a blank form.
 */
export function evidencePrompts(
  evidenceList: readonly string[] | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of evidenceList ?? []) {
    const t = (raw ?? "").replace(/\s+/g, " ").trim();
    if (t.length < 4) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_EVIDENCE_PROMPTS) break;
  }
  return out;
}

/**
 * Compose the answers into the single account the pipeline judges. Blank answers are dropped rather
 * than contributing empty lines, and nothing but the tester's own text is included — see the note
 * above on why the prompts stay out.
 */
export function composeAccount(answers: readonly (string | undefined)[]): string {
  return answers
    .map((a) => (a ?? "").trim())
    .filter((a) => a.length > 0)
    .join("\n\n")
    .trim();
}

/** Is this submission answerable at all? One real answer is the floor; the bar judges the rest. */
export function hasAnyAnswer(answers: readonly (string | undefined)[]): boolean {
  return answers.some((a) => (a ?? "").trim().length >= MIN_ANSWER_CHARS);
}

/**
 * Which prompts are still unanswered, by index — used to tell a tester what is missing BEFORE they
 * spend one of their limited attempts. This is not a corpus oracle: it reads only the tester's own
 * form, never the private key, and says nothing about whether an answer is right.
 */
export function unansweredPrompts(
  prompts: readonly string[],
  answers: readonly (string | undefined)[],
): number[] {
  const out: number[] = [];
  for (let i = 0; i < prompts.length; i++) {
    if ((answers[i] ?? "").trim().length < MIN_ANSWER_CHARS) out.push(i);
  }
  return out;
}
