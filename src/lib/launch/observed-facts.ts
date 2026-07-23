import { createHash } from "node:crypto";
import type { FieldTestSummary, FieldTestState } from "./schemas";

/**
 * Sage's Eyes V2 — action-grounded, typed, source-addressable product understanding.
 *
 * The field test already SEES real things (DOM elements, state transitions after real safe actions) and
 * vision INTERPRETS screenshots. This module turns that into a versioned, deterministically-addressed
 * observation set that downstream layers (mission design, the observation judge) can cite by ID:
 *
 *   · ObservedFactV1     — one atomic observed fact (a control, a visible text, a state).
 *   · ActionTransitionV1 — one safe action Sage performed and the state change it caused.
 *
 * The load-bearing rules (all enforced HERE, deterministically, never by a model):
 *   1. IDs + digests are sha256 over canonical content — reproducible, never model-authored.
 *   2. DOM + field-test facts are `seen`. Vision facts are `inferred`.
 *   3. Only `seen` facts may be DECISIVE anchors (`decisive: true`). Inferred facts are hypotheses.
 *   4. Vision may interpret relationships/usability, but any exact TEXT it emits must already appear in the
 *      captured DOM/field source; invented text is dropped (never becomes a fact's visibleText).
 *   5. Duplicate facts canonicalize to one ID; the same text on a different page/state is a DISTINCT fact
 *      (page/state is in the hash), so conflicts stay distinguishable.
 *   6. The set is derived purely from already-captured artifacts — no new browsing, no network, no model.
 *
 * This is additive: it attaches to `ProductMapV1.observations` (optional, excluded from the map digest),
 * so an inspection that never ran produces byte-identical downstream hashes. Old inspection artifacts (no
 * `observations`) remain readable — deriving from them just yields an empty/partial set.
 */

export const OBS_SET_VERSION = "obs-set-v1";

export type FactSource = "dom" | "field_transition" | "vision";
export type Grounding = "seen" | "inferred";
export type SafeVerb = "load" | "wait" | "click" | "press" | "scroll";

export interface ObservedFactV1 {
  version: "obs-fact-v1";
  /** deterministic id = sha256(canonical content).slice — never model-authored. */
  id: string;
  source: FactSource;
  grounding: Grounding;
  /** only `seen` facts may anchor a mission decisively. */
  decisive: boolean;
  pageUrl: string;
  /** deterministic id of the field-test state this fact belongs to, or null (static page). */
  stateId: string | null;
  /** exact visible texts (verbatim from the captured artifact; vision-invented text is excluded). */
  visibleTexts: string[];
  /** element role / accessible name where known (from notableElements). */
  elementRole?: string;
  elementName?: string;
  /** for a vision fact: which state screenshot (index into fieldTest.states). */
  sourceImageIndex?: number;
  /** the transition whose after-state produced this fact, where relevant. */
  transitionId?: string | null;
  /** confidence ONLY where model-derived (vision). Absent for seen facts. */
  confidence?: number;
  /** sha256 over the fact's canonical content (audit; equals the pre-slice of `id`). */
  provenanceDigest: string;
}

export interface ActionTransitionV1 {
  version: "action-transition-v1";
  id: string;
  startUrl: string;
  /** digest of the state BEFORE the action. */
  beforeStateDigest: string;
  verb: SafeVerb;
  /** robust locator: role + exact accessible name where known, else a raw label. */
  locator: { role?: string; accessibleName?: string; raw?: string };
  afterUrl: string;
  afterStateDigest: string;
  /** visible-text delta computed deterministically from the two states. */
  addedTexts: string[];
  removedTexts: string[];
  /** true when the after-state observably differs from the before-state (text delta or pixel delta). */
  observableChange: boolean;
  /** the request methods this transition actually involved, from the field test's per-state capture:
   *  `get_observed` (only GET/HEAD seen), `state_changing` (a mutating method seen), or `not_captured`
   *  (no per-transition network was recorded — safety is UNVERIFIED, not assumed safe). */
  networkMethodSummary: "not_captured" | "get_observed" | "state_changing";
  /** safe-action classification. `safe` ONLY when positively established (get_observed); a mutating
   *  method → `state_changing`; no capture → `unverified` (NOT replayable). */
  safeClassification: "safe" | "unverified" | "state_changing" | "unsafe";
  /** field-test provenance: the indices of the before/after states in fieldTest.states. */
  provenance: { fromStateIndex: number; toStateIndex: number };
}

