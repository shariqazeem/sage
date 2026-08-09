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
// 600 / 36k (were 400 / 24k): page excerpts grew from 900 to 4000 chars, and the distiller admits
// pages BEFORE states and vision — at the old caps a text-rich product filled the key with page
// prose and crowded out exactly the state/vision phrases that prove a tester actually DID the work.
// More headroom keeps both; the per-observation floors (≥2 content words, spread collapse, parrot
// exclusion) are unchanged, so nothing here loosens what counts as a match.
const MAX_OBS = 600; // size-cap the stored key
const MAX_KEY_CHARS = 36_000; // hard char budget on the serialized key
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

/** Normalize for matching: lowercased, punctuation→space, whitespace-collapsed.
 *  UNICODE-AWARE: `\w` is ASCII-only, so the old pattern replaced every non-Latin letter with a
 *  space — a genuine account written in Urdu/Arabic/Hindi/Chinese normalized to NOTHING, scored 0
 *  content words, never even reached the LLM judge, and held. Letters and digits in ANY script now
 *  survive normalization; English corpora are unaffected (ASCII letters normalize identically). */
export function normObs(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
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
      // the page's rendered text (static crawls carry it now) — each page becomes a REAL source of
      // firsthand observations, so a bot-walled product read in static mode still pins a key rich
      // enough to verify testers against (title+h1+ctas alone rarely cleared minKeySources).
      add(s, p.visibleTextExcerpt);
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
    /**
     * DOCUMENTATION SAGE READ — the only knowledge it has of the territory behind a wall, and
     * therefore the only key that can ever verify a gated mission.
     *
     * Without these sources, a tester who genuinely creates an account and describes the real
     * console can never match anything: Sage has no states from behind the wall, the account of
     * lived experience scores zero, and the mission the founder most wanted holds forever. That is
     * the exact inversion of the product's promise. With them, the words the product uses for its
     * own gated screens — step names, button labels, the quickstart's phrasing — become matchable,
     * which is what the founder asked for in so many words: "verify the evidence based on its
     * learning of browsing and product learning, not whether it browsed that part".
     *
     * The honest trade, stated rather than hidden: docs are public, so a determined reader could
     * mine them without touching the product. That is why doc observations carry their own `doc:`
     * source prefix — the judge and the bar can see which kind of knowledge a match came from —
     * and why the LLM coherence check (does this read as a lived account, in order, with friction?)
     * still sits on top of every deterministic match. The alternative — never auto-paying gated
     * work — was overruled by the founder explicitly.
     */
    (ft.docs ?? []).forEach((d, i) => {
      const s = `doc:${i}`;
      add(s, d.title);
      add(s, d.excerpt);
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
export function contentTokens(s: string): string[] {
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


/* ───────────────────── LANGUAGE-INDEPENDENT ANCHOR (phrase evidence) ───────────────────── */

/** Adjacent pairs of CONTENT words — stopwords are already dropped by `contentTokens`, so
 *  "people carrying something heavy" yields "people carrying", "carrying something", "something heavy"
 *  and never "to the". Reuses the same normaliser as every other matcher here. */
function contentBigrams(s: string | null | undefined): Set<string> {
  const t = contentTokens(normObs(s ?? ""));
  const out = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++) out.add(`${t[i]} ${t[i + 1]}`);
  return out;
}

/**
 * PHRASES FROM INSIDE THE PRODUCT that a tester reproduced — the anchor that survives being written
 * in the tester's own words, or in another language entirely.
 *
 * `verifyAgainstKey` needs most of an observation's vocabulary to overlap, so it scores a genuine
 * paraphrase near zero and a genuine account in another language at exactly zero. That is the wrong
 * answer for the person this product exists to pay: someone who really used the product and described
 * it honestly, in their own voice.
 *
 * A two-word phrase is the smallest unit that carries real information. MEASURED against the live
 * yara.garden corpus (70 non-public content bigrams) on real submissions:
 *
 *   genuine, English, previously paid ........ 2   ("together what", "loading screen")
 *   genuine, rewritten in another language ... 2   ("something heavy", "loading screen")
 *   genuine but TERSE ........................ 5   ("step inside", "people carrying", …)
 *   fluent fabrication, never visited ........ 0
 *   parrot of the public mission card ........ 0
 *
 * The terse account — historically the dominant genuine-hold class — scores HIGHEST, because brevity
 * costs vocabulary overlap but not specificity. Single tokens were tried first and are NOT usable: the
 * same fabrication scored 4 on generic words that happen to sit in the corpus ("felt", "interface",
 * "character"), against 6-8 for genuine. Pairs separate cleanly where single words do not.
 *
 * Public phrases are subtracted first, so copying the mission card can never anchor anything.
 * Deterministic and model-free.
 */
export function phraseAnchors(
  account: string | null | undefined,
  key: PrivateKey,
  publicStrings: readonly string[] = [],
): string[] {
  const pub = contentBigrams(publicStrings.join(" • "));
  const corpus = new Set<string>();
  for (const o of key.observations) {
    for (const g of contentBigrams(o.text)) if (!pub.has(g)) corpus.add(g);
  }
  if (corpus.size === 0) return [];
  const acct = contentBigrams(account);
  return [...corpus].filter((g) => acct.has(g));
}

/* ─────────────────────── CRITERION-LEVEL proof (the contract, not a headcount) ─────────────────── */

/**
 * What proves ONE criterion — the criterion's own slice of the private key.
 *
 * The flat bar asks "did this account mention three hidden things?", which is a proxy, and a loose one
 * in both directions. It pays an account that named three details from the entry screen for a mission
 * whose criterion is about the conversation, and it holds a concise tester who evidenced every
 * criterion but only reached two matches. Sage already knows which observations back which criterion —
 * the compiler derives exactly that when it builds the mission — so the gate can ask the real question:
 * WAS EACH CRITERION PROVEN?
 *
 * `keySources` are private-key source ids (`state:<i>` / `page:<i>`), never text: this record is
 * persisted with the campaign and must leak nothing a tester could read back as an answer.
 */
export interface CriterionEvidenceV1 {
  criterionIndex: number;
  /** the key sources whose observations evidence this criterion. Empty ⇒ unprovable from the key. */
  keySources: string[];
}

export interface CriterionVerdict {
  criterionIndex: number;
  proven: boolean;
  /** distinct sources matched WITHIN this criterion's own slice. */
  matchedSources: number;
}

export interface CriteriaProof {
  verdicts: CriterionVerdict[];
  /** every criterion that has a slice was proven. */
  allProven: boolean;
  /** criteria the key cannot prove at all (no sources) — a mission-design gap, not a tester failure. */
  unprovableCriteria: number[];
  /** indexes the tester has not yet evidenced — what the coaching message names. */
  missingCriteria: number[];
}

/**
 * Prove each criterion against its OWN slice of the pinned key.
 *
 * A criterion counts as proven when the account matches at least one observation from the sources that
 * back it. Matching reuses {@link verifyAgainstKey} verbatim, so every anti-guess rule already in force
 * — the ≥3-content-word floor, the fuzzy-overlap threshold, structural parrot exclusion — applies
 * unchanged inside each slice. A criterion with no slice is reported as UNPROVABLE rather than proven:
 * the gate must never read "we have no way to check this" as "this passed".
 */
export function proveCriteria(
  account: string | null | undefined,
  key: PrivateKey,
  evidence: readonly CriterionEvidenceV1[],
  /** sources already credited by a VALIDATED corroboration — the same unit the bar counts, so a
   *  genuine paraphrase the judge bridged proves its criterion exactly as a token match would. */
  creditedSources: ReadonlySet<string> = new Set(),
): CriteriaProof {
  const verdicts: CriterionVerdict[] = [];
  const unprovableCriteria: number[] = [];
  const missingCriteria: number[] = [];

  for (const ce of evidence) {
    const sources = new Set(ce.keySources);
    if (sources.size === 0) {
      unprovableCriteria.push(ce.criterionIndex);
      verdicts.push({ criterionIndex: ce.criterionIndex, proven: false, matchedSources: 0 });
      continue;
    }
    const slice: PrivateKey = {
      observations: key.observations.filter((o) => sources.has(o.source)),
      distinctSources: sources.size,
      digest: key.digest,
    };
    const m = verifyAgainstKey(account, slice);
    const bridged = [...sources].filter((s) => creditedSources.has(s));
    const matchedSources = new Set<string>([
      ...m.matched.map((o) => o.source),
      ...bridged,
    ]).size;
    const proven = matchedSources > 0;
    if (!proven) missingCriteria.push(ce.criterionIndex);
    verdicts.push({
      criterionIndex: ce.criterionIndex,
      proven,
      matchedSources,
    });
  }

  const provable = verdicts.filter(
    (v) => !unprovableCriteria.includes(v.criterionIndex),
  );
  return {
    verdicts,
    // "all proven" requires at least one provable criterion — an empty contract proves nothing.
    allProven: provable.length > 0 && provable.every((v) => v.proven),
    unprovableCriteria,
    missingCriteria,
  };
}

/**
 * UNIVERSAL CRITERION CONTRACTS — derive a criterion → key-source contract for a mission that has
 * none stored (legacy / model-authored missions; only compiler-authored ones persist a contract).
 *
 * Without a contract those missions are judged by the flat count alone: three details from ANY
 * screens pay, a concise account that answered exactly what the mission asked may hold, and the
 * per-criterion coaching ("Sage can't yet see evidence for: …") never fires. The mapping here is the
 * deterministic bridge: each criterion (+ its evidence requirement) is reduced to its distinctive
 * content tokens, and a key SOURCE backs the criterion when one of its private observations carries
 * such a token at a word start. The tester still has to match PRIVATE observations inside the slice
 * — this maps which screens prove what, it never weakens what counts as proof.
 *
 * Fail-safe by construction: a criterion with no distinctive token or no matching source gets an
 * EMPTY slice → reported UNPROVABLE (a design gap, never a tester failure, and never armable for the
 * criteria-complete pass, whose allProven requires ≥1 provable criterion). Deterministic given
 * (key, criteria), so verdict reuse stays sound. SERVER-SIDE ONLY — the mapping names key sources
 * and must never reach a tester-readable surface (the leak rule).
 */
// ≥4 so short ENTITY names still map ("Yara", "2048", "Uber") — a 4-char generic UI word is caught
// by the generic set instead, which is what actually separates signal from filler at this length.
const DERIVE_MIN_TOKEN_LEN = 4;
const DERIVE_GENERIC = new Set(
  ("page pages screen screens button buttons click clicks clicked open opens opened tester testers user users visitor visitors product website their there which where should would could describe report reports confirm confirms verify verified observe observed observation complete completed mission evidence account specific exactly about after before between during using appear appears appeared display displays displayed visible text texts words " +
    "site view links link icon icons form forms menu menus name names list lists item items step steps time back next data info main real full each also what when then than that this with from into onto over your").split(
    " ",
  ),
);
export function deriveCriterionEvidence(
  key: PrivateKey,
  criteria: readonly string[],
  evidenceRequirements: readonly string[] = [],
): CriterionEvidenceV1[] {
  const out: CriterionEvidenceV1[] = [];
  for (let i = 0; i < criteria.length; i++) {
    const text = normObs(`${criteria[i] ?? ""} ${evidenceRequirements[i] ?? ""}`);
    const tokens = contentTokens(text).filter(
      (t) => t.length >= DERIVE_MIN_TOKEN_LEN && !DERIVE_GENERIC.has(t),
    );
    const sources = new Set<string>();
    if (tokens.length > 0) {
      for (const o of key.observations) {
        if (sources.has(o.source)) continue;
        const hay = ` ${o.text} `;
        // word-START matching, so "dashboard" backs "dashboards" but "board" never backs "keyboard".
        if (tokens.some((t) => hay.includes(` ${t}`))) sources.add(o.source);
      }
    }
    out.push({ criterionIndex: i, keySources: [...sources] });
  }
  return out;
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
 * A real contradiction is a FOCUSED conflicting claim ("a blue square", "no signup, straight in") — never
 * a whole narrative. When the account-side quote is a paragraph-length span, the model is over-reaching:
 * it pairs a rich genuine narrative (extra onboarding detail Sage didn't capture) with one observation and
 * calls the whole thing a "contradiction". That FALSE veto wrongly denies an honest tester their pay. A
 * focused-claim cap makes a paragraph-length "contradiction" fall to `unverified` (logged, never blocks),
 * while every genuine short conflict still vetoes. Measured against the observed failure (a 12-content-word
 * onboarding span); a real contradiction quote is far shorter.
 */
const MAX_CONTRADICTION_ACCOUNT_WORDS = 10;

/**
 * Validate a judge's contradiction claims against the ACTUAL text — the hallucination-inert veto. A claim
 * can BLOCK only if it cites a FOCUSED verbatim quote PAIR: the account phrase is a literal (normalized)
 * substring of the account (and is a focused claim, ≤ {@link MAX_CONTRADICTION_ACCOUNT_WORDS} content
 * words, not a whole narrative) AND the corpus phrase a literal substring of some pinned observation. A
 * hallucinated OR paragraph-length contradiction cannot produce a checkable focused pair, so it can NEVER
 * block — it is returned `unverified` for the founder's log only. Deterministic; mirrors enforceQuotes.
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
    const aWords = contentTokens(a).length;
    const aOk = aWords >= MIN_QUOTE_CONTENT_WORDS && aWords <= MAX_CONTRADICTION_ACCOUNT_WORDS && acct.includes(a);
    const kOk = contentTokens(k).length >= MIN_QUOTE_CONTENT_WORDS && key.observations.some((o) => o.text.includes(k));
    if (aOk && kOk) validated.push(c);
    else unverified.push(c);
  }
  return { validated, unverified };
}

/**
 * A corroboration claim — an account phrase and the private corpus line it RE-DESCRIBES in different
 * words. The positive mirror of a {@link ContradictionClaim}: Sage's eyes narrate a screen in verbose
 * third-person prose ("a character named yara standing on a path speaking to the player") while a genuine
 * tester narrates the same moment first-person ("i talked to yara and she talked back") — no shared card
 * language, so the deterministic word-overlap matcher scores it ZERO though the work is real. The LLM
 * judge bridges that vocabulary gap by CITING a verbatim pair; the count still comes from arithmetic.
 */
export interface CorroborationClaim {
  accountQuote: string;
  corpusQuote: string;
}

/** The distinct content tokens of the PUBLIC card/plan strings — the words a parrot could copy off the
 *  board. Passed to {@link validateCorroborations} so a corroboration's lexical anchor must be a
 *  NON-public token: the model may bridge vocabulary, but can never anchor a "match" on public language. */
export function publicTokenSet(publicStrings: string[]): Set<string> {
  return new Set(contentTokens(normObs(publicStrings.join(" • "))));
}

/**
 * Validate a judge's corroboration claims against the ACTUAL text — the positive mirror of
 * {@link validateContradictions}, and the recall path for genuine work Sage saw but described in words a
 * tester would never reproduce verbatim. A corroboration COUNTS only when it cites a pair that is
 * verbatim, specific, and FIRST-HAND:
 *   · `accountQuote` is a literal (normalized) substring of the account, ≥2 content words;
 *   · `corpusQuote` is a literal substring of ONE pinned observation, ≥2 content words;
 *   · the accountQuote carries ≥1 content token that is NOT a public-card token — firsthand words the
 *     tester wrote that the card never showed. A PARROT phrase is pure card language (every token public)
 *     → rejected; a genuine paraphrase always has firsthand words. There is deliberately NO lexical
 *     requirement against the corpus: a TRUE semantic bridge ("she talked to me" ↔ "a character named
 *     yara … speaking to the player") shares only the product name or nothing, so demanding a shared
 *     non-public token would kill exactly the genuine case while letting a near-lexical GUESS through.
 * Parrot-zero stays STRUCTURAL (a card copy can never be the account side of a corroboration); the model
 * is trusted ONLY for the semantic link, which the verbatim pair + the ≥3-distinct-source bar +
 * injection/near-dup guards still bound. Each validated corroboration maps to the SOURCE of the (first)
 * observation it cites; the caller UNIONS these with the deterministic matches. Deterministic given input.
 */
export function validateCorroborations(
  claims: CorroborationClaim[],
  account: string | null | undefined,
  key: PrivateKey,
  publicTokens: Set<string> = new Set(),
): { validated: CorroborationClaim[]; sources: Set<string> } {
  const acct = normObs(account);
  const validated: CorroborationClaim[] = [];
  const sources = new Set<string>();
  for (const c of claims) {
    const a = normObs(c?.accountQuote);
    const k = normObs(c?.corpusQuote);
    const aTokens = contentTokens(a);
    const kTokens = contentTokens(k);
    if (aTokens.length < MIN_QUOTE_CONTENT_WORDS || kTokens.length < MIN_QUOTE_CONTENT_WORDS) continue;
    if (!acct.includes(a)) continue; // the account phrase must be real (verbatim substring)
    const obs = key.observations.find((o) => o.text.includes(k)); // the corpus phrase must be real
    if (!obs) continue;
    // FIRST-HAND floor: the account phrase must carry ≥1 NON-card token — firsthand words the tester
    // wrote that aren't on the card ("clicked", "went", "move"). A parrot phrase is pure card language
    // (every token public) → rejected. There is NO lexical requirement AGAINST the corpus: a TRUE
    // semantic bridge shares only the product name or nothing ("she talked to me" ↔ "…speaking to the
    // player"), so demanding shared non-public words would kill the genuine case while letting a
    // near-lexical GUESS pass. The model is trusted ONLY for the semantic link; the verbatim pair, the
    // ≥3-distinct-source bar, and injection/near-dup still bound it.
    if (!aTokens.some((w) => !publicTokens.has(w))) continue;
    validated.push(c);
    sources.add(obs.source); // one corroboration → at most one distinct-source credit (anti-padding)
  }
  return { validated, sources };
}

/** The signals the bar weighs. The corpus match + two structural preconditions are the gate; the judge's
 *  CONFIDENCE is logged but no longer gates (it wobbles at the provider level even at temp 0), and its
 *  contradiction counts only once VALIDATED as a verbatim pair (vetoFired). */
export interface ObservationSignals {
  /** distinct SOURCES the account matched in the pinned key (verifyAgainstKey). */
  distinctSources: number;
  /**
   * Distinct sources the DETERMINISTIC token-matcher found on its own, before any LLM corroboration
   * was unioned in. Optional: a caller that does not supply it keeps the pre-anchor behaviour exactly.
   *
   * This exists because `distinctSources` cannot distinguish "the tester wrote things only a real
   * visitor could write" from "the model was willing to bridge three vague phrases". Both arrive as 3.
   */
  deterministicSources?: number;
  /**
   * Two-word phrases from INSIDE the product that this account reproduced, with public card phrases
   * subtracted. This is the anchor that survives a tester writing in their own words or another
   * language — where token-overlap matching scores zero and would hold a genuine person.
   */
  phraseAnchors?: number;
  /** distinct sources IN the pinned key — campaign eligibility (a thin answer key can't verify). */
  keyDistinctSources: number;
  /** a VALIDATED contradiction veto fired (verbatim account↔corpus pair). Only this blocks; a
   *  hallucinated/unverifiable contradiction never reaches here. */
  vetoFired: boolean;
  /** near-dup clear against every EARLIER submission (causal; a later arrival can't flip this). */
  nearDupClear: boolean;
  /** a HIGH-severity fraud signal on the brief (injection/spam; low/med freshness never blocks). */
  hasHighFraud: boolean;
  /**
   * Criteria the mission's own contract says are NOT yet evidenced. Absent/empty on a mission with no
   * contract (legacy, model-authored) ⇒ the flat bar alone, exactly as before. Present ⇒ an ADDITIONAL
   * requirement: three details from the wrong screen can no longer buy a payout for work the mission
   * actually asked for.
   */
  unprovenCriteria?: number[];
  /**
   * TRUE when the criterion contract was DERIVED from the key rather than authored by the compiler.
   *
   * A derived contract is a lexical GUESS about which screens prove which criterion, and a guess must
   * never block a payout. Measured on the live yara mission: the derivation maps criteria by shared
   * tokens, so `state:28`/`state:29` — which hold Yara's actual dialogue, the most authentic evidence
   * in the whole corpus — back NEITHER criterion, because "what brings you here" shares no words with
   * "the user experiences the outcome of interacting with yara". A tester quoting exactly that would
   * have been held on `criteria_unproven` for giving the best possible evidence. That vocabulary gap
   * is precisely what the LLM corroboration path exists to bridge and a token match cannot.
   *
   * So a derived contract HELPS and never HINDERS: it still arms the criteria-complete pass and still
   * drives per-criterion coaching, but an unproven criterion under it is not a blocking reason. A
   * COMPILER-authored contract is authoritative and blocks exactly as before.
   */
  criteriaAdvisory?: boolean;
  /**
   * TRUE only when the mission carries a criterion contract AND every PROVABLE criterion was evidenced
   * (proveCriteria.allProven — never inferred from an empty missing-list, which an all-unprovable
   * contract also produces). This is what arms the criteria-complete pass below.
   */
  criteriaAllProven?: boolean;
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
  /**
   * THE ANCHOR FLOOR — at least ONE distinct source the deterministic matcher found by itself.
   *
   * `validateCorroborations` is real code, not model judgment: both quotes must be verbatim, the
   * account side needs a non-public token, and one claim earns at most one source. That is a sound
   * RECALL path, and it stays. But the model chooses the corpus quote — it can see the corpus — so
   * the only thing a corroboration truly binds is that the ACCOUNT contains some firsthand phrase the
   * model was willing to link. Three such links and nothing else, and an autonomous payout rests
   * entirely on the model's semantic judgment. That contradicts this module's own rule, stated a few
   * lines below: the model is trusted ONLY for the semantic link.
   *
   * So: the model may bridge, expand and rescue — it may not be the SOLE basis for moving money.
   * Falling short HOLDS for the founder (it does not reject), so the recall path still gets paid, just
   * with a human glance first.
   *
   * Measured on every shadow row to date (5): the two well-anchored payouts scored 3 and 4 here and
   * are untouched; both holds scored 0 and 1 and stay held; exactly one row changes — the payout that
   * cleared on 0 deterministic + 3 model-bridged sources.
   */
  minDeterministicSources: 1,
  /**
   * ONE reproduced product phrase is enough. The measured margin is not close — every genuine
   * account scored >=2 and every fabrication exactly 0 — so a higher floor would buy no precision
   * and would start holding real people for being brief.
   */
  minPhraseAnchors: 1,
} as const;

/**
 * THE CRITERIA-COMPLETE PASS — the armed form of the relaxation that lived in shadow as
 * `wouldPassOnCriteriaAlone`. The flat ≥3-distinct bar was a proxy for "did real work", and it held
 * the exact tester it exists to pay: a concise, honest account that evidenced EVERY criterion of the
 * mission's own contract but touched only two of Sage's screens. Measured on real submissions, that
 * was the dominant genuine-hold class.
 *
 * The pass is DELIBERATELY narrow — all of these must hold at once:
 *   · the mission carries a criterion contract (compiler-authored; legacy missions keep the flat bar),
 *   · every PROVABLE criterion was evidenced (proveCriteria.allProven — same anti-guess matcher,
 *     same structural parrot-zero, same validated-corroboration unit as the flat bar),
 *   · the account still matched ≥2 DISTINCT private sources (never a single lucky phrase),
 *   · nothing else objects — no veto, no near-dup, no fraud, corpus eligible. The ONLY objection the
 *     pass may override is the flat count itself.
 * A parrot still scores zero (public strings are structurally absent from the key); a guesser still
 * fails the ≥2-content-word floor per observation; and every criterion had to be proven from its OWN
 * slice of the key, which is strictly harder to fake than three matches anywhere.
 */
export const CRITERIA_COMPLETE_MIN_MATCHES = 2;

/**
 * PHRASES FROM INSIDE THE PRODUCT ARE EVIDENCE ON THEIR OWN, above this many.
 *
 * The flat bar counts DISTINCT SOURCES, and a source is roughly a screen. A tester who explores one
 * screen thoroughly can therefore write an unmistakably genuine account and still count as one
 * source — at which point whether they get paid comes down to the LLM's corroboration bridge, which
 * is the one non-deterministic part of the whole judgment.
 *
 * Measured: the identical genuine account, naming seven real product phrases, was run eight times
 * against the live judge. The deterministic signal was the same every time (1 source, 7 anchors).
 * The model returned 8 corroborations twice and ZERO the other six times, so the account passed
 * 2 of 8. A right answer being paid on a coin flip is the single worst thing this system can do,
 * and it was not visible from any single run.
 *
 * Seven two-word phrases from inside a product cannot be written by someone who never opened it —
 * that is the same premise the anchor floor already rests on, and unlike a corroboration it involves
 * no model judgment at all. So above this count the phrases carry the "enough evidence" question by
 * themselves, and the bar stops depending on the weather.
 *
 * Deliberately conservative. Genuine accounts measured at 4-7 anchors; every fabrication, parrot and
 * fluent-but-empty write-up measured at exactly 0. And like the criteria-complete pass, this may
 * override the flat count and NOTHING else: a veto, a near-dup, a fraud signal, a thin corpus or an
 * unproven criterion all still hold exactly as before.
 */
export const PHRASE_SUFFICIENT_ANCHORS = 4;

/**
 * The BAR POLICY under which a stored verdict was computed. A verdict is only reusable under the SAME
 * policy: when the bar itself changes (e.g. arming the criteria-complete pass), every stored verdict
 * is stale by definition — a submission held under the old policy might pass under the new one, and
 * reusing the old answer would freeze it forever. Bump this on ANY change to observationBar/OBS_BAR.
 */
export const OBS_BAR_POLICY_VERSION = "obs-bar-v5-phrase-anchor";

/**
 * A STORED VERDICT STILL APPLIES when everything the verdict depends on is provably unchanged: the
 * tester's attempt (a revision increments it), the pinned corpus digest, AND the bar policy that
 * computed it. Nothing else the judge reads can move between sweep ticks, so re-running the LLM would
 * return the identical answer and be billed for it — 3,766 such calls cost $8.65 in one week, 81% of
 * all LLM spend, because submissions frozen by a covenant defect were re-judged 288 times a day forever.
 *
 * Pure and conservative: anything missing, mismatched, or malformed returns false and re-judges.
 * (A legacy row without a stored barPolicy re-judges ONCE under the current policy, then reuses.)
 */
export function verdictStillApplies(
  prior:
    | { barPass?: unknown; corpusDigest?: unknown; attempt?: unknown; barPolicy?: unknown }
    | null
    | undefined,
  attempt: number,
  corpusDigest: string,
): boolean {
  if (!prior) return false;
  if (typeof prior.barPass !== "boolean") return false;
  if (typeof prior.attempt !== "number" || prior.attempt !== attempt) return false;
  if (typeof prior.corpusDigest !== "string" || prior.corpusDigest !== corpusDigest) return false;
  if (prior.barPolicy !== OBS_BAR_POLICY_VERSION) return false;
  return true;
}

/** P20: total times an observation submission may be judged (revise-while-held). Attempt 1..3; after the
 *  third HOLD the submission is EXHAUSTED and flows to the founder's review — a genuine tester never hits
 *  a dead end without a coached chance to add the detail that clears them. */
export const OBS_MAX_ATTEMPTS = 3;

export function observationBar(s: ObservationSignals, cfg: typeof OBS_BAR = OBS_BAR): BarResult {
  const reasons: string[] = [];
  if (s.keyDistinctSources < cfg.minKeySources) reasons.push(`thin_corpus(${s.keyDistinctSources}<${cfg.minKeySources})`);
  if (s.distinctSources < cfg.minDistinctMatches) reasons.push(`few_matches(${s.distinctSources}<${cfg.minDistinctMatches})`);
  // The anchor floor. Only applied when the caller actually supplies the split — an older caller that
  // does not know its deterministic count keeps the previous behaviour rather than being held by default.
  // THE ANCHOR FLOOR — satisfied by EITHER a deterministic observation match OR a phrase the tester
  // could only have read inside the product. Requiring the former alone would hold the genuine
  // paraphrasing or non-English tester, which is the exact person this is meant to pay.
  if (typeof s.deterministicSources === "number") {
    const anchored =
      s.deterministicSources >= cfg.minDeterministicSources ||
      (s.phraseAnchors ?? 0) >= cfg.minPhraseAnchors;
    if (!anchored) {
      // COUNTS AND COMPARATORS ONLY. These reasons are shown publicly, and the enforced shape
      // (`name(numbers)`) is what guarantees a reason can never carry corpus text back to a tester.
      const evidence = s.deterministicSources + (s.phraseAnchors ?? 0);
      reasons.push(`no_product_anchor(${evidence}<1)`);
    }
  }
  if (s.vetoFired) reasons.push("contradiction");
  if (!s.nearDupClear) reasons.push("near_dup");
  if (s.hasHighFraud) reasons.push("high_fraud");
  // The mission's own contract, when it has one. Strictly ADDITIVE: detail from the wrong screen can
  // never buy a payout for work the mission actually asked for.
  if (s.unprovenCriteria && s.unprovenCriteria.length > 0 && !s.criteriaAdvisory) {
    reasons.push(`criteria_unproven(${s.unprovenCriteria.join(",")})`);
  }
  // THE CRITERIA-COMPLETE PASS (armed from shadow — see CRITERIA_COMPLETE_MIN_MATCHES). When every
  // provable criterion of the mission's own contract is evidenced and the ONLY remaining objection is
  // the flat count — with still ≥2 distinct private-source matches — the account has proven the work
  // the mission asked for, and holding it punishes concision. Any other objection (veto, near-dup,
  // fraud, thin corpus, an unproven criterion) keeps the hold exactly as before.
  // NOTE the `few_matches`-only condition below is what keeps the anchor floor un-overridable: an
  // account with no deterministic anchor carries `no_deterministic_anchor`, which is not `few_matches`,
  // so the pass cannot fire. Proving every criterion through model bridges alone is exactly the case
  // the floor exists for.
  if (
    reasons.length > 0 &&
    s.criteriaAllProven === true &&
    s.distinctSources >= CRITERIA_COMPLETE_MIN_MATCHES &&
    reasons.every((r) => r.startsWith("few_matches"))
  ) {
    return { pass: true, reasons: [] };
  }
  // THE PHRASE-SUFFICIENCY PASS — see PHRASE_SUFFICIENT_ANCHORS. Strong deterministic evidence
  // should not need the model's agreement to be believed. Same override scope as the pass above: the
  // flat count only, and only when the account also carries a real deterministic anchor.
  if (
    reasons.length > 0 &&
    (s.phraseAnchors ?? 0) >= PHRASE_SUFFICIENT_ANCHORS &&
    (s.deterministicSources ?? 0) >= cfg.minDeterministicSources &&
    reasons.every((r) => r.startsWith("few_matches"))
  ) {
    return { pass: true, reasons: [] };
  }
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
