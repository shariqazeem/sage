import "server-only";

import { z } from "zod";
import { factIndex } from "./observed-facts";
import type { ObservationSetV1, ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import type { CandidateMission, CriterionGroundingV1, SourceRef, MissionPriority, MissionRiskCategory, CriterionKind, VerificationMode } from "./schemas";

/**
 * SEMANTIC MISSION DRAFT CONTRACT (grounded architect).
 *
 * The architect describes each criterion EXACTLY ONCE (text + evidence requirement + kind + cited ids +
 * rationale). It never emits parallel arrays, indexes, urls, anchors, sources or a groundingV1 map — Sage's
 * deterministic compiler (COMMIT 2) derives every one of those from the cited observations. This removes the
 * whole class of cross-field grounding failures (bijection / evidenceIndex-range) that a model cannot be
 * relied on to satisfy, and it guarantees anchors/urls/sources are VERBATIM observed values, not model text.
 *
 * The receiving strict parser is unchanged; this is provider-native json_schema (strict:true) transport plus
 * a strict Zod contract. Zod remains the semantic authority (uniqueness, kind rules, cross-field refinements).
 */
export const GROUNDED_ARCHITECT_CONTRACT_VERSION = "semantic-draft-v1";

const RISK_CATEGORIES = ["critical_journey", "onboarding", "responsive", "wallet_payment", "claim_validation", "error_recovery", "accessibility", "cross_browser", "docs_consistency", "trust_safety", "regression"] as const;
const uniqueStrings = (arr: readonly string[]) => new Set(arr).size === arr.length;

/** ONE semantic criterion — described once. Sage derives criterionIndex, evidenceIndex, pageUrl, stateId. */
export const DraftCriterionSchema = z
  .object({
    text: z.string().min(1).max(400),
    evidenceRequirement: z.string().min(1).max(400),
    criterionKind: z.enum(["state", "action_outcome", "content_claim", "visual_quality"]),
    factRefs: z.array(z.string().min(1)).min(1).refine(uniqueStrings, "factRefs must be unique"),
    transitionRef: z.string().min(1).nullish(), // null (a common model rendering of "absent") for non-action kinds
    evidenceMode: z.enum(["deterministic_url", "semantic_url", "observation"]),
    supportRationale: z.string().min(1).max(400),
  })
  .strict()
  .refine((c) => c.criterionKind !== "action_outcome" || !!c.transitionRef, "action_outcome criterion requires a transitionRef");

/** ONE draft mission — no criteria/evidenceRequirements arrays, no groundingV1, no derived fields. */
export const DraftMissionSchema = z
  .object({
    missionKey: z.string().min(1).max(48),
    title: z.string().min(1).max(140),
    objective: z.string().min(1).max(600),
    instructions: z.string().min(1).max(6000),
    whyItMatters: z.string().min(1).max(800),
    priority: z.enum(["high", "medium", "low"]),
    riskCategory: z.enum(RISK_CATEGORIES),
    effortMinutes: z.number().int().min(3).max(240),
    rewardWeight: z.number().int().min(1).max(10),
    maxCompletions: z.number().int().min(1).max(50),
    confidence: z.number().min(0).max(1),
    conditions: z.array(z.string()).max(8).nullish(),
    assumptions: z.array(z.string()).max(6).nullish(),
    disallowed: z.array(z.string()).max(8).nullish(),
    criteria: z.array(DraftCriterionSchema).min(1).max(12),
  })
  .strict();

export const SemanticDraftSchema = z
  .object({ missions: z.array(DraftMissionSchema).min(1) })
  .strict()
  .superRefine((o, ctx) => { if (!uniqueStrings(o.missions.map((m) => m.missionKey))) ctx.addIssue({ code: "custom", message: "missionKey values must be unique" }); });

export type SemanticDraftMission = z.infer<typeof DraftMissionSchema>;
export type SemanticDraftCriterion = z.infer<typeof DraftCriterionSchema>;

/* ─────────── provider-native TRANSPORT JSON Schema (json_schema strict:true) ─────────── */
const strArray = { type: "array", items: { type: "string" } };
const nullableStrArray = { type: ["array", "null"], items: { type: "string" } };
const draftCriterionTransport = {
  type: "object", additionalProperties: false,
  properties: {
    text: { type: "string" },
    evidenceRequirement: { type: "string" },
    criterionKind: { type: "string", enum: ["state", "action_outcome", "content_claim", "visual_quality"] },
    factRefs: strArray,
    transitionRef: { type: ["string", "null"] },
    evidenceMode: { type: "string", enum: ["deterministic_url", "semantic_url", "observation"] },
    supportRationale: { type: "string" },
  },
  required: ["text", "evidenceRequirement", "criterionKind", "factRefs", "transitionRef", "evidenceMode", "supportRationale"],
};
const draftMissionTransport = {
  type: "object", additionalProperties: false,
  properties: {
    missionKey: { type: "string" }, title: { type: "string" }, objective: { type: "string" }, instructions: { type: "string" },
    whyItMatters: { type: "string" }, priority: { type: "string", enum: ["high", "medium", "low"] }, riskCategory: { type: "string", enum: [...RISK_CATEGORIES] },
    effortMinutes: { type: "integer" }, rewardWeight: { type: "integer" }, maxCompletions: { type: "integer" }, confidence: { type: "number" },
    conditions: nullableStrArray, assumptions: nullableStrArray, disallowed: nullableStrArray,
    criteria: { type: "array", items: draftCriterionTransport },
  },
  required: ["missionKey", "title", "objective", "instructions", "whyItMatters", "priority", "riskCategory", "effortMinutes", "rewardWeight", "maxCompletions", "confidence", "conditions", "assumptions", "disallowed", "criteria"],
};
/** Architect transport — a missions array that MAY be empty (honest v2_empty) or carry semantic-draft missions. */
export const ARCHITECT_SEMANTIC_DRAFT_TRANSPORT_SCHEMA: { name: string; schema: Record<string, unknown> } = {
  name: "sage_grounded_architect_semantic_draft_v1",
  schema: { type: "object", additionalProperties: false, properties: { missions: { type: "array", items: draftMissionTransport } }, required: ["missions"] },
};

/* ─────────────────────────── PURE deterministic compiler (COMMIT 2) ───────────────────────────
 * Turns a schema-valid semantic draft into a canonical CandidateMission, DERIVING every field the model was
 * forbidden to author. It imports canonical types only and copies NO gate logic — validateMissionGrounding
 * and validatePlanMissions still run independently afterward. A model can never choose an index, a page/
 * state value, a source, an anchor, a target surface or a verification classification.                     */
export type CompilerRejectionCode =
  | "architect_fact_not_presented"
  | "architect_transition_not_presented"
  | "transition_not_safe"
  | "action_missing_after_state_fact"
  | "derived_anchor_unavailable";
export type CompileResult<T> = { ok: true; value: T } | { ok: false; code: CompilerRejectionCode };
/** the bounded set of ids ACTUALLY SHOWN to the architect (from the observation view) — a citation must be
 *  present here, not merely somewhere in the full set, so a model can't cite omitted/truncated evidence. */
export interface PresentedView { factIds: ReadonlySet<string>; transitionIds: ReadonlySet<string> }

const normLen = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").length;
/** ONE stable verbatim anchor from the cited facts: a ≥3-char elementName, else a ≥3-char visibleText. */
function deriveAnchor(facts: ObservedFactV1[]): string | null {
  for (const f of facts) if (f.elementName && normLen(f.elementName) >= 3) return f.elementName;
  for (const f of facts) for (const t of f.visibleTexts) if (t && normLen(t) >= 3) return t;
  return null;
}
const boundedFactObs = (f: ObservedFactV1) => (f.elementName || f.visibleTexts[0] || "observed").slice(0, 120);
const boundedTransObs = (t: ActionTransitionV1) => (t.addedTexts[0] || t.locator.accessibleName || t.verb).slice(0, 120);
function deriveVerificationMethod(modes: Set<VerificationMode>): string {
  const parts: string[] = [];
  if (modes.has("deterministic_url")) parts.push("public URL + exact quoted text");
  if (modes.has("semantic_url")) parts.push("public URL + a semantically supporting quote");
  if (modes.has("observation")) parts.push("the observed state/action outcome described by the tester");
  return parts.join("; ") || "the observed state/action outcome described by the tester";
}

export function compileGroundedMissionDraft(draft: SemanticDraftMission, set: ObservationSetV1, view: PresentedView): CompileResult<CandidateMission> {
  const idx = factIndex(set);
  const criteria: string[] = [];
  const evidenceRequirements: string[] = [];
  const grounding: CriterionGroundingV1[] = [];
  const anchors: string[] = [];
  const sourceByRef = new Map<string, SourceRef>();
  const modes = new Set<VerificationMode>();

  for (let i = 0; i < draft.criteria.length; i++) {
    const c = draft.criteria[i];
    // rule 1 — presented-evidence binding: every cited id must be in the bounded view shown to the architect.
    for (const fid of c.factRefs) if (!view.factIds.has(fid)) return { ok: false, code: "architect_fact_not_presented" };
    if (c.transitionRef && !view.transitionIds.has(c.transitionRef)) return { ok: false, code: "architect_transition_not_presented" };
    const citedFacts = c.factRefs.map((fid) => idx.facts.get(fid)).filter(Boolean) as ObservedFactV1[];
    if (citedFacts.length !== c.factRefs.length) return { ok: false, code: "architect_fact_not_presented" };

    // rule 2 — pageUrl/stateId derivation (never model-authored).
    let pageUrl: string;
    let stateId: string | undefined;
    if (c.criterionKind === "action_outcome") {
      const t = c.transitionRef ? idx.transitions.get(c.transitionRef) : undefined;
      if (!t) return { ok: false, code: "architect_transition_not_presented" };
      if (t.safeClassification !== "safe") return { ok: false, code: "transition_not_safe" };
      const afterFact = citedFacts.find((f) => f.stateId != null && f.stateId === t.afterStateDigest);
      if (!afterFact) return { ok: false, code: "action_missing_after_state_fact" };
      pageUrl = afterFact.pageUrl; stateId = afterFact.stateId ?? undefined;
    } else {
      const f0 = citedFacts[0];
      pageUrl = f0.pageUrl; stateId = f0.stateId ?? undefined;
    }

    // rule 5 — one derived verbatim anchor per criterion.
    const anchor = deriveAnchor(citedFacts);
    if (!anchor) return { ok: false, code: "derived_anchor_unavailable" };
    anchors.push(anchor);

    // rule 4 — sources derived from cited evidence only (bounded ACTUAL observed text).
    for (const f of citedFacts) if (!sourceByRef.has(f.pageUrl)) sourceByRef.set(f.pageUrl, { kind: "page", ref: f.pageUrl, observation: boundedFactObs(f) });
    if (c.transitionRef) { const t = idx.transitions.get(c.transitionRef); if (t && !sourceByRef.has(t.afterUrl)) sourceByRef.set(t.afterUrl, { kind: "page", ref: t.afterUrl, observation: boundedTransObs(t) }); }

    modes.add(c.evidenceMode as VerificationMode);
    criteria.push(c.text);
    evidenceRequirements.push(c.evidenceRequirement);
    grounding.push({
      criterionIndex: i, // DERIVED — the model never authors an index
      criterionKind: c.criterionKind as CriterionKind,
      sourceFactIds: c.factRefs,
      sourceTransitionIds: c.transitionRef ? [c.transitionRef] : undefined,
      evidenceIndex: i, // DERIVED — always equals the generated criterion index
      verificationMode: c.evidenceMode as VerificationMode,
      pageUrl, stateId, supportRationale: c.supportRationale,
    });
  }

  // rule 3 — targetSurface derived once per mission.
  const first = draft.criteria[0];
  let targetSurface: string;
  if (first.criterionKind === "action_outcome" && first.transitionRef) {
    const t = idx.transitions.get(first.transitionRef);
    targetSurface = t ? t.startUrl : grounding[0].pageUrl!;
  } else {
    targetSurface = grounding[0].pageUrl!;
  }

  const mission: CandidateMission = {
    missionKey: draft.missionKey, title: draft.title, objective: draft.objective, instructions: draft.instructions,
    targetSurface, criteria, evidenceRequirements, whyItMatters: draft.whyItMatters,
    sources: [...sourceByRef.values()], priority: draft.priority as MissionPriority, riskCategory: draft.riskCategory as MissionRiskCategory,
    effortMinutes: draft.effortMinutes, conditions: draft.conditions ?? [], rewardWeight: draft.rewardWeight, maxCompletions: draft.maxCompletions,
    verificationMethod: deriveVerificationMethod(modes), confidence: draft.confidence, assumptions: draft.assumptions ?? [], disallowed: draft.disallowed ?? [],
    anchors: [...new Set(anchors)], // rule 5 — deduplicate deterministically
    groundingV1: { version: "mission-grounding-v1", observationSetDigest: set.digest, criteria: grounding },
  };
  return { ok: true, value: mission };
}

/* ─────────────────────────── shadow entry: parse + compile the whole draft ─────────────────────────── */
export interface DraftCompileOutcome {
  kind: "empty" | "schema_invalid" | "compiled";
  schemaErrorPaths: string[];
  candidates: CandidateMission[];
  draftMissionCount: number;
  draftCriterionCount: number;
  compiledMissionCount: number;
  compilerRejectedCount: number;
  compilerRejectionCodes: Record<string, number>;
  derivedAnchorCount: number;
  derivedSourceCount: number;
  derivedTargetSurfaceCount: number;
}
const EMPTY_OUTCOME = (kind: DraftCompileOutcome["kind"], schemaErrorPaths: string[] = []): DraftCompileOutcome => ({ kind, schemaErrorPaths, candidates: [], draftMissionCount: 0, draftCriterionCount: 0, compiledMissionCount: 0, compilerRejectedCount: 0, compilerRejectionCodes: {}, derivedAnchorCount: 0, derivedSourceCount: 0, derivedTargetSurfaceCount: 0 });

/** Strict Zod parse of the semantic draft → deterministic compile of each mission. `empty` (honest v2_empty)
 *  is distinguished from `schema_invalid`; a per-mission compiler rejection drops that mission (bounded codes
 *  recorded), never the whole plan. */
export function parseAndCompileArchitectDraft(json: unknown, set: ObservationSetV1, view: PresentedView): DraftCompileOutcome {
  const rawMissions = (json as { missions?: unknown[] } | null)?.missions;
  if (Array.isArray(rawMissions) && rawMissions.length === 0) return EMPTY_OUTCOME("empty");
  const parsed = SemanticDraftSchema.safeParse(json);
  if (!parsed.success) return EMPTY_OUTCOME("schema_invalid", parsed.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(root)"}:${i.code}`));

  const candidates: CandidateMission[] = [];
  const compilerRejectionCodes: Record<string, number> = {};
  let compilerRejectedCount = 0, draftCriterionCount = 0, derivedAnchorCount = 0, derivedSourceCount = 0;
  for (const draft of parsed.data.missions) {
    draftCriterionCount += draft.criteria.length;
    const r = compileGroundedMissionDraft(draft, set, view);
    if (r.ok) { candidates.push(r.value); derivedAnchorCount += r.value.anchors?.length ?? 0; derivedSourceCount += r.value.sources.length; }
    else { compilerRejectedCount++; compilerRejectionCodes[r.code] = (compilerRejectionCodes[r.code] ?? 0) + 1; }
  }
  return { kind: "compiled", schemaErrorPaths: [], candidates, draftMissionCount: parsed.data.missions.length, draftCriterionCount, compiledMissionCount: candidates.length, compilerRejectedCount, compilerRejectionCodes, derivedAnchorCount, derivedSourceCount, derivedTargetSurfaceCount: candidates.length };
}
