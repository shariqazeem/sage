import { describe, it, expect } from "vitest";
import { SemanticDraftSchema, DraftCriterionSchema, DraftMissionSchema, GROUNDED_ARCHITECT_CONTRACT_VERSION, ARCHITECT_SEMANTIC_DRAFT_TRANSPORT_SCHEMA, compileGroundedMissionDraft, parseAndCompileArchitectDraft, type PresentedView } from "./mission-draft-compiler";
import { deriveObservations, decisiveFacts } from "./observed-facts";
import { validateMissionGrounding, classifyGroundingTier } from "./mission-grounding";
import type { FieldTestState, FieldTestSummary } from "./schemas";

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

/* ─────────────────── deterministic COMPILER matrix (tests 1-17,19) ─────────────────── */
const stt = (o: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://p.test/", networkMethods: ["GET"], ...o });
const FT: FieldTestSummary = { ran: true, startUrl: "https://p.test/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1, states: [
  stt({ url: "https://p.test/", visibleTextExcerpt: "Welcome", notableElements: [{ tag: "button", text: "Start", role: "button" }] }),
  stt({ trigger: "clicked 'Start'", url: "https://p.test/play", visibleTextExcerpt: "You reach the garden world.", notableElements: [{ tag: "button", text: "Talk to Yara", role: "button" }], pixelDeltaPct: 40, networkMethods: ["GET"] }),
] };
const SET = deriveObservations(FT);
const startFact = decisiveFacts(SET).find((f) => f.elementName === "Start")!;
const yaraFact = decisiveFacts(SET).find((f) => f.elementName === "Talk to Yara")!;
const transId = SET.transitions[0].id;
const allPresented: PresentedView = { factIds: new Set(SET.facts.map((f) => f.id)), transitionIds: new Set(SET.transitions.map((t) => t.id)) };

// an UNSAFE (POST) transition set for tests 12.
const ftPost: FieldTestSummary = { ...FT, states: [
  stt({ url: "https://p.test/", visibleTextExcerpt: "Store", notableElements: [{ tag: "button", text: "Buy", role: "button" }] }),
  stt({ trigger: "clicked 'Buy'", url: "https://p.test/bought", visibleTextExcerpt: "Purchase complete.", notableElements: [{ tag: "button", text: "View receipt", role: "button" }], pixelDeltaPct: 30, networkMethods: ["POST"] }),
] };
const SET_POST = deriveObservations(ftPost);
const postTrans = SET_POST.transitions[0];
const postAfterFact = SET_POST.facts.find((f) => f.stateId === postTrans.afterStateDigest)!;
const postPresented: PresentedView = { factIds: new Set(SET_POST.facts.map((f) => f.id)), transitionIds: new Set(SET_POST.transitions.map((t) => t.id)) };

const stateCrit = (over = {}) => ({ text: "The Start control is present on the homepage", evidenceRequirement: "Quote the observed Start control", criterionKind: "state", factRefs: [startFact.id], transitionRef: null, evidenceMode: "observation", supportRationale: "the Start control was seen", ...over });
const actionCrit = (over = {}) => ({ text: "Clicking Start reaches the garden world", evidenceRequirement: "Describe the garden world reached", criterionKind: "action_outcome", factRefs: [yaraFact.id], transitionRef: transId, evidenceMode: "observation", supportRationale: "the reproduced transition produced this state", ...over });
const draftMission = (criteria: unknown[], over = {}) => ({ missionKey: "m1", title: "T", objective: "O", instructions: "1. step", whyItMatters: "core", priority: "high", riskCategory: "critical_journey", effortMinutes: 5, rewardWeight: 5, maxCompletions: 3, confidence: 0.8, conditions: [], assumptions: [], disallowed: [], criteria, ...over });
const compile = (m: unknown, set = SET, view = allPresented) => compileGroundedMissionDraft(DraftMissionSchema.parse(m), set, view);

