import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fake ONLY the external provider boundary. runMissionBrain (the real entrypoint) + its architect/critic/
// gate + runGroundedShadow (strict semantic-draft Zod → deterministic COMPILER → digest-bound grounding →
// critic → the SAME canonical gate the legacy plan uses → real allocator) all run for real; llmCompleteJson
// returns scripted JSON keyed by system prompt. The mock spreads the real module so LlmCompletionError stays
// defined (the shadow does `instanceof`); only llmConfigured + llmCompleteJson are overridden.
vi.mock("@/lib/llm/complete", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/llm/complete")>()), llmConfigured: () => true, llmCompleteJson: vi.fn() }));

import { runMissionBrain } from "./mission-brain";
import { llmCompleteJson } from "@/lib/llm/complete";
import { deriveObservations, decisiveFacts } from "./observed-facts";
import type { ObservationSetV1 } from "./observed-facts";
import { scopeFromObservations } from "./product-map";
import type { FieldTestState, FieldTestSummary, ProductMapV1, ProductObservation } from "./schemas";

const stt = (o: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://p.test/", networkMethods: ["GET"], ...o });
const FT: FieldTestSummary = {
  ran: true, startUrl: "https://p.test/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1,
  states: [
    stt({ trigger: "initial load", visibleTextExcerpt: "Welcome", notableElements: [{ tag: "button", text: "Start", role: "button" }] }),
    stt({ trigger: "clicked 'Start'", url: "https://p.test/play", visibleTextExcerpt: "You reach the garden world.", notableElements: [{ tag: "button", text: "Talk to Yara", role: "button" }], pixelDeltaPct: 40 }),
  ],
};
const SET: ObservationSetV1 = deriveObservations(FT);
const CORPUS = "welcome start you reach the garden world talk to yara"; // normalized exactly as the pipeline builds it
const obs = (url: string): ProductObservation => ({ url, status: 200, title: "P", headings: ["Welcome"], claims: [], ctas: ["Start"], forms: [], links: [], authBoundary: false, techHints: [], states: [], landmarks: [], snippets: ["Welcome"], inspectedAt: 1, contentSha256: "a".repeat(64) });
function makeMap(): ProductMapV1 {
  const finding = (v: string) => ({ value: v, confidence: 0.9, sources: [{ kind: "page" as const, ref: "https://p.test/", observation: v }], browserConfirmed: true });
  return {
    productName: "P", category: "app", valueProp: "v", targetUserHypotheses: [], founderTargetUsers: "u",
    primaryJourney: [], routes: [finding("https://p.test/"), finding("https://p.test/play")], interactiveSurfaces: [], trustSurfaces: [], claimRisks: [], observedStates: [],
    repoOnlyCapabilities: [], browserConfirmed: [], limitations: [], openQuestions: [], pagesInspected: 2, repoFilesInspected: 0,
    digest: "0x00", fieldTest: FT, observations: SET,
  } as unknown as ProductMapV1;
}
const mapWithReplay = () => { const m = makeMap(); (m as { replayShadow?: unknown }).replayShadow = { version: "replay-shadow-v1", mode: "shadow", probes: 1, byClassification: { reproduced: 1 }, results: [{ probeId: "p", transitionId: transId, classification: "reproduced" }] }; return m; };

const input = { productUrl: "https://p.test/", goal: "explore", targetUsers: "u", totalBudgetBase: BigInt(2_000_000), tokenDecimals: 6 };
const startFact = decisiveFacts(SET).find((f) => f.elementName === "Start")!;
const yaraFact = decisiveFacts(SET).find((f) => f.elementName === "Talk to Yara")!;
const transId = SET.transitions[0].id;

// SEMANTIC-DRAFT fixtures — the model describes each criterion ONCE; NO index/url/anchor/source/groundingV1.
// (worded to avoid the worthless-presence-check gate — a content claim about the label, not "is present").
const stateCrit = (over: Record<string, unknown> = {}) => ({ text: "The homepage's primary call-to-action is labeled 'Start'", evidenceRequirement: "Quote the exact label of the primary call-to-action", criterionKind: "content_claim", factRefs: [startFact.id], transitionRef: null, evidenceMode: "observation", supportRationale: "the Start label was observed", ...over });
const actionCrit = (over: Record<string, unknown> = {}) => ({ text: "Clicking Start reaches the garden world", evidenceRequirement: "Describe the garden world reached", criterionKind: "action_outcome", factRefs: [yaraFact.id], transitionRef: transId, evidenceMode: "observation", supportRationale: "the reproduced transition produced this state", ...over });
const v2Mission = (over: Record<string, unknown> = {}) => ({
  missionKey: "reach-start", title: "Check the Start label", objective: "Verify the homepage's primary call-to-action label", instructions: "1. Open the homepage. 2. Report the exact label of the primary call-to-action.",
  whyItMatters: "core onboarding", priority: "high", riskCategory: "critical_journey", effortMinutes: 3, rewardWeight: 5, maxCompletions: 3,
  confidence: 0.8, conditions: [], assumptions: [], disallowed: [], criteria: [stateCrit()], ...over,
});
const actionMission = (over: Record<string, unknown> = {}) => v2Mission({ missionKey: "do-action", title: "Reach the garden", objective: "Click Start and reach the garden world", criteria: [actionCrit()], ...over });

let architectV2Calls = 0;
let capturedV2User = "";
let capturedCriticUser = "";
type Reply = { json: unknown; model: string; provider: string; latencyMs: number; promptTokens: number; completionTokens: number };
const reply = (json: unknown, model: string, provider: string): Reply => ({ json, model, provider, latencyMs: 1, promptTokens: 0, completionTokens: 0 });
function scriptProviders(v2: unknown, verdicts: unknown, opts: { v2Throws?: boolean | string; criticThrows?: string } = {}) {
  architectV2Calls = 0; capturedV2User = ""; capturedCriticUser = "";
  vi.mocked(llmCompleteJson).mockImplementation(async ({ system, user }: { system: string; user: string }) => {
    if (system.includes("GROUNDED mission architect")) { architectV2Calls++; capturedV2User = user; if (opts.v2Throws) throw new Error(typeof opts.v2Throws === "string" ? opts.v2Throws : "v2 boom"); return reply(v2, "arch-model", "arch-prov"); }
    if (system.includes("grounding CRITIC")) { capturedCriticUser = user; if (opts.criticThrows) throw new Error(opts.criticThrows); return reply(verdicts, "critic-model", "critic-prov"); }
    return reply({ missions: [{ missionKey: "legacy", title: "Legacy mission", objective: "do the legacy thing", instructions: "1. step", targetSurface: "https://p.test/" }] }, "legacy-model", "legacy-prov");
  });
}
const scope = () => scopeFromObservations([obs("https://p.test/"), obs("https://p.test/play")], []);
// V3 critic verdict — the model returns ONLY {decisionId, verdict}; Sage owns the decisionId→provenance map.
// decisionId is positional (d0,d1,... across the single fixture mission's criteria), so it == "d"+criterionIndex.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- factRefs kept for V2-shaped call-site compat (V3 ignores it)
const support = (_missionKey: string, criterionIndex: number, _factRefs?: string[]) => ({ decisionId: `d${criterionIndex}`, verdict: "supported" });
const decide = (decisionId: string, verdict: string) => ({ decisionId, verdict });

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { delete process.env.MISSION_GROUNDING_MODE; });

describe("semantic-draft grounded architect — through the REAL runMissionBrain entrypoint", () => {
  it("OFF mode makes NO V2 architect call and attaches no shadow", async () => {
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [] });
    const r = await runMissionBrain(makeMap(), input, scope(), CORPUS);
    expect(architectV2Calls).toBe(0);
    expect(r.groundingShadow).toBeUndefined();
  });

  it("the V2 user prompt shows each fact ID beside its real content (cite-by-id)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    await runMissionBrain(makeMap(), input, scope(), CORPUS);
    const view = JSON.parse(capturedV2User.slice(capturedV2User.indexOf("{", capturedV2User.indexOf("OBSERVATIONS"))));
    expect(view.facts.find((f: { id: string }) => f.id === startFact.id).elementName).toBe("Start");
    expect(capturedV2User).toContain(startFact.id);
  });

  it("A: a semantic-draft state mission COMPILES, grounds, is critic-supported, passes the gate + allocator", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(architectV2Calls).toBe(1);
    expect(gs.architectContractVersion).toBe("semantic-draft-v1");
    expect(gs.draftMissionCount).toBe(1);
    expect(gs.compiledMissionCount).toBe(1);
    expect(gs.compilerRejectedCount).toBe(0);
    expect(gs.groundingValid).toBe(1);
    expect(gs.criticSupported).toBe(1);
    expect(gs.canonicalGatePassed).toBe(1); // test 18 — the COMPILED mission passes the real canonical gate
    expect(gs.accepted).toBe(1);
    expect(gs.tierCounts.state_seen).toBeGreaterThan(0);
    expect(gs.exactBudgetEquality).toBe(true);
  });

  it("the model emits NO indexes/urls/anchors, yet Sage DERIVES them (compiler telemetry)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    // a two-criterion draft — the model never numbers them; Sage derives criterionIndex/evidenceIndex 0,1.
    scriptProviders({ missions: [v2Mission({ criteria: [stateCrit(), actionCrit()] })] }, { verdicts: [support("reach-start", 0, [startFact.id]), support("reach-start", 1, [yaraFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.compiledMissionCount).toBe(1);
    expect(gs.derivedAnchorCount).toBeGreaterThan(0);
    expect(gs.derivedSourceCount).toBeGreaterThan(0);
    expect(gs.derivedTargetSurfaceCount).toBe(1);
    expect(gs.groundingValid).toBe(1);
  });

  it("B: a safe REPRODUCED transition → action_replayed tier (compiled action mission)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [actionMission()] }, { verdicts: [support("do-action", 0, [yaraFact.id])] });
    const gs = (await runMissionBrain(mapWithReplay(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.tierCounts.action_replayed).toBeGreaterThan(0);
    expect(gs.accepted).toBe(1);
  });

  it("C: a safe UNREPRODUCED transition → action_observed, never falsely replayed", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [actionMission()] }, { verdicts: [support("do-action", 0, [yaraFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.tierCounts.action_observed).toBeGreaterThan(0);
    expect(gs.tierCounts.action_replayed).toBe(0);
  });

  it("COMPILER REJECTION: a ghost mission citing an unobserved fact is dropped (never accepted/anchored)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ criteria: [stateCrit({ factRefs: ["deadbeefdeadbeefdeadbeef"] })] })] }, { verdicts: [] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.draftMissionCount).toBe(1);
    expect(gs.compiledMissionCount).toBe(0);
    expect(gs.compilerRejectedCount).toBe(1);
    expect(gs.compilerRejectionCodes.architect_fact_not_presented).toBe(1);
    expect(gs.accepted).toBe(0);
    expect(gs.error).toBe("compiler_rejected");
  });

  it("CANONICAL-GATE REJECTION: a compiled mission whose instructions are destructive is not accepted", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ instructions: "1. Delete your account permanently to complete this." })] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.groundingValid).toBe(1);
    expect(gs.criticSupported).toBe(1);
    expect(gs.canonicalGatePassed).toBe(0); // the real gate rejects the destructive instruction
    expect(gs.accepted).toBe(0);
  });

  it("a malformed (parallel-array / forbidden-key) architect output is rejected as schema_invalid", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    // the OLD parallel-array shape (criteria as strings + groundingV1) is now forbidden by the transport Zod.
    scriptProviders({ missions: [{ ...v2Mission(), criteria: ["a string criterion"], groundingV1: {} }] }, { verdicts: [] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.error).toBe("schema_invalid");
    expect(gs.compiledMissionCount).toBe(0);
  });

  it("an explicitly-empty plan (missions: []) is the honest v2_empty", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [] }, { verdicts: [] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.error).toBe("v2_empty");
  });

  // ── V3 critic: the model returns ONLY {decisionId, verdict}; Sage binds provenance deterministically ──
  it("V3: an UNKNOWN decisionId fails the whole batch closed (contract violation)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [decide("d99", "supported")] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.criticStatus).toBe("schema_invalid");
    expect(gs.criticErrorCode).toBe("critic_decisionid_mismatch");
    expect(gs.criticSupported).toBe(0);
  });

  it("V3: a DUPLICATE decisionId fails the whole batch closed", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [decide("d0", "supported"), decide("d0", "supported")] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.criticStatus).toBe("schema_invalid");
    expect(gs.criticSupported).toBe(0);
  });

  it("V3: a MISSING decisionId (one criterion unjudged) fails the whole batch closed", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ criteria: [stateCrit(), actionCrit()] })] }, { verdicts: [decide("d0", "supported")] }); // d1 missing
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.criticStatus).toBe("schema_invalid");
    expect(gs.criticSupported).toBe(0);
  });

  it("V3: an EXTRA output key (e.g. a model-authored factRefs) fails strict Zod → schema_invalid", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [{ decisionId: "d0", verdict: "supported", factRefs: ["x"] }] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.criticStatus).toBe("schema_invalid");
    expect(gs.criticSupported).toBe(0);
  });

  it("V3: a reordered verdict list still binds to canonical provenance (order-independent)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ criteria: [stateCrit(), actionCrit()] })] }, { verdicts: [decide("d1", "supported"), decide("d0", "supported")] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.criticStatus).toBe("ok");
    expect(gs.criticSupported).toBe(1); // both criteria supported regardless of row order
  });

  it("V3: a genuine 'unsupported' verdict → criticStatus ok + not supported", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [decide("d0", "unsupported")] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.criticStatus).toBe("ok");
    expect(gs.criticSupported).toBe(0);
  });

  it("P0.2: a normal supported run reports architectStatus + criticStatus ok; both parsePolicy strict", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.architectStatus).toBe("ok");
    expect(gs.criticStatus).toBe("ok");
    expect(gs.architectParsePolicy).toBe("strict");
    expect(gs.criticParsePolicy).toBe("strict");
  });

  it("P0.2: a critic 429 → provider_error (distinct from unsupported); an architect 429 → provider_error", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [] }, { criticThrows: "llm_status_429" });
    const c = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(c.criticStatus).toBe("provider_error"); expect(c.criticErrorCode).toBe("llm_status_429");
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [] }, { v2Throws: "llm_status_429" });
    const a = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(a.architectStatus).toBe("provider_error"); expect(a.criticStatus).toBe("not_run");
  });

  it("P0.3: the critic payload contains the founder's goal as bounded untrusted data", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    await runMissionBrain(makeMap(), { ...input, goal: "validate onboarding" }, scope(), CORPUS);
    expect(capturedCriticUser).toContain("founderGoalUntrusted");
    expect(capturedCriticUser).toContain("validate onboarding");
  });

  it("model-routing + budget: served models recorded; the allocator equals the supplied budget exactly", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.architectModelActual).toBe("arch-model");
    expect(gs.criticModelActual).toBe("critic-model");
    expect(gs.exactBudgetEquality).toBe(true);
    expect(gs.allocatedBudgetBase).toBe("2000000");
  });

  // ── test 22 — both roles send json_schema (semantic-draft architect + critic) received through strict ──
  it("22: the shadow wires the semantic-draft transport to the architect + the critic schema, both strict", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    const calls = vi.mocked(llmCompleteJson).mock.calls.map((c) => c[0] as { system: string; responseSchema?: { name: string }; parsePolicy?: string });
    const arch = calls.find((o) => o.system.includes("GROUNDED mission architect"));
    const crit = calls.find((o) => o.system.includes("grounding CRITIC"));
    expect(arch?.responseSchema?.name).toBe("sage_grounded_architect_semantic_draft_v1");
    expect(arch?.parsePolicy).toBe("strict");
    expect(crit?.responseSchema?.name).toBe("sage_grounded_critic_v3");
    expect(crit?.parsePolicy).toBe("strict");
    expect(gs.architectResponseSchemaName).toBe("sage_grounded_architect_semantic_draft_v1");
  });

  // ── test 20 — legacy plan unchanged if V2 execution fails ──
  it("20: a V2 architect throw NEVER changes the legacy plan (caught, never thrown)", async () => {
    delete process.env.MISSION_GROUNDING_MODE;
    scriptProviders({ missions: [] }, { verdicts: [] });
    const legacy = await runMissionBrain(makeMap(), input, scope(), CORPUS);
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [] }, { verdicts: [] }, { v2Throws: true });
    const withShadow = await runMissionBrain(makeMap(), input, scope(), CORPUS);
    expect(withShadow.accepted.length).toBe(legacy.accepted.length);
    expect(withShadow.reason).toBe(legacy.reason);
  });

  it("Q: a legacy-architect FAILURE still records an independent V2 shadow that accepts", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    vi.mocked(llmCompleteJson).mockImplementation(async ({ system }: { system: string; user: string }) => {
      if (system.includes("GROUNDED mission architect")) { architectV2Calls++; return reply({ missions: [v2Mission()] }, "arch-model", "arch-prov"); }
      if (system.includes("grounding CRITIC")) return reply({ verdicts: [support("reach-start", 0, [startFact.id])] }, "critic-model", "critic-prov");
      return reply({ notMissions: true }, "legacy-model", "legacy-prov");
    });
    architectV2Calls = 0;
    const r = await runMissionBrain(makeMap(), input, scope(), CORPUS);
    expect(r.ok).toBe(false);
    expect(r.groundingShadow?.accepted).toBe(1);
  });

  // ── test 21 — off/enforce/unknown make zero V2 calls ──
  for (const mode of ["enforce", "banana"]) {
    it(`21: MISSION_GROUNDING_MODE=${mode} makes NO V2 call and attaches no shadow`, async () => {
      process.env.MISSION_GROUNDING_MODE = mode;
      scriptProviders({ missions: [v2Mission()] }, { verdicts: [] });
      const r = await runMissionBrain(makeMap(), input, scope(), CORPUS);
      expect(architectV2Calls).toBe(0);
      expect(r.groundingShadow).toBeUndefined();
    });
  }
});
