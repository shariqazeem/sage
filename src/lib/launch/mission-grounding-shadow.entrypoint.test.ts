import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fake ONLY the external provider boundary. runMissionBrain (the real entrypoint) + its architect/critic/
// gate + runGroundedShadow all run for real; llmCompleteJson returns scripted JSON keyed by system prompt.
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
const input = { productUrl: "https://p.test/", goal: "explore", targetUsers: "u", totalBudgetBase: BigInt(2_000_000), tokenDecimals: 6 };
const startId = decisiveFacts(SET).find((f) => f.elementName === "Start")!.id;

/** a V2 architect mission citing a real fact + the exact digest. */
const v2Mission = (over: Record<string, unknown> = {}) => ({
  missionKey: "reach-start", title: "Click Start", objective: "Click Start to reach the world", instructions: "1. Click Start.",
  targetSurface: "https://p.test/play", criteria: ["Reach the world after clicking Start"], evidenceRequirements: ["Describe the world state"],
  whyItMatters: "core", sources: [{ kind: "page", ref: "https://p.test/play", observation: "world" }], priority: "high", riskCategory: "critical_journey",
  effortMinutes: 3, rewardWeight: 5, maxCompletions: 3, verificationMethod: "account", confidence: 0.8, assumptions: [], disallowed: [],
  groundingV1: { observationSetDigest: SET.digest, criteria: [{ criterionIndex: 0, criterionKind: "state", factRefs: [startId], evidenceIndex: 0, evidenceMode: "observation", supportRationale: "start seen" }] },
  ...over,
});

let architectV2Calls = 0;
let capturedV2User = "";
function scriptProviders(v2: unknown, verdicts: unknown, opts: { v2Throws?: boolean } = {}) {
  architectV2Calls = 0; capturedV2User = "";
  vi.mocked(llmCompleteJson).mockImplementation(async ({ system, user }: { system: string; user: string }) => {
    if (system.includes("GROUNDED mission architect")) { architectV2Calls++; capturedV2User = user; if (opts.v2Throws) throw new Error("v2 boom"); return { json: v2, model: "m", provider: "p", latencyMs: 1, promptTokens: 0, completionTokens: 0 }; }
    if (system.includes("grounding CRITIC")) return { json: verdicts, model: "m", provider: "p", latencyMs: 1, promptTokens: 0, completionTokens: 0 };
    // legacy architect → a coercible mission so arch.ok is true and runMissionBrain reaches the shadow
    // block (the legacy gate may still reject it; the shadow runs regardless and must not change it).
    return { json: { missions: [{ missionKey: "legacy", title: "Legacy mission", objective: "do the legacy thing", instructions: "1. step", targetSurface: "https://p.test/" }] }, model: "m", provider: "p", latencyMs: 1, promptTokens: 0, completionTokens: 0 };
  });
}
const scope = () => scopeFromObservations([obs("https://p.test/"), obs("https://p.test/play")], []);

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { delete process.env.MISSION_GROUNDING_MODE; });