export interface ObservationSetV1 {
  version: typeof OBS_SET_VERSION;
  facts: ObservedFactV1[];
  transitions: ActionTransitionV1[];
  /** monotonically-bumped capture version of the inspection (metadata; NOT part of any id). */
  captureVersion: number;
  /** digest over the canonical set (facts + transitions, sorted by id). */
  digest: string;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const uniqSorted = (xs: string[]) => [...new Set(xs.map(norm).filter(Boolean))].sort();

/** Deterministic digest of one field-test state — the same content always yields the same id. */
export function stateDigest(s: Pick<FieldTestState, "url" | "visibleTextExcerpt" | "notableElements">): string {
  const canonical = JSON.stringify({
    u: s.url,
    t: norm(s.visibleTextExcerpt).slice(0, 4000),
    e: (s.notableElements ?? []).map((e) => [e.tag, e.role, norm(e.text)]).sort(),
  });
  return sha(canonical).slice(0, 24);
}

/** Parse a field-test trigger string into a safe verb + a locator name (deterministic; no model). */
export function parseTrigger(trigger: string): { verb: SafeVerb; name?: string } {
  const t = norm(trigger).toLowerCase();
  const quoted = /'([^']+)'|"([^"]+)"/.exec(trigger);
  const name = quoted ? quoted[1] ?? quoted[2] : undefined;
  if (t.includes("initial load") || t.startsWith("loaded") || t === "load") return { verb: "load" };
  if (t.includes("wait")) return { verb: "wait" };
  if (t.includes("click") || t.includes("tapped") || t.includes("explored")) return { verb: "click", name };
  if (t.includes("press")) {
    const key = /press(?:ed)?\s+([A-Za-z0-9]+)/i.exec(trigger)?.[1];
    return { verb: "press", name: name ?? key };
  }
  if (t.includes("scroll")) return { verb: "scroll" };
  return { verb: "load" };
}

/** A visible-text token set for one state (for the transition delta) — exact rendered texts + element texts. */
function stateTexts(s: FieldTestState): Set<string> {
  const out = new Set<string>();
  for (const line of norm(s.visibleTextExcerpt).split(/(?<=[.!?])\s+|\n+/)) if (norm(line)) out.add(norm(line));
  for (const e of s.notableElements ?? []) if (norm(e.text)) out.add(norm(e.text));
  return out;
}

/** Build one `seen` DOM fact from a notable element or a page/state text. */
function seenFact(args: {
  source: FactSource; pageUrl: string; stateId: string | null; texts: string[];
  role?: string; name?: string; transitionId?: string | null;
}): ObservedFactV1 {
  const texts = uniqSorted(args.texts);
  const canonical = JSON.stringify({ s: args.source, p: args.pageUrl, st: args.stateId, x: texts, r: args.role ?? "", n: args.name ?? "" });
  const digest = sha(canonical);
  return {
    version: "obs-fact-v1", id: digest.slice(0, 24), source: args.source, grounding: "seen", decisive: true,
    pageUrl: args.pageUrl, stateId: args.stateId, visibleTexts: texts,
    ...(args.role ? { elementRole: args.role } : {}), ...(args.name ? { elementName: args.name } : {}),
    ...(args.transitionId ? { transitionId: args.transitionId } : {}),
    provenanceDigest: digest,
  };
}

/**
 * Derive the observation set from a completed field test (+ its vision observations). Pure + deterministic:
 * the same summary always yields the same ids. `captureVersion` is metadata only (not hashed).
 */
