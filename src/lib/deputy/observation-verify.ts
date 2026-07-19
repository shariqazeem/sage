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
      const t = normObs(line);
      if (t.length < MIN_OBS_LEN) continue;
      // STRUCTURAL parrot-exclusion: drop anything readable off a public card.
      if (publicBlob.includes(` ${t} `) || publicBlob.includes(t)) continue;
      raw.push({ source, text: t });
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
    // Vision frames fold into their STATE so a screen + its screenshot are one source.
    (ft.visionObservations ?? []).forEach((v) => {
      const s = `state:${v.stateIndex}`;
      add(s, v.sceneDescription);
      (v.visibleText ?? []).forEach((t) => add(s, t));
      (v.uiElements ?? []).forEach((e) => add(s, e.label));
      (v.productTypeSignals ?? []).forEach((t) => add(s, t));
      (v.audienceSignals ?? []).forEach((t) => add(s, t));
    });
  }

  // Dedupe by (source, text); size + char cap.
  const seen = new Set<string>();
  const observations: PrivateObservation[] = [];
  let chars = 0;
  for (const o of raw) {
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
    let hit = acct.includes(o.text);
    if (!hit) {
      const ot = contentTokens(o.text);
      if (ot.length >= 2) {
        let shared = 0;
        for (const w of ot) if (acctTokens.has(w)) shared++;
        hit = shared / ot.length >= OBS_MATCH_OVERLAP;
      }
    }
    if (hit) {
      matched.push(o);
      sources.add(o.source);
    }
  }
  return { distinctSources: sources.size, matchedCount: matched.length, matched };
}

/* ───────────────────────── the observation autopay BAR (structure fixed) ───────────────────────── */

/** The signals the bar weighs — the deterministic corpus match + the judge's + the existing gate's. */
export interface ObservationSignals {
  /** distinct SOURCES the account matched in the pinned key (verifyAgainstKey). */
  distinctSources: number;
  /** distinct sources IN the pinned key — campaign eligibility (a thin answer key can't verify). */
  keyDistinctSources: number;
  /** contradictions the observation judge found against the corpus (any > 0 kills autopay). */
  contradictions: number;
  /** observation-mode confidence (0..1) — a stricter lane than the url path. */
  obsConfidence: number;
  /** near-dup clear against every prior submission (the P18 detector, restated as a precondition). */
  nearDupClear: boolean;
  /** a HIGH-severity fraud signal on the brief (existing rule; low/med freshness never blocks). */
  hasHighFraud: boolean;
}

export interface BarResult {
  pass: boolean;
  /** the conditions that FAILED — for the shadow log + an auditable proof receipt. */
  reasons: string[];
}

/**
 * The autopay bar STRUCTURE is fixed; the N-values are calibrated in shadow before the flag is armed.
 * Autopay an observation submission only if ALL six hold. A contradiction or a thin corpus kills it
 * outright, whatever else scores — the corpus match is the real bar, freshness only logs.
 */
export const OBS_BAR = {
  minDistinctMatches: 3, // ≥3 DISTINCT non-public corpus matches (different sources)
  minKeySources: 5, // campaign eligibility — the pinned key holds ≥5 distinct observations
  minConfidence: 0.9, // stricter than the 0.85 url lane
} as const;

export function observationBar(s: ObservationSignals, cfg: typeof OBS_BAR = OBS_BAR): BarResult {
  const reasons: string[] = [];
  if (s.keyDistinctSources < cfg.minKeySources) reasons.push(`thin_corpus(${s.keyDistinctSources}<${cfg.minKeySources})`);
  if (s.distinctSources < cfg.minDistinctMatches) reasons.push(`few_matches(${s.distinctSources}<${cfg.minDistinctMatches})`);
  if (s.contradictions > 0) reasons.push(`contradiction(${s.contradictions})`);
  if (s.obsConfidence < cfg.minConfidence) reasons.push(`low_confidence(${s.obsConfidence.toFixed(2)}<${cfg.minConfidence})`);
  if (!s.nearDupClear) reasons.push("near_dup");
  if (s.hasHighFraud) reasons.push("high_fraud");
  return { pass: reasons.length === 0, reasons };
}
