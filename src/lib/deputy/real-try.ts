/**
 * A REAL TRY, OR AN ANSWER WRITTEN WITHOUT ONE (22 Nov 2026).
 *
 * Sage pays a tester for trying a product. The judge checks an answer against what Sage saw itself, and
 * that works while what Sage saw is something only a try reveals. Measured on 12 Aug 2026 by the live
 * judge eval: on a mission whose criteria quoted the product's own words, 8 of 8 honest answers were
 * accepted, and so were 2 of 4 junk ones. One restated the mission card. The card's vocabulary was also
 * in the private key, so restating the card matched the key for free.
 *
 * Counting only non-public words in the matcher was tried and reverted: honest answers fell from 8 of 8
 * to 2 of 8, because on such a mission the card, the page and the key are the same words for everyone.
 * The matcher cannot tell the two apart there. So this module does not touch the matcher or the bar. It
 * answers three questions beside them, with no model, and each answer can only turn a payout into a hold
 * for the builder. Nothing here rejects an answer or refuses a mission.
 *
 *   1. THE MISSION ({@link missionTryReadiness}). Submit the mission card itself as an answer and put
 *      it through the real bar. If it passes, the judge cannot tell a parrot from a try on this mission.
 *      And count the places behind the first screen that hold something only a try reveals: with fewer
 *      than the bar asks matches for, no answer has room to prove a try. Either way the mission's
 *      answers wait for the builder's release. Both thresholds are the bar's own numbers.
 *
 *   2. THE ANSWER'S PROOF OF A TRY ({@link tryEvidence}). How many different places behind the first
 *      screen does the answer name in words that are on neither the card nor the first screen? Two such
 *      places prove a try, and an answer that has them is paid even on a mission that failed question 1.
 *
 *   3. THE PARROT ({@link realTrySignals}, {@link escalateNoTry}). Three medium signals, each honest
 *      alone, combined the way `sybil-escalation.ts` combines wallet signals: an answer that names
 *      nothing from behind the first screen AND is either mostly the card's and first screen's own words
 *      or passed on fewer than three direct matches becomes one HIGH signal, which holds for the builder.
 *
 * "Public" here means the mission card (title, objective, steps, criteria, questions) and the first
 * screen (`page:0`, `state:0`). Deeper pages, later states and the documentation Sage read count as
 * behind the first screen: a person has to go there to see them.
 *
 * LEAK RULE: everything returned is a count, a share or a fixed sentence. No observation text leaves.
 */

import type { BriefFraudSignal } from "./brain-core";
import {
  OBS_BAR,
  OBS_MATCH_OVERLAP,
  contentTokens,
  deriveCriterionEvidence,
  normObs,
  observationBar,
  phraseAnchors,
  proveCriteria,
  verifyAgainstKey,
  type CriterionEvidenceV1,
  type PrivateKey,
} from "./observation-verify";

/** The first screen: the first page Sage read and the state it loaded into. Everything else is behind it. */
export const FIRST_SCREEN_SOURCES: ReadonlySet<string> = new Set(["page:0", "state:0"]);

/** An observation proves a try only through this many words that are on neither the card nor the first screen. */
export const TRY_MIN_PRIVATE_WORDS = 2;

/**
 * Two different places behind the first screen prove a try. One is never enough: a single short label
 * ("continue with google") can be guessed, and the judge's own rule is "never a single lucky phrase"
 * (`CRITERIA_COMPLETE_MIN_MATCHES`). Two keeps the same floor.
 */
export const TRY_PROVEN_SOURCES = 2;

/**
 * An answer is "mostly the card's words" at this share of its distinct content words. Measured offline
 * (`real-try.measure.test.ts`): honest answers 0.24 to 0.58, card parrots and page-only answers 0.75 to
 * 0.91. It is never used alone: it only counts beside "names nothing from behind the first screen".
 */
export const PARROT_PUBLIC_SHARE = 0.65;
/** Below this many content words an answer is too short for its share to mean anything. */
export const PARROT_MIN_WORDS = 8;

const tokensOf = (s: string | null | undefined): string[] => contentTokens(normObs(s));

function bigramsOf(s: string | null | undefined): string[] {
  const t = tokensOf(s);
  const out: string[] = [];
  for (let i = 0; i + 1 < t.length; i++) out.push(`${t[i]} ${t[i + 1]}`);
  return out;
}

/** What a person can read without trying: the mission card and the first screen, as words and as an answer. */
export interface PublicSurface {
  /** the card and the first screen written out as one answer: the best answer that needs no try */
  account: string;
  vocab: Set<string>;
  bigrams: Set<string>;
}