describe("grounded architect shadow — through the REAL runMissionBrain entrypoint", () => {
  it("M: OFF mode makes NO V2 architect call and attaches no shadow", async () => {
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(architectV2Calls).toBe(0);
    expect(r.groundingShadow).toBeUndefined();
  });

  it("the V2 user prompt shows each fact ID BESIDE its real content (not opaque hashes)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [{ missionKey: "reach-start", criterionIndex: 0, verdict: "supported", factRefs: [startId] }] });
    await runMissionBrain(makeMap(), input, scope(), "corpus");
    const view = JSON.parse(capturedV2User.slice(capturedV2User.indexOf("{", capturedV2User.indexOf("OBSERVATIONS"))));
    const startFact = view.facts.find((f: { id: string }) => f.id === startId);
    expect(startFact.elementName).toBe("Start"); // the id sits next to its observed control
    const trans = view.transitions.find((t: { verb: string }) => t.verb === "click");
    expect(trans.addedTexts.join(" ")).toMatch(/garden world/); // transition id → click Start → added "…garden world"
    expect(capturedV2User).toContain(startId);
  });

  it("A: SHADOW runs V2, validates a grounded mission, and the critic supports it", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [{ missionKey: "reach-start", criterionIndex: 0, verdict: "supported" }] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(architectV2Calls).toBe(1);
    expect(r.groundingShadow?.ran).toBe(true);
    expect(r.groundingShadow?.candidateCount).toBe(1);
    expect(r.groundingShadow?.structurallyValid).toBe(1);
    expect(r.groundingShadow?.criticSupported).toBe(1);
    expect(r.groundingShadow?.accepted).toBe(1);
    expect(r.groundingShadow?.tierCounts.state_seen).toBeGreaterThan(0);
  });

  it("D: a GHOST-feature mission (cites a non-existent fact) is not structurally valid", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ groundingV1: { observationSetDigest: SET.digest, criteria: [{ criterionIndex: 0, factRefs: ["deadbeefdeadbeefdeadbeef"], evidenceMode: "observation" }] } })] }, { verdicts: [] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.structurallyValid).toBe(0);
    expect(r.groundingShadow?.accepted).toBe(0);
  });

  it("G: a WRONG observationSetDigest is rejected deterministically", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ groundingV1: { observationSetDigest: "0xWRONG", criteria: [{ criterionIndex: 0, factRefs: [startId], evidenceMode: "observation" }] } })] }, { verdicts: [{ missionKey: "reach-start", criterionIndex: 0, verdict: "supported" }] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.structurallyValid).toBe(0);
  });

  it("L: SHADOW ISOLATION — the V2 path throwing does not change the legacy plan or fail the job", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    // baseline legacy result with the shadow OFF...
    delete process.env.MISSION_GROUNDING_MODE;
    scriptProviders({ missions: [] }, { verdicts: [] });
    const legacy = await runMissionBrain(makeMap(), input, scope(), "corpus");
    // ...now shadow ON but the V2 architect throws.
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [] }, { verdicts: [] }, { v2Throws: true });
    const withShadow = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(withShadow.accepted.length).toBe(legacy.accepted.length); // legacy plan unchanged
    expect(withShadow.reason).toBe(legacy.reason);
    // a thrown V2 architect is caught inside runGroundedShadow → an error result, never an exception.
    expect(withShadow.groundingShadow === undefined || withShadow.groundingShadow.error !== null).toBe(true);
  });

  it("empty V2 output (no candidates) is recorded honestly as v2_empty", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [] }, { verdicts: [] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.error).toBe("v2_empty");
  });

  const transId = SET.transitions[0].id;
  const afterFactId = decisiveFacts(SET).find((f) => f.elementName === "Talk to Yara")!.id;
  const actionMission = () => v2Mission({ missionKey: "do-action", groundingV1: { observationSetDigest: SET.digest, criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", factRefs: [afterFactId], transitionRef: transId, evidenceIndex: 0, evidenceMode: "observation" }] } });
  const mapWithReplay = () => { const m = makeMap(); (m as { replayShadow?: unknown }).replayShadow = { version: "replay-shadow-v1", mode: "shadow", probes: 1, byClassification: { reproduced: 1 }, results: [{ probeId: "p", transitionId: transId, classification: "reproduced" }] }; return m; };

  it("B: a safe REPRODUCED transition → action_replayed tier", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [actionMission()] }, { verdicts: [{ missionKey: "do-action", criterionIndex: 0, verdict: "supported", factRefs: [afterFactId] }] });
    const r = await runMissionBrain(mapWithReplay(), input, scope(), "corpus");
    expect(r.groundingShadow?.tierCounts.action_replayed).toBeGreaterThan(0);
  });

  it("C: a safe UNREPRODUCED transition → action_observed tier (never falsely replayed)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [actionMission()] }, { verdicts: [{ missionKey: "do-action", criterionIndex: 0, verdict: "supported", factRefs: [afterFactId] }] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus"); // no replay record
    expect(r.groundingShadow?.tierCounts.action_observed).toBeGreaterThan(0);
    expect(r.groundingShadow?.tierCounts.action_replayed).toBe(0);
  });

  it("F: a mission with EMPTY factRefs is rejected (never repaired)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ groundingV1: { observationSetDigest: SET.digest, criteria: [{ criterionIndex: 0, criterionKind: "state", factRefs: [], evidenceIndex: 0, evidenceMode: "observation" }] } })] }, { verdicts: [] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.error).toBe("v2_empty"); // coercion dropped it → no candidates
  });

  it("M: malformed (non-object) V2 output is NOT repaired", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders("```json\n{\"missions\":[]}\n```" as unknown, { verdicts: [] }); // a fenced string, not an object
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.error).toBe("v2_empty");
  });

  it("O: budget allocation equals the supplied budget EXACTLY for accepted candidates", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [{ missionKey: "reach-start", criterionIndex: 0, verdict: "supported", factRefs: [startId] }] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.allocationOk).toBe(true);
    expect(r.groundingShadow?.exactBudgetEquality).toBe(true);
    expect(r.groundingShadow?.budgetConsistent).toBe(true);
    expect(r.groundingShadow?.allocatedBudgetBase).toBe(input.totalBudgetBase.toString());
  });

  it("P: MISSION_GROUNDING_MODE=enforce does NOT pretend to enforce (falls closed to off)", async () => {
    process.env.MISSION_GROUNDING_MODE = "enforce";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(architectV2Calls).toBe(0); // no V2 call — enforce is not implemented
    expect(r.groundingShadow).toBeUndefined();
  });

  it("Q: a legacy architect FAILURE still records an independent V2 shadow", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    // legacy architect returns junk (no missions) → arch.ok false → EMPTY, but the V2 shadow still runs.
    vi.mocked(llmCompleteJson).mockImplementation(async ({ system, user }: { system: string; user: string }) => {
      if (system.includes("GROUNDED mission architect")) { architectV2Calls++; capturedV2User = user; return { json: { missions: [v2Mission()] }, model: "m", provider: "p", latencyMs: 1, promptTokens: 0, completionTokens: 0 }; }
      if (system.includes("grounding CRITIC")) return { json: { verdicts: [{ missionKey: "reach-start", criterionIndex: 0, verdict: "supported", factRefs: [startId] }] }, model: "m", provider: "p", latencyMs: 1, promptTokens: 0, completionTokens: 0 };
      return { json: { notMissions: true }, model: "m", provider: "p", latencyMs: 1, promptTokens: 0, completionTokens: 0 }; // legacy → 0
    });
    architectV2Calls = 0;
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.ok).toBe(false); // legacy failed
    expect(r.groundingShadow?.ran).toBe(true); // ...but V2 was measured independently
    expect(r.groundingShadow?.accepted).toBe(1);
  });

  it("D/E: a mission with NO groundingV1, and one with a MISSING digest, are BOTH dropped (never repaired)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    const noGrounding = v2Mission({ missionKey: "no-grounding" });
    delete (noGrounding as { groundingV1?: unknown }).groundingV1;
    const noDigest = v2Mission({ missionKey: "no-digest", groundingV1: { criteria: [{ criterionIndex: 0, criterionKind: "state", factRefs: [startId], evidenceIndex: 0, evidenceMode: "observation" }] } });
    scriptProviders({ missions: [noGrounding, noDigest] }, { verdicts: [] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.error).toBe("v2_empty"); // both coerced to null → zero candidates
  });

  it("G: an action_outcome criterion with NO transition citation is rejected", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission({ missionKey: "do-action", groundingV1: { observationSetDigest: SET.digest, criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", factRefs: [afterFactId], evidenceIndex: 0, evidenceMode: "observation" }] } })] }, { verdicts: [] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.structurallyValid).toBe(0); // criterion_evidence_unmapped (action_outcome cites no transition)
  });

  it("H: an UNVERIFIED/state-changing transition can never back a criterion (unsafe_transition_support)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    const ftPost: FieldTestSummary = { ...FT, states: [
      stt({ trigger: "initial load", visibleTextExcerpt: "Store", notableElements: [{ tag: "button", text: "Buy", role: "button" }] }),
      stt({ trigger: "clicked 'Buy'", url: "https://p.test/bought", visibleTextExcerpt: "Purchase complete.", notableElements: [{ tag: "button", text: "View receipt", role: "button" }], pixelDeltaPct: 30, networkMethods: ["POST"] }),
    ] };
    const setPost = deriveObservations(ftPost);
    const postTrans = setPost.transitions[0];
    const afterFact = setPost.facts.find((f) => f.stateId === postTrans.afterStateDigest)!.id;
    const mapPost = () => { const m = makeMap(); (m as { observations?: unknown }).observations = setPost; (m as { fieldTest?: unknown }).fieldTest = ftPost; return m; };
    scriptProviders({ missions: [v2Mission({ missionKey: "buy", groundingV1: { observationSetDigest: setPost.digest, criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", factRefs: [afterFact], transitionRef: postTrans.id, evidenceIndex: 0, evidenceMode: "observation" }] } })] }, { verdicts: [] });
    const r = await runMissionBrain(mapPost(), input, scope(), "corpus");
    expect(postTrans.safeClassification).not.toBe("safe"); // POST → state_changing
    expect(r.groundingShadow?.structurallyValid).toBe(0);
    expect(r.groundingShadow?.unsafeTransitionCount).toBeGreaterThan(0);
  });

  it("I: an action_outcome citing only the BEFORE-state fact (not the outcome) is rejected", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    // cites startId (the pre-click state) with the click transition — the after-state fact is the real outcome.
    scriptProviders({ missions: [v2Mission({ missionKey: "do-action", groundingV1: { observationSetDigest: SET.digest, criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", factRefs: [startId], transitionRef: transId, evidenceIndex: 0, evidenceMode: "observation" }] } })] }, { verdicts: [] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.structurallyValid).toBe(0); // page_state_mismatch (cites no after-state fact)
  });

  it("J: a critic citing an UNRELATED fact (factRefs ≠ cited) supports nothing (fail closed)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [{ missionKey: "reach-start", criterionIndex: 0, verdict: "supported", factRefs: ["deadbeefdeadbeefdeadbeef"] }] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.structurallyValid).toBe(1); // the mission itself is grounded
    expect(r.groundingShadow?.criticSupported).toBe(0); // ...but the critic's mismatched citation is rejected
    expect(r.groundingShadow?.accepted).toBe(0);
  });

  it("K: DUPLICATE critic verdicts for one criterion are rejected (exactly one per pair)", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    scriptProviders({ missions: [v2Mission()] }, { verdicts: [{ missionKey: "reach-start", criterionIndex: 0, verdict: "supported" }, { missionKey: "reach-start", criterionIndex: 0, verdict: "supported" }] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.criticSupported).toBe(0); // seen===2 → not complete → nothing supported
    expect(r.groundingShadow?.accepted).toBe(0);
  });

  it("N: a MULTI-criterion mission maps each criterion to its own in-range evidenceIndex", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    const multi = v2Mission({
      missionKey: "multi",
      criteria: ["Reach the world", "See Yara greet you"],
      evidenceRequirements: ["Describe the world", "Quote Yara's greeting"],
      groundingV1: { observationSetDigest: SET.digest, criteria: [
        { criterionIndex: 0, criterionKind: "state", factRefs: [startId], evidenceIndex: 0, evidenceMode: "observation" },
        { criterionIndex: 1, criterionKind: "state", factRefs: [afterFactId], evidenceIndex: 1, evidenceMode: "observation" },
      ] },
    });
    scriptProviders({ missions: [multi] }, { verdicts: [
      { missionKey: "multi", criterionIndex: 0, verdict: "supported" },
      { missionKey: "multi", criterionIndex: 1, verdict: "supported" },
    ] });
    const r = await runMissionBrain(makeMap(), input, scope(), "corpus");
    expect(r.groundingShadow?.structurallyValid).toBe(1);
    expect(r.groundingShadow?.accepted).toBe(1);
  });
});
