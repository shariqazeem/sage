import "server-only";

import { z } from "zod";

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
