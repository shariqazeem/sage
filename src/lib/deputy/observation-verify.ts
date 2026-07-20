/**
 * P16 observation-judging — the DETERMINISTIC core that verifies a tester's written account against
 * Sage's OWN private eyes (the field-test state log + vision), which the tester never saw.
 *
 * The private key is PINNED AT ATTACH (before any tester sees a card) and is DISTILLED: it is Sage's
 * field-test observations MINUS every public plan/card string. That exclusion is STRUCTURAL — the
 * public strings are literally not in the stored key — so a parrot of the mission card scores exactly
 * ZERO non-public matches, by construction, with no runtime cleverness. Judge-time is then a pure,
 * auditable substring match against the pinned key, and the key's digest anchors the proof receipt.
 *
 * "Distinct" matches count by SOURCE (a state/screen), not by substring: three phrases lifted from one
 * observed state are one distinct match, so the bar (≥N distinct) means the tester described N different
 * things Sage saw. Vision frames fold into their state (`stateIndex`) so a state and its screenshot are
 * one source, never double-counted.
 *
 * Pure + deterministic; never imports the frozen brain. The account stays fully untrusted upstream
 * (injection detector, markers, truncation all still apply before anything reaches here).
 */

import { keccak256, toBytes } from "viem";
import type { FieldTestSummary } from "@/lib/launch/schemas";

/** One thing Sage privately observed, tagged with the SOURCE (screen/state) it came from. */
export interface PrivateObservation {
  /** stable id for the screen this came from — `state:<i>` (interactive) or `page:<i>` (static). */
  source: string;
  /** the observed string, normalized (lowercased, whitespace-collapsed). */
  text: string;
}

/** The pinned, distilled private answer key + its digest (for the proof receipt). */
export interface PrivateKey {
  observations: PrivateObservation[];
  /** number of DISTINCT sources in the key — the campaign-eligibility signal (thin key → founder-only). */
  distinctSources: number;
  /** keccak256 over the canonical serialization — auditable anchor on the proof receipt. */
  digest: string;
}

/** Result of matching one account against the pinned key. */
export interface CorpusMatch {
  /** distinct SOURCES matched (the bar counts these, not raw substrings). */
  distinctSources: number;
  /** total observation strings matched (informational). */
  matchedCount: number;
  /** the matched observations (for the brief + shadow log; never leaked to a public feed). */
  matched: PrivateObservation[];
}

const MIN_OBS_LEN = 4; // ignore trivially short fragments (calibratable in shadow)
const MAX_OBS = 400; // size-cap the stored key
const MAX_KEY_CHARS = 24_000; // hard char budget on the serialized key
/**
 * P20.0 anti-guess floor: an observation must carry this many CONTENT words to be a matchable answer-key
 * entry. Generic category/UI terms ("shapes", "tools", "keyboard shortcuts") are 1–2 words and guessable;
 * requiring ≥3 forces the key toward firsthand-distinctive detail a copier/guesser can't reproduce. Applied
 * at BOTH distill (new keys) and match (existing keys), so the fuzzy-overlap matcher can't be gamed by
 * common product vocabulary. Weak/shallow corpuses correctly thin out → founder-only until enriched (P21).
 */
const OBS_MIN_CONTENT_WORDS = 2;
/**
 * P20.0 anti-inflation: an observation TEXT that recurs across this many distinct sources is a persistent
 * generic (a toolbar on every screen, a category label) — not firsthand-distinctive to any one moment.
 * Dropping it stops a single generic guess from claiming many distinct-source credits at once. A truly
 * firsthand observation is tied to one screen/moment (1 source), so this never touches genuine specifics.
 */
const OBS_MAX_SOURCE_SPREAD = 3;

