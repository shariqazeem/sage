import "server-only";

import { createHash } from "node:crypto";
import type { ObservationSetV1, ActionTransitionV1 } from "@/lib/launch/observed-facts";

/**
 * Observation Judge V2 — SHADOW ONLY (Priority 5).
 *
 * The legacy observation lane corroborates a tester's account against a private corpus of observed strings.
 * V2 adds action→outcome GROUNDING using the Eyes-V2 seen facts + action transitions: a genuine account
 * doesn't just echo a control name, it describes performing a mission-relevant ACTION and reaching a
 * SPECIFIC observed STATE — the two coherently paired. This defeats a class the string-corpus tolerates:
 * generic action language ("I clicked start") with no state-specific corroboration.
 *
 * It NEVER changes the money outcome. `OBS_JUDGE_V2_MODE=off|shadow` (default off); in shadow it runs, is
 * compared against the legacy result, and journals COUNTS + reason codes + digests only — never a matched
 * string (the corpus is a private answer key). Deterministic (no LLM); the frozen LLM judge is untouched.
 */

export type ObsJudgeV2Mode = "off" | "shadow";

export function obsJudgeV2Mode(): ObsJudgeV2Mode {
  return process.env.OBS_JUDGE_V2_MODE?.trim().toLowerCase() === "shadow" ? "shadow" : "off";
}

const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** words too generic to count as a "specific" observed state text. */
const GENERIC = new Set(["start", "play", "begin", "click", "press", "the", "a", "an", "page", "button", "done", "next", "continue", "ok", "yes", "go", "home", "menu", "loading", "welcome", "submit"]);

export interface ObsJudgeV2Result {
  version: "obs-judge-v2";
  ran: boolean;
  /** the shadow verdict — NEVER used for money; compared to legacy for disagreement analysis. */
  pass: boolean;
  reasonCodes: string[];
  actionMatches: number;
  stateSpecificMatches: number;
  coherentPairs: number;
  distinctSourceFacts: number;
  contradictions: number;
  inputDigest: string;
  corpusDigest: string;
}

/** Bar for the shadow pass — an action, a specific observed state, a coherent action→outcome pair, and no
 *  contradiction. Distinct sources reported; the action/state/coherence trio is the discriminator. */
const V2_MIN_DISTINCT = 1;

function actionPhrases(transitions: ActionTransitionV1[]): { verb: string; name?: string }[] {
  return transitions
    .filter((t) => t.verb === "click" || t.verb === "press" || t.verb === "scroll")
    .map((t) => ({ verb: t.verb, name: t.locator.accessibleName ?? t.locator.raw }));
}

/**
 * Judge an account against the observation set. Pure + deterministic. `corpusDigest` comes from the set;
 * a leak-safe result carries counts + reason codes only (see {@link publicV2View}).
 */
