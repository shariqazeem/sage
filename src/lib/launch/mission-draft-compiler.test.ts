import { describe, it, expect } from "vitest";
import { SemanticDraftSchema, DraftCriterionSchema, GROUNDED_ARCHITECT_CONTRACT_VERSION, ARCHITECT_SEMANTIC_DRAFT_TRANSPORT_SCHEMA } from "./mission-draft-compiler";

const criterion = (over: Record<string, unknown> = {}) => ({ text: "Reach the report state", evidenceRequirement: "Describe the report state reached", criterionKind: "action_outcome", factRefs: ["fact-after"], transitionRef: "trans-1", evidenceMode: "observation", supportRationale: "the transition produced this state", ...over });
const mission = (over: Record<string, unknown> = {}) => ({ missionKey: "test-report-loading", title: "Test report loading", objective: "Load the report", instructions: "1. Click load", whyItMatters: "core", priority: "high", riskCategory: "critical_journey", effortMinutes: 5, rewardWeight: 5, maxCompletions: 3, confidence: 0.8, conditions: [], assumptions: [], disallowed: [], criteria: [criterion()], ...over });

describe("semantic-draft contract (COMMIT 1)", () => {
  it("the contract version + transport schema name are pinned", () => {
    expect(GROUNDED_ARCHITECT_CONTRACT_VERSION).toBe("semantic-draft-v1");
    expect(ARCHITECT_SEMANTIC_DRAFT_TRANSPORT_SCHEMA.name).toBe("sage_grounded_architect_semantic_draft_v1");
  });

  it("a valid single-source draft parses", () => {
    expect(SemanticDraftSchema.safeParse({ missions: [mission()] }).success).toBe(true);
  });

  it("the transport schema is strict object with additionalProperties:false throughout", () => {
    const s = ARCHITECT_SEMANTIC_DRAFT_TRANSPORT_SCHEMA.schema as Record<string, unknown>;
    expect(s.additionalProperties).toBe(false);
    const item = ((s.properties as Record<string, { items?: Record<string, unknown> }>).missions.items) as Record<string, unknown>;
    expect(item.additionalProperties).toBe(false);
    const critItem = ((item.properties as Record<string, { items?: Record<string, unknown> }>).criteria.items) as Record<string, unknown>;
    expect(critItem.additionalProperties).toBe(false);
  });

  for (const forbidden of ["criterionIndex", "evidenceIndex", "groundingV1", "pageUrl", "stateId", "targetSurface", "sources", "anchors", "verificationMethod", "evidenceRequirements"]) {
    it(`REJECTS a mission carrying the derived/forbidden key "${forbidden}" (additionalProperties:false)`, () => {
      expect(SemanticDraftSchema.safeParse({ missions: [mission({ [forbidden]: forbidden === "criteria" ? [] : "x" })] }).success).toBe(false);
    });
  }

  it("REJECTS a criterion carrying a forbidden index key", () => {
    expect(DraftCriterionSchema.safeParse(criterion({ criterionIndex: 0 })).success).toBe(false);
    expect(DraftCriterionSchema.safeParse(criterion({ evidenceIndex: 0 })).success).toBe(false);
  });

  it("an action_outcome criterion REQUIRES a transitionRef; other kinds may use null", () => {
    expect(DraftCriterionSchema.safeParse(criterion({ criterionKind: "action_outcome", transitionRef: null })).success).toBe(false);
    expect(DraftCriterionSchema.safeParse(criterion({ criterionKind: "state", transitionRef: null, factRefs: ["f1"] })).success).toBe(true);
  });

  it("factRefs must be non-empty and unique", () => {
    expect(DraftCriterionSchema.safeParse(criterion({ factRefs: [] })).success).toBe(false);
    expect(DraftCriterionSchema.safeParse(criterion({ factRefs: ["a", "a"] })).success).toBe(false);
  });

  it("missions:[] fails the Zod min(1) (the shadow treats it as the honest v2_empty case separately)", () => {
    expect(SemanticDraftSchema.safeParse({ missions: [] }).success).toBe(false);
  });
});