export function publicSurface(key: PrivateKey, publicStrings: readonly string[]): PublicSurface {
  const firstScreen = key.observations.filter((o) => FIRST_SCREEN_SOURCES.has(o.source)).map((o) => o.text);
  const parts = [...publicStrings.filter((s) => typeof s === "string" && s.length > 0), ...firstScreen];
  const vocab = new Set<string>();
  const bigrams = new Set<string>();
  for (const p of parts) {
    for (const t of tokensOf(p)) vocab.add(t);
    for (const g of bigramsOf(p)) bigrams.add(g);
  }
  return { account: parts.join(" . "), vocab, bigrams };
}

/** One observation from behind the first screen, reduced to what only a try reveals. */
interface TryDetail {
  source: string;
  /** its words that are on neither the card nor the first screen (empty when fewer than the floor) */
  privateWords: string[];
  /** its two-word phrases that are not public and carry at least one private word */
  phrases: string[];
}

function tryDetails(key: PrivateKey, pub: PublicSurface): TryDetail[] {
  const out: TryDetail[] = [];
  for (const o of key.observations) {
    if (FIRST_SCREEN_SOURCES.has(o.source)) continue;
    const words = [...new Set(tokensOf(o.text).filter((t) => !pub.vocab.has(t)))];
    const phrases = bigramsOf(o.text).filter((g) => !pub.bigrams.has(g) && g.split(" ").some((t) => !pub.vocab.has(t)));
    const privateWords = words.length >= TRY_MIN_PRIVATE_WORDS ? words : [];
    if (privateWords.length > 0 || phrases.length > 0) out.push({ source: o.source, privateWords, phrases });
  }
  return out;
}

export interface MissionTryReadiness {
  /** distinct sources in the key */
  keySources: number;
  /** distinct sources the mission card matches when it is submitted as the answer */
  cardSources: number;
  /** the card clears the judge's own bar: the judge cannot tell a parrot from a try here */
  cardClears: boolean;
  /** distinct sources behind the first screen carrying something only a try reveals */
  tryOnlySources: number;
  /** Sage can pay this mission's answers on its own (when the rest of the bar and the switches allow) */
  autonomous: boolean;
}

export interface MissionCard {
  /** every string a tester can read on the card: title, objective, steps, criteria, questions */
  publicStrings: readonly string[];
  criteria: readonly string[];
  evidenceRequirements?: readonly string[];
  /** the compiler's criterion contract, when the mission carries one */
  criterionEvidence?: readonly CriterionEvidenceV1[] | null;
}

/**
 * The mission's contract: the compiler's when the mission carries one, else one derived from the key and
 * the criteria (a derived contract helps and never blocks). The payout pipeline resolves it here too.
 */
export function contractFor(key: PrivateKey, card: MissionCard): { evidence: CriterionEvidenceV1[] | null; derived: boolean } {
  if (card.criterionEvidence) return { evidence: [...card.criterionEvidence], derived: false };
  const derived = deriveCriterionEvidence(key, card.criteria, card.evidenceRequirements ?? []);
  return derived.some((c) => c.keySources.length > 0) ? { evidence: derived, derived: true } : { evidence: null, derived: false };
}

/**
 * Would this answer clear the bar on the deterministic layers alone (no model, no earlier answers, no
 * fraud signal)? The same signals `assembleObservationDecision` builds, so "the card clears the bar"
 * means the real bar. A test holds the two together.
 */
export function deterministicBarPass(account: string, key: PrivateKey, card: MissionCard): { pass: boolean; distinctSources: number } {
  const match = verifyAgainstKey(account, key);
  const anchors = phraseAnchors(account, key, card.publicStrings);
  const contract = contractFor(key, card);
  const proof = contract.evidence && contract.evidence.length > 0 ? proveCriteria(account, key, contract.evidence, new Set(match.matched.map((o) => o.source))) : null;
  const bar = observationBar({
    distinctSources: match.distinctSources,
    deterministicSources: match.distinctSources,
    phraseAnchors: anchors.length,
    keyDistinctSources: key.distinctSources,
    vetoFired: false,
    nearDupClear: true,
    hasHighFraud: false,
    ...(proof ? { unprovenCriteria: proof.missingCriteria, criteriaAdvisory: contract.derived, criteriaAllProven: proof.allProven } : {}),
  });
  return { pass: bar.pass, distinctSources: match.distinctSources };
}