/** Normalize for matching: lowercased, punctuation→space, whitespace-collapsed. */
export function normObs(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Split rendered prose (a paragraph / sentence) into discrete matchable lines/clauses. */
function splitLines(s: string): string[] {
  return (s ?? "")
    .split(/[\n\r]+|(?<=[.!?])\s+|\s{2,}|[•|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * P23-B: connectives that introduce a DISTINCT sub-object inside a vision/prose description. A vision
 * scene sentence ("a sunset landscape featuring hills with floating lanterns and a stone path") is long
 * (11–20 words) and near-unmatchable at the 0.6 overlap bar — a genuine tester who accurately describes
 * what they saw ("floating lanterns", "a stone path") still misses the whole blob. Splitting on these
 * connectives turns that ONE unmatchable blob into the several short firsthand PHRASES a real tester
 * actually reproduces, so Sage's genuine visual knowledge becomes reachable — while parrot/guesser stay
 * zero (each phrase still needs ≥2 firsthand-specific content words that aren't on the public card, and
 * the ≥3-distinct-SOURCE bar means a lucky phrase or two never clears). Deliberately NOT the common
 * prepositions on/at/in (they over-fragment real phrases like "make a wish at the wishing tree").
 */
const PHRASE_CONNECTIVES = /\s+(?:of|with|featuring|showing|depicting|displaying|including|and|over|that|beside|near)\s+/g;

/** Break a normalized line into matchable phrases on connectives. Short lines (no connective — a UI label,
 *  a dialogue quote, "tap to step inside") pass through WHOLE; only long prose fragments into object-phrases. */
function phraseChunks(t: string): string[] {
  return t.split(PHRASE_CONNECTIVES).map((x) => x.trim()).filter(Boolean);
}

/**
 * Distill the PINNED private key from a field test, EXCLUDING every public string (plan/card/board).
 * The exclusion is a normalized-substring test against the joined public blob, so anything a tester
 * could have read off the card is removed before storage — parrot-scores-zero is structural.
 */
export function distillPrivateKey(
  fieldTest: FieldTestSummary | null | undefined,
  publicStrings: string[],
): PrivateKey {
  const publicBlob = ` ${normObs(publicStrings.join(" • "))} `;
  const raw: PrivateObservation[] = [];
  const add = (source: string, text: string | null | undefined) => {
    for (const line of splitLines(text ?? "")) {
      // P23-B: break a long prose line into the short firsthand phrases a genuine tester reproduces, so
      // Sage's visual knowledge is matchable — not stored as one unmatchable 15-word blob. Short lines
      // (labels, dialogue) have no connective and pass through whole.
      for (const t of phraseChunks(normObs(line))) {
        if (t.length < MIN_OBS_LEN) continue;
        // P20.0 anti-guess: a matchable observation must be specific (≥2 content words), so generic
        // product vocabulary ("shapes", "tools", "keyboard shortcuts") can't seed a guesser's matches.
        if (contentTokens(t).length < OBS_MIN_CONTENT_WORDS) continue;
        // STRUCTURAL parrot-exclusion: drop anything readable off a public card.
        if (publicBlob.includes(` ${t} `) || publicBlob.includes(t)) continue;
        raw.push({ source, text: t });
      }
    }
  };

  const ft = fieldTest;
  if (ft?.ran) {
    (ft.pages ?? []).forEach((p, i) => {
      const s = `page:${i}`;
      add(s, p.title);
      add(s, p.h1);
      (p.ctas ?? []).forEach((c) => add(s, c));
    });
    (ft.states ?? []).forEach((st, i) => {
      const s = `state:${i}`;
      add(s, st.visibleTextExcerpt);
      (st.notableElements ?? []).forEach((e) => add(s, e.text));
    });
    // Vision frames fold into their STATE so a screen + its screenshot are one source. productType /
    // audience signals are DELIBERATELY excluded (P20.0): they are generic category classifications
    // ("diagramming tool", "designers") — guessable, not firsthand-distinctive, so they'd let a guesser
    // clear the bar. Only what Sage concretely SAW (scene description, on-screen text, element labels).
    (ft.visionObservations ?? []).forEach((v) => {
      const s = `state:${v.stateIndex}`;
      add(s, v.sceneDescription);
      (v.visibleText ?? []).forEach((t) => add(s, t));
      (v.uiElements ?? []).forEach((e) => add(s, e.label));
    });
  }

  // P20.0/P21 anti-inflation: a text that recurs across ≥ OBS_MAX_SOURCE_SPREAD distinct sources is
  // COLLAPSED to a single source (its first occurrence), not dropped. The threat it guards is a generic
  // term ("toolbar") on every screen claiming MANY distinct-source credits from one guess — collapsing to
  // one source removes that multiplier completely. But P21's deep exploration surfaces RICH-but-persistent
  // UI too (a drawing app's "stroke width / arrow binding / zen mode" properties panel stays open across
  // states); dropping that outright (the old behavior) deleted exactly the firsthand detail we now reach.
  // Collapse keeps the content while still capping its credit at one source. Specific-vs-generic is handled
  // separately by the ≥2-content-word floor + the category-signal exclusion above, not by persistence.
  const sourcesByText = new Map<string, Set<string>>();
  for (const o of raw) (sourcesByText.get(o.text) ?? sourcesByText.set(o.text, new Set()).get(o.text)!).add(o.source);
  // Dedupe by (source, text); collapse over-spread texts to their first source; size + char cap.
  const seen = new Set<string>();
  const collapsedKept = new Set<string>(); // over-spread texts we've already admitted once
  const observations: PrivateObservation[] = [];
  let chars = 0;
  for (const o of raw) {
    if ((sourcesByText.get(o.text)?.size ?? 0) >= OBS_MAX_SOURCE_SPREAD) {
      if (collapsedKept.has(o.text)) continue; // keep only the FIRST occurrence of a persistent text
      collapsedKept.add(o.text);
    }
    const k = `${o.source}|${o.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    chars += o.text.length + o.source.length + 1;
    if (observations.length >= MAX_OBS || chars > MAX_KEY_CHARS) break;
    observations.push(o);
  }
  const distinctSources = new Set(observations.map((o) => o.source)).size;
  const canonical = observations
    .map((o) => `${o.source}${o.text}`)
    .sort()
    .join("");
  const digest = keccak256(toBytes(canonical));
  return { observations, distinctSources, digest };
}

/** Ultra-common words dropped before overlap scoring so overlap reflects real signal, not grammar.
 *  Deliberately small — the goal is to ignore filler, not to stem or synonym-match (that stays the
 *  LLM judge's job). */
const OBS_STOPWORDS = new Set(
  "the a an of to and or is are was were it its in on at for with this that then than there here you your we our my so they them their would could have has had some as be by up out into onto over off me first finally".split(
    " ",
  ),
);
function contentTokens(s: string): string[] {
  const out: string[] = [];
  for (const w of s.split(" ")) if (w.length >= 3 && !OBS_STOPWORDS.has(w)) out.push(w);
  return out;
}

/** An observation counts when ≥ this fraction of its content words appear in the account. Real testers
 *  PARAPHRASE — they never quote Sage's captured strings verbatim — so a pure substring test scores a
 *  genuine account near zero (measured: a perfect account matched 1 of its 5 real sources). Chosen from
 *  shadow data: at 0.6 a genuine paraphrased account recovers its true distinct-source count while a
 *  public-card parrot stays at ZERO (0.5 begins to admit generic card language). */
export const OBS_MATCH_OVERLAP = 0.6;

/**
 * Match a tester's account against the pinned key. An observation counts when its text is a verbatim
 * substring of the account OR ≥ {@link OBS_MATCH_OVERLAP} of its content words appear in the account
 * (paraphrase tolerance). Returns DISTINCT sources matched (the bar's unit) + the matched entries. Both
 * branches are deterministic — identical (account, key) → identical result — so the match stays
 * auditable against the pinned digest; the structural parrot-zero exclusion (public strings removed at
 * distill) is untouched, so a card-copy still has nothing private to overlap with.
 */
export function verifyAgainstKey(account: string | null | undefined, key: PrivateKey): CorpusMatch {
  const acctN = normObs(account);
  const acct = ` ${acctN} `;
  const acctTokens = new Set(contentTokens(acctN));
  const matched: PrivateObservation[] = [];
  const sources = new Set<string>();
  for (const o of key.observations) {
    const ot = contentTokens(o.text);
    // P20.0 anti-guess: only SPECIFIC observations (≥3 content words) are matchable — protects even
    // legacy keys that were pinned before the distill-side filter, so common vocab can't be gamed.
    if (ot.length < OBS_MIN_CONTENT_WORDS) continue;
    let hit = acct.includes(o.text);
    if (!hit) {
      let shared = 0;
      for (const w of ot) if (acctTokens.has(w)) shared++;
      hit = shared / ot.length >= OBS_MATCH_OVERLAP;
    }
    if (hit) {
      matched.push(o);
      sources.add(o.source);
    }
  }
  return { distinctSources: sources.size, matchedCount: matched.length, matched };
}

/* ─────────────────────── the observation autopay BAR (deterministic-primary) ─────────────────────── */

/**
 * A judge contradiction claim — the account phrase and the pinned corpus line it supposedly contradicts.
 * A veto blocks a payout ONLY when BOTH are verbatim quotes ({@link validateContradictions}); that is
 * what makes the LLM's veto hallucination-inert.
 */
export interface ContradictionClaim {
  accountQuote: string;
  corpusQuote: string;
}

/** A checkable quote must carry real signal, not a single filler word. */
const MIN_QUOTE_CONTENT_WORDS = 2;

/**
 * Validate a judge's contradiction claims against the ACTUAL text — the hallucination-inert veto. A claim
 * can BLOCK only if it cites a verbatim quote PAIR: the account phrase is a literal (normalized)
 * substring of the account AND the corpus phrase a literal substring of some pinned observation. A
 * hallucinated contradiction cannot produce a checkable pair, so it can NEVER block — it is returned
 * `unverified` for the founder's log only. Deterministic; mirrors the frozen enforceQuotes discipline.
 */
export function validateContradictions(
  claims: ContradictionClaim[],
  account: string | null | undefined,
  key: PrivateKey,
): { validated: ContradictionClaim[]; unverified: ContradictionClaim[] } {
  const acct = normObs(account);
  const validated: ContradictionClaim[] = [];
  const unverified: ContradictionClaim[] = [];
  for (const c of claims) {
    const a = normObs(c?.accountQuote);
    const k = normObs(c?.corpusQuote);
    const aOk = contentTokens(a).length >= MIN_QUOTE_CONTENT_WORDS && acct.includes(a);
    const kOk = contentTokens(k).length >= MIN_QUOTE_CONTENT_WORDS && key.observations.some((o) => o.text.includes(k));
    if (aOk && kOk) validated.push(c);
    else unverified.push(c);
  }
  return { validated, unverified };
}

/** The signals the bar weighs. The corpus match + two structural preconditions are the gate; the judge's
 *  CONFIDENCE is logged but no longer gates (it wobbles at the provider level even at temp 0), and its
 *  contradiction counts only once VALIDATED as a verbatim pair (vetoFired). */
export interface ObservationSignals {
  /** distinct SOURCES the account matched in the pinned key (verifyAgainstKey). */
  distinctSources: number;
  /** distinct sources IN the pinned key — campaign eligibility (a thin answer key can't verify). */
  keyDistinctSources: number;
  /** a VALIDATED contradiction veto fired (verbatim account↔corpus pair). Only this blocks; a
   *  hallucinated/unverifiable contradiction never reaches here. */
  vetoFired: boolean;
  /** near-dup clear against every EARLIER submission (causal; a later arrival can't flip this). */
  nearDupClear: boolean;
  /** a HIGH-severity fraud signal on the brief (injection/spam; low/med freshness never blocks). */
  hasHighFraud: boolean;
}

export interface BarResult {
  pass: boolean;
  /** the conditions that FAILED — for the shadow log + an auditable proof receipt. */
  reasons: string[];
}

/**
 * The DETERMINISTIC-PRIMARY autopay bar (P16 Step 2b). PASS iff every arithmetic condition holds AND no
 * validated veto fired. The LLM confidence scalar was DELETED from the gate: at the provider level it
 * wobbled across identical inputs (0.85↔0.95 straddling a 0.90 line), so a genuine account's pay/hold
 * could flip on sampling noise. Confidence is still computed + logged on the receipt; it just can no
 * longer move money. This is the project's move a third time — presence-check gate, anchor gate, now the
 * pay gate: when a model's judgment proved unreliable, the decision goes into arithmetic and the model
 * is demoted to a role (a checkable veto) where its noise cannot move funds.
 */
export const OBS_BAR = {
  minDistinctMatches: 3, // ≥3 DISTINCT non-public corpus matches (different sources)
  minKeySources: 5, // campaign eligibility — the pinned key holds ≥5 distinct observations
} as const;

/** P20: total times an observation submission may be judged (revise-while-held). Attempt 1..3; after the
 *  third HOLD the submission is EXHAUSTED and flows to the founder's review — a genuine tester never hits
 *  a dead end without a coached chance to add the detail that clears them. */
export const OBS_MAX_ATTEMPTS = 3;

export function observationBar(s: ObservationSignals, cfg: typeof OBS_BAR = OBS_BAR): BarResult {
  const reasons: string[] = [];
  if (s.keyDistinctSources < cfg.minKeySources) reasons.push(`thin_corpus(${s.keyDistinctSources}<${cfg.minKeySources})`);
  if (s.distinctSources < cfg.minDistinctMatches) reasons.push(`few_matches(${s.distinctSources}<${cfg.minDistinctMatches})`);
  if (s.vetoFired) reasons.push("contradiction");
  if (!s.nearDupClear) reasons.push("near_dup");
  if (s.hasHighFraud) reasons.push("high_fraud");
  return { pass: reasons.length === 0, reasons };
}

/**
 * The LEGACY (pre-2b) bar — confidence ≥ 0.90 AND zero RAW (unvalidated) contradictions gated. Kept ONLY
 * to log the old-vs-new would-have decision side by side during shadow continuity, so the switch is
 * comparable on real rows before autopay is armed. NEVER used to move money.
 */
export const OBS_LEGACY_MIN_CONFIDENCE = 0.9;
export function legacyObservationBar(s: {
  distinctSources: number;
  keyDistinctSources: number;
  rawContradictions: number;
  obsConfidence: number;
  nearDupClear: boolean;
  hasHighFraud: boolean;
}): BarResult {
  const reasons: string[] = [];
  if (s.keyDistinctSources < OBS_BAR.minKeySources) reasons.push(`thin_corpus(${s.keyDistinctSources}<${OBS_BAR.minKeySources})`);
  if (s.distinctSources < OBS_BAR.minDistinctMatches) reasons.push(`few_matches(${s.distinctSources}<${OBS_BAR.minDistinctMatches})`);
  if (s.rawContradictions > 0) reasons.push(`contradiction(${s.rawContradictions})`);
  if (s.obsConfidence < OBS_LEGACY_MIN_CONFIDENCE) reasons.push(`low_confidence(${s.obsConfidence.toFixed(2)}<${OBS_LEGACY_MIN_CONFIDENCE})`);
  if (!s.nearDupClear) reasons.push("near_dup");
  if (s.hasHighFraud) reasons.push("high_fraud");
  return { pass: reasons.length === 0, reasons };
}
