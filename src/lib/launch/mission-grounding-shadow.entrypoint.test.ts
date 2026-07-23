import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fake ONLY the external provider boundary. runMissionBrain (the real entrypoint) + its architect/critic/
// gate + runGroundedShadow (strict Zod parse → digest-bound grounding → critic → the SAME canonical gate the
// legacy plan uses → real allocator) all run for real; llmCompleteJson returns scripted JSON keyed by system.
vi.mock("@/lib/llm/complete", () => ({ llmConfigured: () => true, llmCompleteJson: vi.fn() }));

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
// the corpus is normalized (lowercased) exactly as the real pipeline builds it, so verbatim anchors match.
const CORPUS = "welcome start you reach the garden world talk to yara";
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

/** a valid RAW architect grounding criterion (full V2 fields) — overridable per case. */
const stateCriterion = (over: Record<string, unknown> = {}) => ({ criterionIndex: 0, criterionKind: "state", factRefs: [startFact.id], evidenceIndex: 0, evidenceMode: "observation", pageUrl: startFact.pageUrl, stateId: startFact.stateId, supportRationale: "the Start control was seen", ...over });
const actionCriterion = (over: Record<string, unknown> = {}) => ({ criterionIndex: 0, criterionKind: "action_outcome", factRefs: [yaraFact.id], transitionRef: transId, evidenceIndex: 0, evidenceMode: "observation", pageUrl: yaraFact.pageUrl, stateId: yaraFact.stateId, supportRationale: "reached the garden world", ...over });

/** a fully-valid RAW V2 architect mission (passes Zod + grounding + canonical gate). */
const v2Mission = (over: Record<string, unknown> = {}) => ({
  missionKey: "reach-start", title: "Click Start", objective: "Click Start to reach the world",
  instructions: "1. Open the page. 2. Click the Start button. 3. Observe the world you reach.",
  targetSurface: "https://p.test/play", criteria: ["Reach the world after clicking Start"],
  evidenceRequirements: ["Describe the world state you reached after clicking Start"],
  whyItMatters: "core onboarding", sources: [{ kind: "page", ref: "https://p.test/play", observation: "world" }],
  priority: "high", riskCategory: "critical_journey", effortMinutes: 3, rewardWeight: 5, maxCompletions: 3,
  verificationMethod: "account", confidence: 0.8, conditions: [], assumptions: [], disallowed: [], anchors: ["Start"],
  groundingV1: { observationSetDigest: SET.digest, criteria: [stateCriterion()] },
  ...over,
});
const actionMission = (over: Record<string, unknown> = {}) => v2Mission({
  missionKey: "do-action", title: "Reach the garden", objective: "Click Start and reach the garden world",
  criteria: ["The garden world appears after clicking Start"], evidenceRequirements: ["Describe the garden world you reached"],
  anchors: ["garden world"], groundingV1: { observationSetDigest: SET.digest, criteria: [actionCriterion()] }, ...over,
});

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
    // legacy architect/critic → a coercible mission so runMissionBrain reaches the shadow block regardless.
    return reply({ missions: [{ missionKey: "legacy", title: "Legacy mission", objective: "do the legacy thing", instructions: "1. step", targetSurface: "https://p.test/" }] }, "legacy-model", "legacy-prov");
  });
}
const scope = () => scopeFromObservations([obs("https://p.test/"), obs("https://p.test/play")], []);
const support = (missionKey: string, criterionIndex: number, factRefs: string[]) => ({ missionKey, criterionIndex, verdict: "supported", factRefs });

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { delete process.env.MISSION_GROUNDING_MODE; });