export function judgeObservationV2(account: string | null | undefined, set: ObservationSetV1 | null | undefined): ObsJudgeV2Result {
  const inputDigest = sha16(norm(account ?? ""));
  if (!set || set.facts.length === 0 || !account) {
    return { version: "obs-judge-v2", ran: false, pass: false, reasonCodes: ["no_corpus_or_account"], actionMatches: 0, stateSpecificMatches: 0, coherentPairs: 0, distinctSourceFacts: 0, contradictions: 0, inputDigest, corpusDigest: set?.digest ?? "none" };
  }
  const a = norm(account);
  const seen = set.facts.filter((f) => f.grounding === "seen" && f.decisive);
  // SPECIFIC state tokens = distinctive words (≥5 chars, non-generic) + short element names from the seen
  // corpus. Token-level (not whole-excerpt) so a genuine PARAPHRASE ("reached the garden world") still
  // corroborates, while a generic account (no corpus words) does not.
  const stateTexts = new Map<string, string>(); // normalized token → owning fact id
  const addToken = (tok: string, factId: string) => { const n = norm(tok); if (n.length >= 5 && !GENERIC.has(n)) stateTexts.set(n, factId); };
  for (const f of seen) {
    if (f.elementName && norm(f.elementName).length >= 3 && !GENERIC.has(norm(f.elementName))) stateTexts.set(norm(f.elementName), f.id);
    for (const x of f.visibleTexts) for (const w of norm(x).split(/[^a-z0-9]+/)) addToken(w, f.id);
  }
  const actions = actionPhrases(set.transitions);
  /** distinctive corpus words present in a text (for the coherent-outcome check). */
  const outcomeWords = (texts: string[]) => texts.flatMap((t) => norm(t).split(/[^a-z0-9]+/)).filter((w) => w.length >= 5 && !GENERIC.has(w));

  // action present: the account mentions a real action verb + (if any) its control name.
  const actionMatches = actions.filter((ap) => {
    const verbHit = a.includes(ap.verb) || (ap.verb === "click" && /tap|open|select/.test(a)) || (ap.verb === "press" && /press|hit|key/.test(a));
    const nameHit = !ap.name || a.includes(norm(ap.name));
    return verbHit && nameHit;
  }).length;

  // state-specific: distinct seen facts whose distinctive token appears in the account (word-boundary
  // matched, so "garden" doesn't match "gardener"; multi-word element names matched as a phrase).
  const accountWords = new Set(a.split(/[^a-z0-9]+/).filter(Boolean));
  const matchedFactIds = new Set<string>();
  for (const [text, factId] of stateTexts) {
    const hit = text.includes(" ") ? a.includes(text) : accountWords.has(text);
    if (hit) matchedFactIds.add(factId);
  }
  const stateSpecificMatches = matchedFactIds.size;

  // coherent action→outcome: a transition whose action AND at least one distinctive after-state word both
  // appear — a genuine account PAIRS what it did with what changed.
  const coherentPairs = set.transitions.filter((t) => {
    const name = t.locator.accessibleName ?? t.locator.raw;
    const actionHit = (a.includes(t.verb) || (t.verb === "click" && /tap|open/.test(a))) && (!name || a.includes(norm(name)));
    const outcomeHit = outcomeWords(t.addedTexts).some((w) => accountWords.has(w));
    return actionHit && outcomeHit;
  }).length;

  // contradiction (best-effort): the account claims to have seen a control by an EXACT quoted name that is
  // not any seen element name — a hallucinated UI control.
  const quoted = [...a.matchAll(/["'“”]([^"'“”]{3,40})["'“”]/g)].map((m) => norm(m[1]));
  const seenNames = new Set(seen.map((f) => (f.elementName ? norm(f.elementName) : "")).filter(Boolean));
  const contradictions = quoted.filter((q) => !seenNames.has(q) && !stateTexts.has(q) && /button|control|panel|tab|menu|option|toggle/.test(q)).length;

  const hasTransitions = set.transitions.length > 0;
  const reasonCodes: string[] = [];
  if (actionMatches > 0) reasonCodes.push("action_present"); else reasonCodes.push("no_action");
  if (stateSpecificMatches > 0) reasonCodes.push("state_specific"); else reasonCodes.push("generic_no_state");
  if (coherentPairs > 0) reasonCodes.push("coherent_action_outcome"); else reasonCodes.push("no_coherent_pair");
  if (contradictions > 0) reasonCodes.push("contradiction");
  if (!hasTransitions) reasonCodes.push("no_transitions"); // reconstructed-from-corpus set (no action lane)

  // With transitions, the full action→outcome bar; without (a corpus reconstruction that carries only
  // seen state/page texts), the state-specific + no-contradiction bar — which still discriminates a
  // generic account ("I clicked start") from a genuine one, since the discriminator is state-specificity.
  const pass = stateSpecificMatches >= V2_MIN_DISTINCT && contradictions === 0 && (!hasTransitions || (actionMatches > 0 && coherentPairs > 0));
  return {
    version: "obs-judge-v2", ran: true, pass, reasonCodes,
    actionMatches, stateSpecificMatches, coherentPairs, distinctSourceFacts: matchedFactIds.size, contradictions,
    inputDigest, corpusDigest: set.digest,
  };
}