export function deriveObservations(fieldTest: FieldTestSummary | null | undefined, captureVersion = 1): ObservationSetV1 {
  const facts: ObservedFactV1[] = [];
  const transitions: ActionTransitionV1[] = [];
  const byId = new Map<string, ObservedFactV1>();
  const add = (f: ObservedFactV1) => { if (!byId.has(f.id)) { byId.set(f.id, f); facts.push(f); } };

  if (!fieldTest || !fieldTest.ran) {
    return { version: OBS_SET_VERSION, facts: [], transitions: [], captureVersion, digest: sha("[]").slice(0, 24) };
  }

  // STATIC pages → seen DOM facts (title/h1/ctas/forms).
  for (const p of fieldTest.pages) {
    if (norm(p.h1)) add(seenFact({ source: "dom", pageUrl: p.url, stateId: null, texts: [p.h1] }));
    if (norm(p.title)) add(seenFact({ source: "dom", pageUrl: p.url, stateId: null, texts: [p.title] }));
    for (const cta of p.ctas) if (norm(cta)) add(seenFact({ source: "dom", pageUrl: p.url, stateId: null, texts: [cta], role: "button", name: cta }));
    for (const form of p.forms) add(seenFact({ source: "dom", pageUrl: p.url, stateId: null, texts: [form.action, ...form.fields].filter(Boolean), role: "form" }));
  }

  // INTERACTIVE states → seen DOM facts + transitions between consecutive states.
  const stateIds = fieldTest.states.map((s) => stateDigest(s));
  fieldTest.states.forEach((s, i) => {
    const stateId = stateIds[i];
    // a `seen` fact per notable element (role/name/text) — the decisive anchors.
    for (const e of s.notableElements ?? []) {
      if (!norm(e.text)) continue;
      add(seenFact({ source: "dom", pageUrl: s.url, stateId, texts: [e.text], role: e.role || e.tag, name: e.text }));
    }
    // a `seen` fact for the state's visible-text excerpt (the state itself).
    if (norm(s.visibleTextExcerpt)) {
      add(seenFact({ source: "field_transition", pageUrl: s.url, stateId, texts: [norm(s.visibleTextExcerpt).slice(0, 400)] }));
    }
    // transition FROM the previous state via this state's trigger.
    if (i > 0) {
      const prev = fieldTest.states[i - 1];
      const { verb, name } = parseTrigger(s.trigger);
      const before = stateTexts(prev), after = stateTexts(s);
      const added = [...after].filter((t) => !before.has(t)).sort();
      const removed = [...before].filter((t) => !after.has(t)).sort();
      const observableChange = added.length > 0 || removed.length > 0 || s.pixelDeltaPct >= 3;
      // network summary + safety from the after-state's captured methods. `safe` ONLY when we positively
      // observed GET/HEAD-only; a mutating method → state_changing; no capture → unverified (NOT safe).
      const methods = (s.networkMethods ?? []).map((m) => m.toUpperCase());
      const summary: ActionTransitionV1["networkMethodSummary"] =
        methods.length === 0 ? "not_captured" : methods.every((m) => m === "GET" || m === "HEAD") ? "get_observed" : "state_changing";
      const safeClassification: ActionTransitionV1["safeClassification"] =
        summary === "get_observed" ? "safe" : summary === "state_changing" ? "state_changing" : "unverified";
      // the locator is built from the BEFORE state's target element (what was acted on), not the after
      // state — the after state's elements are the RESULT, not the control that was clicked.
      const beforeEl = (prev.notableElements ?? []).find((e) => name && norm(e.text).toLowerCase() === norm(name).toLowerCase());
      const canonical = JSON.stringify({ f: stateIds[i - 1], t: stateId, v: verb, n: name ?? "", a: added, r: removed });
      transitions.push({
        version: "action-transition-v1", id: sha(canonical).slice(0, 24),
        startUrl: prev.url, beforeStateDigest: stateIds[i - 1], verb,
        locator: { ...(beforeEl?.role ? { role: beforeEl.role } : {}), ...(name ? { accessibleName: name } : {}), ...(name && !beforeEl ? { raw: name } : {}) },
        afterUrl: s.url, afterStateDigest: stateId, addedTexts: added, removedTexts: removed,
        observableChange, networkMethodSummary: summary, safeClassification,
        provenance: { fromStateIndex: i - 1, toStateIndex: i },
      });
    }
  });

  // VISION → `inferred`, non-decisive facts. Exact texts are FILTERED to those already present in the
  // captured DOM/field source (invented text is dropped). Interpretation (scene/ui kinds) is kept as a
  // hypothesis, never a decisive anchor.
  const seenTextPool = new Set<string>();
  for (const f of facts) for (const x of f.visibleTexts) seenTextPool.add(x.toLowerCase());
  for (const vo of fieldTest.visionObservations ?? []) {
    const state = fieldTest.states[vo.stateIndex];
    const pageUrl = state?.url ?? fieldTest.startUrl;
    const stateId = state ? stateIds[vo.stateIndex] : null;
    // keep ONLY vision visibleText that is corroborated by the captured source.
    const grounded = uniqSorted(vo.visibleText).filter((t) => seenTextPool.has(t.toLowerCase()));
    const canonical = JSON.stringify({ s: "vision", p: pageUrl, st: stateId, img: vo.stateIndex, x: grounded, d: norm(vo.sceneDescription).slice(0, 200) });
    const digest = sha(canonical);
    add({
      version: "obs-fact-v1", id: digest.slice(0, 24), source: "vision", grounding: "inferred", decisive: false,
      pageUrl, stateId, visibleTexts: grounded, sourceImageIndex: vo.stateIndex,
      confidence: grounded.length > 0 ? 0.6 : 0.3, provenanceDigest: digest,
    });
  }

  const setCanonical = JSON.stringify({ f: facts.map((f) => f.id).sort(), t: transitions.map((t) => t.id).sort() });
  return { version: OBS_SET_VERSION, facts, transitions, captureVersion, digest: sha(setCanonical).slice(0, 24) };
}