describe("grounded architect LIVE-TRUTH shadow — through the REAL runMissionBrain entrypoint", () => {
  it("S: OFF mode makes NO V2 architect call and attaches no shadow", async () => {
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [] });
    const r = await runMissionBrain(makeMap(), input, scope(), CORPUS);
    expect(architectV2Calls).toBe(0);
    expect(r.groundingShadow).toBeUndefined();
  });

  it("the V2 user prompt shows each fact ID BESIDE its real content (not opaque hashes)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    await runMissionBrain(makeMap(), input, scope(), CORPUS);
    const view = JSON.parse(capturedV2User.slice(capturedV2User.indexOf("{", capturedV2User.indexOf("OBSERVATIONS"))));
    const sf = view.facts.find((f: { id: string }) => f.id === startFact.id);
    expect(sf.elementName).toBe("Start"); // the id sits next to its observed control
    const trans = view.transitions.find((t: { verb: string }) => t.verb === "click");
    expect(trans.addedTexts.join(" ")).toMatch(/garden world/); // transition id → click Start → added "…garden world"
  });

  it("A: a grounded mission passes ALL stages — grounding, critic, the canonical gate, and the allocator", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const r = await runMissionBrain(makeMap(), input, scope(), CORPUS);
    const gs = r.groundingShadow!;
    expect(architectV2Calls).toBe(1);
    expect(gs.candidateCount).toBe(1);
    expect(gs.groundingValid).toBe(1);
    expect(gs.criticSupported).toBe(1);
    expect(gs.canonicalGatePassed).toBe(1);
    expect(gs.accepted).toBe(1);
    expect(gs.acceptanceScope).toBe("canonical_gate");
    expect(gs.tierCounts.state_seen).toBeGreaterThan(0);
  });

  it("O: the real allocator over canonical-gate-passing candidates equals the supplied budget EXACTLY", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.budgetCompiled).toBe(true);
    expect(gs.allocationOk).toBe(true);
    expect(gs.exactBudgetEquality).toBe(true);
    expect(gs.budgetConsistent).toBe(true);
    expect(gs.allocatedBudgetBase).toBe("2000000");
  });

  it("positive MULTI-criterion mission passes all stages (each criterion its own in-range evidenceIndex)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    const multi = v2Mission({
      missionKey: "multi", criteria: ["Reach the world after clicking Start", "See Yara in the garden world"],
      evidenceRequirements: ["Describe the world you reached", "Quote what Yara says to you"], anchors: ["start", "garden world"],
      groundingV1: { observationSetDigest: SET.digest, criteria: [stateCriterion({ criterionIndex: 0 }), { criterionIndex: 1, criterionKind: "state", factRefs: [yaraFact.id], evidenceIndex: 1, evidenceMode: "observation", pageUrl: yaraFact.pageUrl, stateId: yaraFact.stateId, supportRationale: "Yara seen in the world" }] },
    });
    scriptProviders({ missions: [multi] }, { verdicts: [support("multi", 0, [startFact.id]), support("multi", 1, [yaraFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.groundingValid).toBe(1);
    expect(gs.criticSupported).toBe(1);
    expect(gs.accepted).toBe(1);
  });

  it("B: a safe REPRODUCED transition → action_replayed tier (and passes the canonical gate)", async () => {
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

  it("TIER: a STATE criterion that also cites a safe transition stays state_seen (not action_observed)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ groundingV1: { observationSetDigest: SET.digest, criteria: [stateCriterion({ transitionRef: transId })] } })] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.tierCounts.state_seen).toBeGreaterThan(0);
    expect(gs.tierCounts.action_observed).toBe(0);
  });

  it("CANONICAL-GATE REJECTION: a grounded, critic-supported mission out of scope is NOT accepted or budgeted", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ targetSurface: "https://elsewhere.test/x" })] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.groundingValid).toBe(1); // grounding + critic both pass...
    expect(gs.criticSupported).toBe(1);
    expect(gs.canonicalGatePassed).toBe(0); // ...but the canonical gate rejects the out-of-scope surface
    expect(gs.accepted).toBe(0);
    expect(gs.budgetCompiled).toBe(false);
  });

  it("D: a GHOST-feature mission (Zod-valid, cites a non-existent fact) fails grounding", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ groundingV1: { observationSetDigest: SET.digest, criteria: [stateCriterion({ factRefs: ["deadbeefdeadbeefdeadbeef"] })] } })] }, { verdicts: [] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.candidateCount).toBe(1); // Zod accepted the shape...
    expect(gs.groundingValid).toBe(0); // ...but the cited fact does not exist in the set
    expect(gs.accepted).toBe(0);
  });

  it("WRONG observationSetDigest fails deterministic grounding", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ groundingV1: { observationSetDigest: "0xWRONGWRONG", criteria: [stateCriterion()] } })] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.groundingValid).toBe(0);
    expect(gs.accepted).toBe(0);
  });

  it("H: an UNVERIFIED/state-changing (POST) transition can never back a criterion", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    const ftPost: FieldTestSummary = { ...FT, states: [
      stt({ trigger: "initial load", visibleTextExcerpt: "Store", notableElements: [{ tag: "button", text: "Buy", role: "button" }] }),
      stt({ trigger: "clicked 'Buy'", url: "https://p.test/bought", visibleTextExcerpt: "Purchase complete.", notableElements: [{ tag: "button", text: "View receipt", role: "button" }], pixelDeltaPct: 30, networkMethods: ["POST"] }),
    ] };
    const setPost = deriveObservations(ftPost);
    const postTrans = setPost.transitions[0];
    const afterFact = setPost.facts.find((f) => f.stateId === postTrans.afterStateDigest)!;
    const mapPost = () => { const m = makeMap(); (m as { observations?: unknown }).observations = setPost; (m as { fieldTest?: unknown }).fieldTest = ftPost; return m; };
    const buyMission = v2Mission({ missionKey: "buy", anchors: ["buy"], targetSurface: "https://p.test/", sources: [{ kind: "page", ref: "https://p.test/", observation: "store" }], groundingV1: { observationSetDigest: setPost.digest, criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", factRefs: [afterFact.id], transitionRef: postTrans.id, evidenceIndex: 0, evidenceMode: "observation", pageUrl: afterFact.pageUrl, stateId: afterFact.stateId, supportRationale: "receipt shown" }] } });
    scriptProviders({ missions: [buyMission] }, { verdicts: [] });
    const gs = (await runMissionBrain(mapPost(), input, scope(), CORPUS)).groundingShadow!;
    expect(postTrans.safeClassification).not.toBe("safe");
    expect(gs.groundingValid).toBe(0);
    expect(gs.unsafeTransitionCount).toBeGreaterThan(0);
  });

  it("model-routing TRUTH: requested (null, unset) vs the actual model+provider served for BOTH calls", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.architectModelRequested).toBeNull(); // MISSION_MODEL unset → resolveLlm default chain
    expect(gs.criticModelRequested).toBeNull();
    expect(gs.architectModelActual).toBe("arch-model");
    expect(gs.architectProvider).toBe("arch-prov");
    expect(gs.criticModelActual).toBe("critic-model");
    expect(gs.criticProvider).toBe("critic-prov");
  });

  it("observation-view completeness metadata is recorded", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.observationView.totalFacts).toBeGreaterThan(0);
    expect(gs.observationView.includedFacts).toBeGreaterThan(0);
    expect(gs.observationView.truncated).toBe(false); // the tiny set fits under the cap
  });

  // ── strict Zod ARCHITECT schema — one invalid mission/member rejects the WHOLE response (schema_invalid) ──
  const schemaRejects: Array<[string, Record<string, unknown>]> = [
    ["rewardWeight 0", { rewardWeight: 0 }],
    ["rewardWeight 11", { rewardWeight: 11 }],
    ["maxCompletions 0", { maxCompletions: 0 }],
    ["maxCompletions 51", { maxCompletions: 51 }],
    ["empty criteria", { criteria: [] }],
    ["empty evidenceRequirements", { evidenceRequirements: [] }],
    ["missing anchors", { anchors: [] }],
    ["invalid criterionKind", { groundingV1: { observationSetDigest: SET.digest, criteria: [stateCriterion({ criterionKind: "bogus" })] } }],
    ["missing criterionKind", { groundingV1: { observationSetDigest: SET.digest, criteria: [{ criterionIndex: 0, factRefs: [startFact.id], evidenceIndex: 0, evidenceMode: "observation", pageUrl: startFact.pageUrl, stateId: startFact.stateId, supportRationale: "x" }] } }],
    ["duplicate factRefs", { groundingV1: { observationSetDigest: SET.digest, criteria: [stateCriterion({ factRefs: [startFact.id, startFact.id] })] } }],
    ["mixed-invalid factRefs member", { groundingV1: { observationSetDigest: SET.digest, criteria: [stateCriterion({ factRefs: [startFact.id, 123] })] } }],
    ["empty factRefs", { groundingV1: { observationSetDigest: SET.digest, criteria: [stateCriterion({ factRefs: [] })] } }],
    ["missing observationSetDigest", { groundingV1: { criteria: [stateCriterion()] } }],
    ["action_outcome without transitionRef", { groundingV1: { observationSetDigest: SET.digest, criteria: [actionCriterion({ transitionRef: undefined })] } }],
    ["unknown top-level key", { extraKey: "x" }],
    ["evidenceIndex out of range", { groundingV1: { observationSetDigest: SET.digest, criteria: [stateCriterion({ evidenceIndex: 5 })] } }],
  ];
  for (const [name, over] of schemaRejects) {
    it(`schema REJECTS the whole response (never repaired): ${name}`, async () => {
      process.env.MISSION_GROUNDING_MODE = "shadow";
      scriptProviders({ missions: [v2Mission(over)] }, { verdicts: [] });
      const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
      expect(gs.error).toBe("schema_invalid");
      expect(gs.candidateCount).toBe(0);
      expect(gs.accepted).toBe(0);
    });
  }

  it("DUPLICATE mission keys reject the whole response", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ missionKey: "dup" }), v2Mission({ missionKey: "dup", title: "Other" })] }, { verdicts: [] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.error).toBe("schema_invalid");
  });

  it("malformed (non-object) V2 output is NOT repaired → schema_invalid", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders("```json\n{\"missions\":[]}\n```" as unknown, { verdicts: [] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.error).toBe("schema_invalid");
  });

  it("an explicitly-empty plan (missions: []) is recorded honestly as v2_empty", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [] }, { verdicts: [] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.error).toBe("v2_empty");
  });

  // ── strict CRITIC schema ──
  it("critic MISSING factRefs supports nothing (schema requires factRefs)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [{ missionKey: "reach-start", criterionIndex: 0, verdict: "supported" }] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.groundingValid).toBe(1);
    expect(gs.criticSupported).toBe(0);
    expect(gs.accepted).toBe(0);
  });

  it("critic factRefs NOT matching the cited set supports nothing (fail closed)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, ["deadbeefdeadbeefdeadbeef"])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.groundingValid).toBe(1);
    expect(gs.criticSupported).toBe(0);
    expect(gs.accepted).toBe(0);
  });

  it("DUPLICATE critic verdicts for one criterion support nothing (exactly one per pair)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id]), support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.criticSupported).toBe(0);
    expect(gs.accepted).toBe(0);
  });

  // ── independence + honest modes ──
  it("Q: a legacy-architect FAILURE still records an independent V2 shadow that accepts", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    vi.mocked(llmCompleteJson).mockImplementation(async ({ system }: { system: string; user: string }) => {
      if (system.includes("GROUNDED mission architect")) { architectV2Calls++; return reply({ missions: [v2Mission()] }, "arch-model", "arch-prov"); }
      if (system.includes("grounding CRITIC")) return reply({ verdicts: [support("reach-start", 0, [startFact.id])] }, "critic-model", "critic-prov");
      return reply({ notMissions: true }, "legacy-model", "legacy-prov"); // legacy → 0 missions → arch.ok false
    });
    architectV2Calls = 0;
    const r = await runMissionBrain(makeMap(), input, scope(), CORPUS);
    expect(r.ok).toBe(false); // legacy failed
    expect(r.groundingShadow?.ran).toBe(true); // ...but V2 was measured independently
    expect(r.groundingShadow?.accepted).toBe(1);
  });

  it("R: a V2 architect throw NEVER changes the legacy plan (and is caught, never thrown)", async () => {
    delete process.env.MISSION_GROUNDING_MODE;
    scriptProviders({ missions: [] }, { verdicts: [] });
    const legacy = await runMissionBrain(makeMap(), input, scope(), CORPUS);
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [] }, { verdicts: [] }, { v2Throws: true });
    const withShadow = await runMissionBrain(makeMap(), input, scope(), CORPUS);
    expect(withShadow.accepted.length).toBe(legacy.accepted.length);
    expect(withShadow.reason).toBe(legacy.reason);
    expect(withShadow.groundingShadow === undefined || withShadow.groundingShadow.error !== null).toBe(true);
  });

  it("P: MISSION_GROUNDING_MODE=enforce makes NO V2 call and attaches no shadow (never pretends)", async () => {
    process.env.MISSION_GROUNDING_MODE = "enforce";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [] });
    const r = await runMissionBrain(makeMap(), input, scope(), CORPUS);
    expect(architectV2Calls).toBe(0);
    expect(r.groundingShadow).toBeUndefined();
  });

  // ── P0.1 — critic factRefs canonical (sorted-unique) equality ──
  const twoFactMission = () => v2Mission({ groundingV1: { observationSetDigest: SET.digest, criteria: [stateCriterion({ factRefs: [startFact.id, yaraFact.id] })] } });

  it("P0.1: critic returning DUPLICATE factRefs [a,a] against cited [a,b] fails closed (schema rejects dups)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [twoFactMission()] }, { verdicts: [support("reach-start", 0, [startFact.id, startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.groundingValid).toBe(1);
    expect(gs.criticStatus).toBe("schema_invalid"); // [a,a] violates the uniqueness refine
    expect(gs.criticSupported).toBe(0);
    expect(gs.accepted).toBe(0);
  });

  it("P0.1: critic returning REORDERED factRefs [b,a] equals cited [a,b] (order-independent) → supported", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [twoFactMission()] }, { verdicts: [support("reach-start", 0, [yaraFact.id, startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.criticStatus).toBe("ok");
    expect(gs.criticSupported).toBe(1);
    expect(gs.accepted).toBe(1);
  });

  // ── P0.2 — bounded execution-status telemetry (a 429 is distinguishable from a genuine unsupported) ──
  it("P0.2: a normal supported run reports architectStatus + criticStatus 'ok' with per-role metadata", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.architectStatus).toBe("ok");
    expect(gs.criticStatus).toBe("ok");
    expect(gs.architectParsePolicy).toBe("strict");
    expect(gs.criticParsePolicy).toBe("strict");
    expect(gs.architectLatencyMs).not.toBeNull();
  });

  it("P0.2: a critic PROVIDER error (429) → criticStatus provider_error + bounded errorCode (NOT unsupported)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [] }, { criticThrows: "llm_status_429" });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.architectStatus).toBe("ok"); // architect succeeded — the probe is distinct from the critic
    expect(gs.criticStatus).toBe("provider_error");
    expect(gs.criticErrorCode).toBe("llm_status_429");
    expect(gs.criticSupported).toBe(0);
  });

  it("P0.2: a genuine UNSUPPORTED verdict → criticStatus 'ok' + criticSupported 0 (distinct from provider_error)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [{ missionKey: "reach-start", criterionIndex: 0, verdict: "unsupported", factRefs: [startFact.id] }] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.criticStatus).toBe("ok"); // the call succeeded...
    expect(gs.criticErrorCode).toBeNull();
    expect(gs.criticSupported).toBe(0); // ...it just judged the mission unsupported
  });

  it("P0.2: an architect PROVIDER error → architectStatus provider_error (bounded code)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [] }, { v2Throws: "llm_status_429" });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.architectStatus).toBe("provider_error");
    expect(gs.architectErrorCode).toBe("llm_status_429");
    expect(gs.criticStatus).toBe("not_run"); // never reached the critic
  });

  it("P0.2: an architect STRICT-PARSE style error is classified strict_parse_error", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [] }, { v2Throws: "llm_strict_finish_length" });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.architectStatus).toBe("strict_parse_error");
    expect(gs.architectErrorCode).toBe("llm_strict_finish_length");
  });

  // ── P0.3 — goal alignment ──
  it("P0.3: the critic payload contains the founder's goal as bounded untrusted data", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [support("reach-start", 0, [startFact.id])] });
    await runMissionBrain(makeMap(), { ...input, goal: "validate the onboarding claim" }, scope(), CORPUS);
    expect(capturedCriticUser).toContain("founderGoalUntrusted");
    expect(capturedCriticUser).toContain("validate the onboarding claim");
  });

  it("P0.3: a grounded-but-unrelated mission the critic marks unsupported is NOT accepted", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    // the mission is fully grounded (groundingValid 1) but the critic judges it does not advance the goal.
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [{ missionKey: "reach-start", criterionIndex: 0, verdict: "unsupported", factRefs: [startFact.id] }] });
    const gs = (await runMissionBrain(makeMap(), input, scope(), CORPUS)).groundingShadow!;
    expect(gs.groundingValid).toBe(1);
    expect(gs.criticSupported).toBe(0);
    expect(gs.accepted).toBe(0);
  });
});