/** Leak-safe projection for journaling — counts + reason codes + digests only, never a matched string. */
export function publicV2View(r: ObsJudgeV2Result): Omit<ObsJudgeV2Result, "version"> & { version: string } {
  return r; // already text-free (counts + reason codes + digests only)
}

export type DisagreementCategory =
  | "agree_pass"
  | "agree_fail"
  | "v2_stricter" // legacy passed, V2 failed (V2 wants action→outcome grounding)
  | "v2_looser"; // legacy failed, V2 passed

/** Compare the V2 shadow verdict to the legacy money verdict — a disagreement CATEGORY, for journaling. */
export function compareV2ToLegacy(v2Pass: boolean, legacyPass: boolean): DisagreementCategory {
  if (v2Pass && legacyPass) return "agree_pass";
  if (!v2Pass && !legacyPass) return "agree_fail";
  return legacyPass && !v2Pass ? "v2_stricter" : "v2_looser";
}

/**
 * Reconstruct a minimal observation set from the EXISTING private corpus (the {source,text}[] the legacy
 * observation judge already carries) — READ-ONLY, no migration, no change to the legacy corpus. It yields
 * `seen` state/page facts (no transitions; the flat corpus has none), so V2 runs in its state-specific
 * mode. `source` is "state:<i>"/"page:<i>"; a distinct source is a distinct stateId, keeping cross-state
 * facts distinguishable.
 */
export function reconstructSetFromCorpus(observations: { source: string; text: string }[] | null | undefined): ObservationSetV1 {
  const facts = (observations ?? []).filter((o) => o.text && o.text.trim()).map((o) => {
    const digest = sha16(`${o.source}|${norm(o.text)}`);
    return {
      version: "obs-fact-v1" as const, id: digest, source: (o.source.startsWith("page") ? "dom" : "field_transition") as "dom" | "field_transition",
      grounding: "seen" as const, decisive: true, pageUrl: "", stateId: o.source, visibleTexts: [o.text.trim()], provenanceDigest: digest,
    };
  });
  const digest = sha16(facts.map((f) => f.id).sort().join(","));
  return { version: "obs-set-v1", facts, transitions: [], captureVersion: 1, digest };
}

export interface ObservationV2Shadow {
  version: "obs-judge-v2-shadow";
  ran: boolean;
  disagreement: DisagreementCategory | null;
  v2Pass: boolean;
  legacyPass: boolean;
  reasonCodes: string[];
  stateSpecificMatches: number;
  distinctSourceFacts: number;
  contradictions: number;
  corpusDigest: string;
  inputDigest: string;
  /** flagged when the deterministic shadow can't corroborate a non-English account (see P5). */
  multilingualCorroborationMissing: boolean;
}

/**
 * Run the V2 SHADOW against a submission's account + the campaign's existing corpus, compared to the
 * legacy money verdict. Returns a LEAK-SAFE record (counts + codes + digests, never corpus text) for
 * journaling. NEVER changes payout — the caller uses this only for telemetry.
 */
export function observationV2Shadow(account: string | null | undefined, corpus: { source: string; text: string }[] | null | undefined, legacyPass: boolean): ObservationV2Shadow {
  const set = reconstructSetFromCorpus(corpus);
  const r = judgeObservationV2(account, set);
  // multilingual heuristic: an account with substantial non-ASCII word content that scored zero state
  // matches is a likely real-recall limitation, not a guess — flagged, never auto-passed.
  const nonAscii = /[^\x00-\x7f]/.test(account ?? "");
  return {
    version: "obs-judge-v2-shadow", ran: r.ran, disagreement: r.ran ? compareV2ToLegacy(r.pass, legacyPass) : null,
    v2Pass: r.pass, legacyPass, reasonCodes: r.reasonCodes, stateSpecificMatches: r.stateSpecificMatches,
    distinctSourceFacts: r.distinctSourceFacts, contradictions: r.contradictions, corpusDigest: r.corpusDigest, inputDigest: r.inputDigest,
    multilingualCorroborationMissing: r.ran && r.stateSpecificMatches === 0 && nonAscii,
  };
}
