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
  groundingV1: { observationSetDigest: SET.digest, criteria: [{ criterionIndex: 0, factRefs: [startId], evidenceMode: "observation", supportRationale: "start seen" }] },
  ...over,
});

let architectV2Calls = 0;
function scriptProviders(v2: unknown, verdicts: unknown, opts: { v2Throws?: boolean } = {}) {
  architectV2Calls = 0;
  vi.mocked(llmCompleteJson).mockImplementation(async ({ system }: { system: string }) => {
    if (system.includes("GROUNDED mission architect")) { architectV2Calls++; if (opts.v2Throws) throw new Error("v2 boom"); return { json: v2, model: "m", provider: "p", latencyMs: 1, promptTokens: 0, completionTokens: 0 }; }
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
});