describe("deterministic draft compiler matrix", () => {
  it("1. two semantic criteria compile to derived criterionIndex 0 and 1", () => {
    const r = compile(draftMission([stateCrit(), stateCrit({ text: "second" })]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.groundingV1!.criteria.map((c) => c.criterionIndex)).toEqual([0, 1]);
  });
  it("2. evidenceIndex always equals its generated criterion index", () => {
    const r = compile(draftMission([actionCrit(), stateCrit()]));
    if (r.ok) for (const c of r.value.groundingV1!.criteria) expect(c.evidenceIndex).toBe(c.criterionIndex);
  });
  it("3. the model cannot author an index (Zod rejects criterionIndex/evidenceIndex keys)", () => {
    expect(DraftCriterionSchema.safeParse(stateCrit({ criterionIndex: 0 })).success).toBe(false);
    expect(DraftCriterionSchema.safeParse(stateCrit({ evidenceIndex: 0 })).success).toBe(false);
  });
  it("4. pageUrl/stateId derive from the cited facts (state: first fact; action: after-state fact)", () => {
    const s = compile(draftMission([stateCrit()]));
    if (s.ok) { expect(s.value.groundingV1!.criteria[0].pageUrl).toBe(startFact.pageUrl); expect(s.value.groundingV1!.criteria[0].stateId).toBe(startFact.stateId); }
    const a = compile(draftMission([actionCrit()]));
    if (a.ok) { expect(a.value.groundingV1!.criteria[0].pageUrl).toBe(yaraFact.pageUrl); expect(a.value.groundingV1!.criteria[0].stateId).toBe(yaraFact.stateId); }
  });
  it("5. an action targetSurface derives from transition.startUrl", () => {
    const r = compile(draftMission([actionCrit()]));
    if (r.ok) expect(r.value.targetSurface).toBe(SET.transitions[0].startUrl);
  });
  it("6. a state targetSurface derives from the cited fact's pageUrl", () => {
    const r = compile(draftMission([stateCrit()]));
    if (r.ok) expect(r.value.targetSurface).toBe(startFact.pageUrl);
  });
  it("7. sources derive only from observed evidence (cited facts/transitions), never model text", () => {
    const r = compile(draftMission([stateCrit()]));
    if (r.ok) { expect(r.value.sources.length).toBeGreaterThan(0); for (const s of r.value.sources) expect(s.ref).toBe(startFact.pageUrl); }
  });
  it("8. anchors derive only from exact observed strings (the cited fact's elementName)", () => {
    const r = compile(draftMission([stateCrit()]));
    if (r.ok) expect(r.value.anchors).toEqual(["Start"]);
  });
  it("9. duplicate derived anchors deduplicate deterministically", () => {
    const r = compile(draftMission([stateCrit(), stateCrit({ text: "again" })])); // both cite startFact → anchor "Start"
    if (r.ok) expect(r.value.anchors).toEqual(["Start"]);
  });
  it("10. a fact not in the presented view fails architect_fact_not_presented", () => {
    const view: PresentedView = { factIds: new Set([yaraFact.id]), transitionIds: allPresented.transitionIds }; // startFact omitted
    const r = compile(draftMission([stateCrit()]), SET, view);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe("architect_fact_not_presented");
  });
  it("11. a transition not in the presented view fails architect_transition_not_presented", () => {
    const view: PresentedView = { factIds: allPresented.factIds, transitionIds: new Set() };
    const r = compile(draftMission([actionCrit()]), SET, view);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe("architect_transition_not_presented");
  });
  it("12. an unsafe/state-changing (POST) transition fails transition_not_safe", () => {
    const crit = { text: "buy", evidenceRequirement: "describe the receipt", criterionKind: "action_outcome", factRefs: [postAfterFact.id], transitionRef: postTrans.id, evidenceMode: "observation", supportRationale: "receipt shown" };
    const r = compile(draftMission([crit]), SET_POST, postPresented);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe("transition_not_safe");
  });
  it("13. an action criterion citing no after-state fact fails action_missing_after_state_fact", () => {
    const r = compile(draftMission([actionCrit({ factRefs: [startFact.id] })])); // startFact is the BEFORE state
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe("action_missing_after_state_fact");
  });
  it("14. a state criterion that also cites a transition stays state_seen (not action_observed)", () => {
    const r = compile(draftMission([stateCrit({ transitionRef: transId })]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(classifyGroundingTier(r.value.groundingV1!.criteria[0], SET)).toBe("state_seen");
  });
  it("15. missions:[] compiles to the honest empty outcome", () => {
    expect(parseAndCompileArchitectDraft({ missions: [] }, SET, allPresented).kind).toBe("empty");
  });
  it("16. a forbidden derived key in the model output fails the strict transport (Zod) → schema_invalid", () => {
    expect(parseAndCompileArchitectDraft({ missions: [draftMission([stateCrit()], { anchors: ["x"] })] }, SET, allPresented).kind).toBe("schema_invalid");
    expect(parseAndCompileArchitectDraft({ missions: [draftMission([stateCrit()], { groundingV1: {} })] }, SET, allPresented).kind).toBe("schema_invalid");
  });
  it("17. a compiled mission passes the existing grounding validator", () => {
    const r = compile(draftMission([actionCrit()]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateMissionGrounding(r.value, SET, { expectedDigest: SET.digest })).toEqual([]);
  });
  it("19. a ghost feature (cites an unobserved fact id) cannot acquire derived anchors/sources", () => {
    const r = compile(draftMission([stateCrit({ factRefs: ["deadbeefdeadbeefdeadbeef"] })]));
    expect(r.ok).toBe(false); // rejected before any anchor/source is derived
  });
});
