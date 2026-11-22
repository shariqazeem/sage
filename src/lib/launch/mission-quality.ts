import type { CandidateMission, MissionValidationIssue } from "./schemas";

/**
 * FOUR THINGS A CAREFUL TESTER WOULD STOP AT (22 Nov 2026, measured on every plan Sage ever made).
 *
 * Today's gate was run again over all 2,357 missions in the plans production kept (direct gigs and grants left
 * out), and the ones it still passed were read. Four patterns came back that no existing rule names. Each is a
 * narrow deterministic rule here, and each was added only after counting, on that whole corpus, what it catches
 * and what it would wrongly refuse (`tests/plans-corpus/measure.live.test.ts` prints both, when the private export
 * is present):
 *
 *   1. A PLACE WITH NO NAME. The mission asks the tester to reach "the target" or "core experience": Sage's own
 *      placeholder for a thing it never resolved, in quotes, as if it were a label on the screen. Nobody can
 *      find it, and nobody can check an answer about it.            70 caught (17 products), 0 wrongly refused.
 *   2. THE TESTER'S OWN DETAILS. An evidence question that asks which email, password or phone number the
 *      tester used. An answer is read by the builder and quoted in the findings, so that question publishes a
 *      person's address (and once, their password).                  5 caught (3 products), 0 wrongly refused.
 *   3. DEVELOPER TOOLS. What the mission is paid for can only be read from the browser's developer tools: the
 *      network panel, the page source, a transfer size. An ordinary tester does not have them open, and a
 *      number read from them is nothing Sage saw, so it can never be matched.
 *                                                                    31 caught (2 products). 27 are on one bare
 *      page; the other 4 are developer-docs missions where one question of several needs the tools, and those
 *      4 are the rule's arguable false refusals.
 *   4. THE ANSWER IS ON THE CARD. Every evidence question hands over its own answer ("Quote the text 'Well
 *      done!'", "Provide the URL https://…"). Copying the card back earns the reward without opening the
 *      product.                                                      9 caught (2 products), 0 wrongly refused.
 *
 * Measured and NOT added, because the false refusals were not near zero:
 *   - a passing "no console errors" beside a real task: 34 missions on 13 products, nearly all good work;
 *   - "the first headline" on a news site (it changes hourly, so a pinned key cannot match): 8 caught, but 9
 *     good missions refused beside them (a tester who pastes the article's address is checked live);
 *   - yes-or-no-only evidence: 1 mission in the whole corpus;
 *   - another browser, a phone-width window: unverifiable, but harmless, and often what the builder asked for.
 *
 * Each rule reads only the mission's own words. None of them reads the corpus, so nothing here can become an
 * oracle; none of them touches a payout: a refused mission is rewritten by the architect's corrective round or
 * dropped, exactly like every other gate refusal.
 */

type Asked = Pick<CandidateMission, "criteria" | "evidenceRequirements">;

/** Sage's own words for a thing it never resolved: "the target", "core experience", "main flow". */
const PLACEHOLDER = String.raw`(?:the\s+target|(?:the\s+)?(?:core|main|primary)\s+(?:experience|flow|feature))`;
/** ...quoted as if it were a label on the screen. */
const UNNAMED_TARGET = new RegExp(String.raw`["“”‘’']\s*${PLACEHOLDER}\s*["“”‘’']`, "i");
const ONLY_A_PLACEHOLDER = new RegExp(String.raw`^\s*${PLACEHOLDER}\s*$`, "i");

/**
 * Is this label a placeholder and not a thing a person can find? The goal compiler asks before it writes a
 * label into a criterion, so the placeholder is stopped where it is made and not only at the gate (measured:
 * 44 shipped missions asked testers to reach "core experience", the goal's own words handed back as a place).
 */
export function isPlaceholderTarget(label: string | null | undefined): boolean {
  return ONLY_A_PLACEHOLDER.test(label ?? "");
}

/** An evidence question whose answer is the tester's own email, password or phone number. */
const OWN_DETAIL = /\b(?:what|which)\s+(?:e-?mail(?:\s+address)?|password|phone\s+number)(?:\s+(?:and|or)\s+(?:e-?mail(?:\s+address)?|password|phone\s+number))?\s+did\s+you\s+(?:use|enter|type|sign|register|provide|submit|give)\b/i;

/**
 * The browser's developer tools, or a number only they show, in what the mission is PAID for (a criterion or an
 * evidence question). Two things are deliberately not this, because refusing them refused good missions:
 *   - a passing "no console errors" beside a real task (34 missions on 13 products read that way);
 *   - the tools offered as one way among others ("resize the window, or use device emulation").
 */