/**
 * A mission needs at least this many places behind the first screen that hold something only a try
 * reveals. It is the bar's own count of matches (`OBS_BAR.minDistinctMatches`): with fewer, an honest
 * tester has no room to show a try on the things the bar counts, and a page reader looks the same.
 */
export const TRY_ONLY_MIN_SOURCES: number = OBS_BAR.minDistinctMatches;

/**
 * QUESTION 1: can the judge tell a parrot from a try on this mission?
 *
 * The card is the most a parrot has, and the matcher only ever gains from more words, so no restating
 * of the card scores above the card itself on the deterministic layers. If the card clears the bar, or
 * what Sage saw behind the first screen is too thin, the mission is not autonomous.
 *
 * (A person who only READ the first screen is a different case, and no property of the mission: the
 * first screen is in the key on purpose, since a tester is asked what they saw there. That answer is
 * caught per answer, by the signals below.)
 */
export function missionTryReadiness(key: PrivateKey, card: MissionCard): MissionTryReadiness {
  const pub = publicSurface(key, card.publicStrings);
  const parrot = deterministicBarPass(card.publicStrings.join(" . "), key, card);
  const tryOnlySources = new Set(tryDetails(key, pub).map((d) => d.source)).size;
  return {
    keySources: key.distinctSources,
    cardSources: parrot.distinctSources,
    cardClears: parrot.pass,
    tryOnlySources,
    autonomous: !parrot.pass && tryOnlySources >= TRY_ONLY_MIN_SOURCES,
  };
}

export interface TryEvidence {
  /** distinct places behind the first screen the answer names in words that are not public */
  trySources: number;
  /** share of the answer's distinct content words that are on the card or the first screen (0..1) */
  publicShare: number;
  /** the answer's distinct content words */
  contentWords: number;
}

/**
 * QUESTION 2: what in this answer could only come from a try?
 *
 * A place counts when the answer carries most of an observation's private words (the matcher's own 0.6),
 * or reproduces one of its two-word phrases that is not public. Places are sources, so three details
 * from one screen are one place, exactly as the bar counts.
 */
export function tryEvidence(account: string | null | undefined, key: PrivateKey, publicStrings: readonly string[]): TryEvidence {
  const pub = publicSurface(key, publicStrings);
  const words = new Set(tokensOf(account));
  const phrases = new Set(bigramsOf(account));
  const sources = new Set<string>();
  for (const d of tryDetails(key, pub)) {
    if (sources.has(d.source)) continue;
    const shared = d.privateWords.filter((w) => words.has(w)).length;
    const byWords = d.privateWords.length > 0 && shared / d.privateWords.length >= OBS_MATCH_OVERLAP;
    if (byWords || d.phrases.some((g) => phrases.has(g))) sources.add(d.source);
  }
  let publicWords = 0;
  for (const w of words) if (pub.vocab.has(w)) publicWords++;
  return { trySources: sources.size, publicShare: words.size > 0 ? publicWords / words.size : 0, contentWords: words.size };
}

/* ───────────────────────── the signals, and how they combine ───────────────────────── */

export const CARD_PARROT_SIGNAL = "card parrot";
export const NO_TRY_DETAIL_SIGNAL = "nothing from behind the first screen";
export const THIN_PASS_SIGNAL = "fewer than three direct matches";
export const NO_TRY_SIGNAL = "no sign of a try";

/** What the bar said about this answer, as the pipeline already has it (fresh or from the stored verdict). */
export interface PassFacts {
  barPass: boolean;
  /** distinct sources the deterministic matcher found by itself */
  deterministicSources?: number;
  /** the criteria-complete pass decided it */
  criteriaCompletePass?: boolean;
}

/**
 * The three MEDIUM signals. Each is honest alone:
 *   - an honest tester may answer in the card's own words;
 *   - an honest tester who got stuck on the first screen names nothing behind it;
 *   - an honest concise tester passes on two matches and a complete set of criteria, or on phrases.
 * None of them holds a payout by itself.
 */