/** The decisive (seen) facts — the only ones a mission may anchor to. */
export function decisiveFacts(set: ObservationSetV1): ObservedFactV1[] {
  return set.facts.filter((f) => f.decisive && f.grounding === "seen");
}

/** Lookup a fact/transition by id (for grounding checks in mission validation). */
export function factIndex(set: ObservationSetV1): { facts: Map<string, ObservedFactV1>; transitions: Map<string, ActionTransitionV1> } {
  return {
    facts: new Map(set.facts.map((f) => [f.id, f])),
    transitions: new Map(set.transitions.map((t) => [t.id, t])),
  };
}

/**
 * A typed action→outcome view (the strict, ID-referencing successor to free-text vision narration). Each
 * entry ties a real safe action to the state change it caused and the facts that state contains. Fields:
 * what control was acted on, what safe action, what changed afterward, which facts/state/image it refers
 * to, and whether the conclusion is seen or inferred. `whyItMightMatter` is NOT fabricated — it is null
 * unless a GROUNDED vision fact for that state supplies it; the significance is the architect's call.
 */
export interface ActionOutcomeV1 {
  version: "action-outcome-v1";
  transitionId: string;
  afterStateId: string;
  sourceImageIndex: number | null;
  observedControl: { role?: string; name?: string } | null;
  safeAction: SafeVerb;
  changedAfter: string[];
  /** the seen facts present in the after-state (decisive anchors for a mission about this outcome). */
  factIds: string[];
  grounding: "seen";
  whyItMightMatter: string | null;
}

/** Derive the typed action→outcome view from an already-derived set. Pure; references ids only. */
export function deriveActionOutcomes(set: ObservationSetV1): ActionOutcomeV1[] {
  return set.transitions.map((t) => {
    const factIds = set.facts.filter((f) => f.decisive && f.stateId === t.afterStateDigest).map((f) => f.id).sort();
    const visionForState = set.facts.find((f) => f.source === "vision" && f.stateId === t.afterStateDigest);
    const control = t.locator.accessibleName || t.locator.raw || t.locator.role
      ? { ...(t.locator.role ? { role: t.locator.role } : {}), ...(t.locator.accessibleName || t.locator.raw ? { name: t.locator.accessibleName ?? t.locator.raw } : {}) }
      : null;
    return {
      version: "action-outcome-v1", transitionId: t.id, afterStateId: t.afterStateDigest,
      sourceImageIndex: visionForState?.sourceImageIndex ?? null, observedControl: control,
      safeAction: t.verb, changedAfter: t.addedTexts, factIds, grounding: "seen",
      whyItMightMatter: null, // never fabricated; the architect supplies significance from these facts
    };
  });
}

/**
 * A LEAK-SAFE public projection of the observation set — COUNTS + the set digest + fact ids ONLY, never
 * any observed text. The observation set is a private "answer key"; only this projection may reach a
 * public/audit surface. (The private corpus itself is enforced separately in observation-verify.)
 */
export function publicObservationView(set: ObservationSetV1): {
  version: string; digest: string; seenFacts: number; inferredFacts: number; transitions: number; factIds: string[];
} {
  const seen = set.facts.filter((f) => f.grounding === "seen").length;
  return {
    version: set.version, digest: set.digest, seenFacts: seen, inferredFacts: set.facts.length - seen,
    transitions: set.transitions.length, factIds: set.facts.map((f) => f.id).sort(),
  };
}