const DEV_TOOLS =
  /\bdevtools\b|\bdeveloper\s+tools\b|\b(?:browser(?:'s|’s)?|chrome|firefox)\s+dev\s+tools\b|\bdev\s+tools\s+(?:console|network|\()|\bnetwork\s+(?:tab|panel)\b|\bpage\s+source\b|\binspect\s+element\b|\blighthouse\b|\b(?:transferred|transfer)\s+size\b|\bnumber\s+of\s+(?:network\s+|http\s+)?requests\b/gi;
/** "…, or use DevTools device emulation": the tools are one way among others, so nothing depends on them. */
const ONE_WAY_AMONG_OTHERS = /(?:\bor\b|\beither\b|\(or)[^.;:]{0,40}$/i;

/** An evidence line that carries its own answer: a verb, the kind of thing, then the literal itself. */
const GIVES_ANSWER =
  /^\s*(?:please\s+)?(?:quote|provide|copy|paste|state|enter|type)\s+(?:the\s+)?(?:(?:exact|verbatim|full)\s+)?(?:text|url|heading|title|label|words?|phrase|string)(?:\s+of\s+the\s+page)?(?:\s+used)?\s*[:(]?\s*(?:must\s+be\s+)?(?:["“‘'][^"”’']{2,80}["”’']|https?:\/\/\S+)/i;

const first = (re: RegExp, lines: readonly string[]): string | null => {
  for (const l of lines) {
    const m = re.exec(l ?? "");
    if (m) return m[0].replace(/\s+/g, " ").trim().slice(0, 60);
  }
  return null;
};

/** 1. The mission names a place nobody can find. */
export function namesNoTarget(m: Pick<CandidateMission, "criteria" | "evidenceRequirements">): string | null {
  return first(UNNAMED_TARGET, [...(m.criteria ?? []), ...(m.evidenceRequirements ?? [])]);
}

/** 2. An evidence question asks for the tester's own email, password or phone number. */
export function asksOwnDetail(m: Pick<CandidateMission, "evidenceRequirements">): string | null {
  return first(OWN_DETAIL, m.evidenceRequirements ?? []);
}

/** 3. What the mission is paid for can only be read from the browser's developer tools. */
export function needsDeveloperTools(m: Pick<CandidateMission, "criteria" | "evidenceRequirements">): string | null {
  for (const line of [...(m.criteria ?? []), ...(m.evidenceRequirements ?? [])]) {
    for (const hit of (line ?? "").matchAll(DEV_TOOLS)) {
      if (ONE_WAY_AMONG_OTHERS.test(line.slice(Math.max(0, (hit.index ?? 0) - 60), hit.index ?? 0))) continue;
      return hit[0].replace(/\s+/g, " ").trim().slice(0, 60);
    }
  }
  return null;
}

/** 4. Every evidence question hands over its own answer. */
export function answerIsOnTheCard(m: Pick<CandidateMission, "evidenceRequirements">): boolean {
  const asks = (m.evidenceRequirements ?? []).filter((e) => (e ?? "").trim().length > 0);
  return asks.length > 0 && asks.every((e) => GIVES_ANSWER.test(e));
}

/** The four rules as gate issues, in the gate's own shape. Empty when the mission is clear of all four. */
export function missionQualityIssues(m: Asked): MissionValidationIssue[] {
  const issues: MissionValidationIssue[] = [];
  const target = namesNoTarget(m);
  if (target)
    issues.push({ code: "unnamed_target", field: "criteria", detail: `asks the tester to reach ${target}, which names nothing on the screen: name the screen, the button or the page a person can actually find` });
  const own = asksOwnDetail(m);
  if (own)
    issues.push({ code: "asks_personal_detail", field: "evidenceRequirements", detail: `asks for the tester's own details ("${own}"): an answer is read by the builder and may be quoted, so ask what the product showed instead` });
  const tools = needsDeveloperTools(m);
  if (tools)
    issues.push({ code: "needs_developer_tools", field: "criteria", detail: `needs the browser's developer tools ("${tools}"): an ordinary tester does not use them, and Sage cannot check a number read from them; ask what a person sees on the page` });
  if (answerIsOnTheCard(m))
    issues.push({ code: "answer_on_the_card", field: "evidenceRequirements", detail: "every evidence question hands over its own answer, so copying the card earns the reward; ask for something only a person who did it can say" });
  return issues;
}

/** The first of the four, as one line, or null. For measures that want a single label. */
export function missionQualityIssue(m: Asked): string | null {
  const i = missionQualityIssues(m)[0];
  return i ? `${i.code}: ${i.detail}` : null;
}