export function realTrySignals(evidence: TryEvidence, readiness: MissionTryReadiness, pass: PassFacts): BriefFraudSignal[] {
  const out: BriefFraudSignal[] = [];
  if (evidence.contentWords >= PARROT_MIN_WORDS && evidence.publicShare >= PARROT_PUBLIC_SHARE) {
    out.push({
      signal: CARD_PARROT_SIGNAL,
      severity: "med",
      reason: `${Math.round(evidence.publicShare * 100)}% of this answer's words are on the mission card or the product's first screen.`,
    });
  }
  // only when Sage saw something behind the first screen to compare with: otherwise it cannot know
  if (readiness.tryOnlySources > 0 && evidence.trySources === 0) {
    out.push({
      signal: NO_TRY_DETAIL_SIGNAL,
      severity: "med",
      reason: "The answer names nothing Sage saw behind the first screen.",
    });
  }
  // Fewer than three direct matches: the pass rests on a relaxation (a complete set of criteria, product
  // phrases, or links the model drew). Each is sound alone; none shows the answer left the first screen.
  const thin = pass.barPass && (pass.criteriaCompletePass === true || (pass.deterministicSources ?? OBS_BAR.minDistinctMatches) < OBS_BAR.minDistinctMatches);
  if (thin) {
    out.push({
      signal: THIN_PASS_SIGNAL,
      severity: "med",
      reason: "The answer passed on fewer than three direct matches: on a complete set of criteria, on product phrases, or on links the model drew.",
    });
  }
  return out;
}

const has = (signals: readonly BriefFraudSignal[], name: string) => signals.some((s) => s.signal === name && s.severity !== "low");

/**
 * Nothing from behind the first screen, AND either mostly the card's words or the thinnest pass: together
 * that is an answer written without trying. One HIGH signal, a hold with the reason written out, never a
 * refusal. The mediums stay listed beside it.
 */
export function escalateNoTry(signals: readonly BriefFraudSignal[]): BriefFraudSignal | null {
  if (!has(signals, NO_TRY_DETAIL_SIGNAL)) return null;
  const parrot = has(signals, CARD_PARROT_SIGNAL);
  const thin = has(signals, THIN_PASS_SIGNAL);
  if (!parrot && !thin) return null;
  const parts = [
    "it names nothing Sage saw behind the first screen",
    parrot ? "most of its words are the mission card's or the first screen's" : null,
    thin ? "it passed on fewer than three direct matches" : null,
  ].filter(Boolean);
  return {
    signal: NO_TRY_SIGNAL,
    severity: "high",
    reason: `This answer could have been written without trying the product: ${parts.join(", ")}. Held for the builder to look at; nothing is refused.`,
  };
}

/* ───────────────────────────── the one call the pipeline makes ───────────────────────────── */

export type RealTryHold = "no_sign_of_a_try" | "public_overlap";

export interface RealTryVerdict {
  readiness: MissionTryReadiness;
  evidence: TryEvidence;
  /** the mediums, and the HIGH when they combined */
  signals: BriefFraudSignal[];
  /** the answer names enough from behind the first screen to prove a try */
  tryProven: boolean;
  /**
   * Why a passing answer waits for the builder, or null when nothing here objects. Only ever read when
   * the bar passed: this can turn a payout into a hold and nothing else.
   */
  hold: RealTryHold | null;
}

export function judgeRealTry(input: { account: string | null | undefined; key: PrivateKey; card: MissionCard; pass: PassFacts }): RealTryVerdict {
  const readiness = missionTryReadiness(input.key, input.card);
  const evidence = tryEvidence(input.account, input.key, input.card.publicStrings);
  const mediums = realTrySignals(evidence, readiness, input.pass);
  const high = escalateNoTry(mediums);
  const tryProven = evidence.trySources >= TRY_PROVEN_SOURCES;
  const hold: RealTryHold | null = high ? "no_sign_of_a_try" : !readiness.autonomous && !tryProven ? "public_overlap" : null;
  return { readiness, evidence, signals: high ? [...mediums, high] : mediums, tryProven, hold };
}

/** Counts and names only: what the calibration log keeps of a verdict. */
export interface RealTryShadow {
  cardClears: boolean;
  cardSources: number;
  tryOnlySources: number;
  trySources: number;
  publicShare: number;
  signals: string[];
  hold: RealTryHold | null;
}

export function realTryShadow(v: RealTryVerdict): RealTryShadow {
  return {
    cardClears: v.readiness.cardClears,
    cardSources: v.readiness.cardSources,
    tryOnlySources: v.readiness.tryOnlySources,
    trySources: v.evidence.trySources,
    publicShare: Math.round(v.evidence.publicShare * 100) / 100,
    signals: v.signals.map((s) => s.signal),
    hold: v.hold,
  };
}

/** The one calm line a builder reads beside a mission whose answers they will release, before they pay. */
export const RELEASE_LINE =
  "Sage may ask you to release answers to this mission: much of what it can check is also on the mission card or your public page. An answer that names what is behind the first screen is still paid without you.";
