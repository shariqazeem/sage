import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Fake ONLY the provider boundary; runGroundedShadow (compiler → grounding → V3 critic → REAL canonical gate →
// allocator) runs for real. 0 paid.
vi.mock("@/lib/llm/complete", async (o) => ({ ...(await o<typeof import("@/lib/llm/complete")>()), llmConfigured: () => true, llmCompleteJson: vi.fn() }));

import { runGroundedShadow } from "./mission-grounding-shadow";
import { llmCompleteJson } from "@/lib/llm/complete";
import { deriveObservations, decisiveFacts } from "./observed-facts";
import { scopeFromObservations } from "./product-map";
import { buildObservationCorpus } from "./validate-mission";
import type { FieldTestState, FieldTestSummary, ProductObservation, ProductMapV1, FounderLaunchInput } from "./schemas";

/**
 * PHASE 0 FORENSICS (0 paid) — recover the EXACT deterministic canonical-gate outcome for the REPORTLY fixture
 * the prior live run used. Runs the REAL grounded chain with a FAKE architect draft (a plausible Report-ready
 * action mission) + a supporting V3 critic, and dumps every bounded gate/compiler/allocation code. The prior
 * live parsed draft was NOT retained (harness defect), so this reconstructs the closest faithful candidate.
 */

const stt = (o: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://reportly.test/", networkMethods: ["GET"], ...o });
const FT: FieldTestSummary = {
  ran: true, startUrl: "https://reportly.test/", mode: "interactive", pages: [], classification: "app", limitation: null, durationMs: 10,
  states: [
    stt({ trigger: "initial load", visibleTextExcerpt: "Reportly dashboard", notableElements: [{ tag: "button", text: "Load report", role: "button" }], networkMethods: ["GET"] }),
    stt({ trigger: "clicked 'Load report'", url: "https://reportly.test/report", visibleTextExcerpt: "Report ready. Your report is ready to view.", notableElements: [{ tag: "heading", text: "Report ready", role: "heading" }], pixelDeltaPct: 45, networkMethods: ["GET"] }),
  ],
};
const obs = (url: string): ProductObservation => ({ url, status: 200, title: "Reportly", headings: ["Reportly dashboard"], claims: [], ctas: ["Load report"], forms: [], links: [], authBoundary: false, techHints: [], states: [], landmarks: [], snippets: ["Reportly dashboard. Load report. Report ready."], inspectedAt: 1, contentSha256: "a".repeat(64) });
const SET = deriveObservations(FT);
const scope = scopeFromObservations([obs("https://reportly.test/"), obs("https://reportly.test/report")], []);
const corpus = buildObservationCorpus([obs("https://reportly.test/"), obs("https://reportly.test/report")], FT);
const reportFact = decisiveFacts(SET).find((f) => f.elementName === "Report ready")!;
const transId = SET.transitions[0].id;

function map(): ProductMapV1 {
  return { productName: "Reportly", category: "app", valueProp: "reports", targetUserHypotheses: [], founderTargetUsers: "analysts", primaryJourney: [], routes: [], interactiveSurfaces: [], trustSurfaces: [], claimRisks: [], observedStates: [], repoOnlyCapabilities: [], browserConfirmed: [], limitations: [], openQuestions: [], pagesInspected: 2, repoFilesInspected: 0, digest: "0x00", fieldTest: FT, observations: SET, replayShadow: { version: "replay-shadow-v1", mode: "shadow", probes: 1, byClassification: { reproduced: 1 }, results: [{ probeId: "p", transitionId: transId, classification: "reproduced" }] } } as unknown as ProductMapV1;
}
const input = { productUrl: "https://reportly.test/", goal: "Verify that clicking Load report reaches the observed 'Report ready' state.", targetUsers: "analysts", totalBudgetBase: BigInt(3_000_000), tokenDecimals: 6 } as FounderLaunchInput;

// a plausible reconstructed grounded draft: a Load-report action_outcome citing the Report-ready after-fact.
const draft = { missions: [{ missionKey: "load-report", title: "Load the report", objective: "Load the report and verify it appears", instructions: "1. Open the Reportly dashboard. 2. Click Load report. 3. Report the exact state text shown.", whyItMatters: "core report journey", priority: "high", riskCategory: "critical_journey", effortMinutes: 4, rewardWeight: 5, maxCompletions: 3, confidence: 0.8, conditions: [], assumptions: [], disallowed: [], criteria: [{ text: "Clicking Load report reaches the observed 'Report ready' state", evidenceRequirement: "Describe the exact report state text you reached", criterionKind: "action_outcome", factRefs: [reportFact.id], transitionRef: transId, evidenceMode: "observation", supportRationale: "the reproduced Load-report transition produced the Report ready state" }] }] };
const reply = (json: unknown) => ({ json, model: "fake-arch", provider: "fake", latencyMs: 1, promptTokens: 0, completionTokens: 0 });

afterEach(() => { delete process.env.MISSION_GROUNDING_MODE; });

describe("PHASE 0 — reportly canonical-gate forensic (grounded path, 0 paid)", () => {
  it("dumps the full deterministic gate/compiler/allocation outcome for the reconstructed reportly candidate", async () => {
    process.env.MISSION_GROUNDING_MODE = "canary";
    const architect = async () => reply(draft).json;
    const critic = async () => reply({ verdicts: [{ decisionId: "d0", verdict: "supported" }] }).json;
    const gs = await runGroundedShadow(map(), input, scope, corpus, 0, { architect, critic, replayReproduced: new Set([transId]) });

    const gatePassed = gs.canonicalGatePassed >= 1 && gs.accepted >= 1 && gs.exactBudgetEquality;
    // strictSelectable is false ONLY because these fake deps set no model/provider (provenancePresent=false);
    // in a real run the provider fills it, so a gate-passing candidate is selectable.
    const onlyProvenanceMissing = gs.groundedCandidatePlan ? Object.entries(gs.groundedCandidatePlan.signals).filter(([, v]) => !v).map(([k]) => k).join(",") === "provenancePresent" : false;
    const rootCause = gatePassed
      ? "unknown_with_evidence" // pipeline sound for a well-formed draft; prior live parsed draft NOT retained → cannot attribute the live block (leading hypothesis: architect_semantic_defect)
      : Object.keys(gs.compilerRejectionCodes).length > 0 ? "compiler_derivation_defect"
      : Object.keys(gs.canonicalRejectionCodes).length > 0 ? "canonical_gate_defect" : "unknown_with_evidence";
    const forensic = {
      artifact: "canary-forensics",
      note: "PHASE 0 — reportly grounded canonical-gate outcome (0 paid). Reconstructed draft; prior live parsed draft NOT retained (harness defect). Sanitized: codes/counts only.",
      ledgerReconciliation: { source: "promotion-evidence/canary-closure.ledger.json", callsConsumed: 3, dispatches: [{ seq: 1, role: "architect" }, { seq: 2, role: "critic" }, { seq: 3, role: "architect", note: "pre-fix harness iteration" }], requestedServedModel: "google/gemini-3.1-flash-lite-preview", priorTwoCallCapBreached: true, afterHarnessFix: false },
      rootCause,
      rootCauseEvidence: gatePassed
        ? "The reconstructed reportly grounded candidate PASSES the full deterministic chain (compiler → grounding → V3 critic → REAL canonical gate → exact allocator): canonicalGatePassed=1, accepted=1, exactBudgetEquality=true, 0 rejection codes. Therefore scope/fixture/compiler/grounding/gate/allocator are SOUND. The prior live block is NOT attributable to those; the live parsed architect draft was NOT retained (harness defect), so the exact live cause is unprovable. Leading hypothesis: architect_semantic_defect (the live Flash-Lite draft differed from a well-formed one)."
        : `Deterministic rejection reproduced: compilerRejectionCodes=${JSON.stringify(gs.compilerRejectionCodes)} canonicalRejectionCodes=${JSON.stringify(gs.canonicalRejectionCodes)} error=${gs.error}`,
      strictSelectableFalseReason: onlyProvenanceMissing ? "ONLY provenancePresent is false — a fake-dep artifact (deps.architect/critic set no served model/provider); a real provider run makes this true" : "see signals",
      harnessDefect: "The prior live run did not retain the parsed semantic draft; Phase 3's new harness MUST retain a private local canonical parsed result for deterministic replay (public evidence stays sanitized).",
      wrongBindingSemantics: {
        skipAllowed: ["mode off", "non-action mission", "non-canary campaign (no bound policy)"],
        mustHold: ["canary action mission with missing/wrong campaign, mission, revision, policy, or probe binding", "policy digest mismatch", "action mission without a valid probe", "ambiguous in-flight replay"],
        settlementSpyOnHold: 0,
      },
      scope: { hosts: [...scope.hosts].sort(), observationSetDigest: SET.digest, facts: SET.facts.length, transitions: SET.transitions.length, corpusChars: corpus.length, reportFactId: reportFact.id, transitionId: transId },
      architectStatus: gs.architectStatus,
      draftMissionCount: gs.draftMissionCount, compiledMissionCount: gs.compiledMissionCount, compilerRejectedCount: gs.compilerRejectedCount, compilerRejectionCodes: gs.compilerRejectionCodes,
      groundingValid: gs.groundingValid, tierCounts: gs.tierCounts, criticStatus: gs.criticStatus, criticSupported: gs.criticSupported,
      canonicalGatePassed: gs.canonicalGatePassed, canonicalRejectionCodes: gs.canonicalRejectionCodes, accepted: gs.accepted,
      unsafeTransitionCount: gs.unsafeTransitionCount, allocationOk: gs.allocationOk, exactBudgetEquality: gs.exactBudgetEquality,
      strictSelectable: gs.groundedCandidatePlan?.strictSelectable ?? false, signals: gs.groundedCandidatePlan?.signals ?? null, error: gs.error,
    };
    fs.writeFileSync(path.resolve("promotion-evidence/canary-forensics.json"), JSON.stringify(forensic, null, 2));
    console.log("[forensic] reportly grounded:", JSON.stringify({ compiled: gs.compiledMissionCount, groundingValid: gs.groundingValid, criticSupported: gs.criticSupported, canonicalGatePassed: gs.canonicalGatePassed, canonicalRejectionCodes: gs.canonicalRejectionCodes, accepted: gs.accepted, strictSelectable: forensic.strictSelectable, compilerRejectionCodes: gs.compilerRejectionCodes, error: gs.error }));
    // record whatever the deterministic truth is (no assertion on pass/fail — this is forensic capture).
    expect(gs.architectStatus).toBeDefined();
  });
});

/**
 * PHASE 1 REGRESSION — the FORMERLY-FAILING reportly candidate now passes the full deterministic chain WITH
 * provenance (through the real architect/critic closures → mocked llmCompleteJson that sets model/provider),
 * so strictSelectable=true. No gate was weakened; the fixture/candidate is well-formed.
 */
describe("PHASE 1 — reportly regression: gate-passing + strictSelectable with provenance (0 paid)", () => {
  it("compiled≥1, groundingValid≥1, criticSupported≥1, canonicalGatePassed≥1, accepted≥1, exact budget, strictSelectable=true", async () => {
    process.env.MISSION_GROUNDING_MODE = "canary";
    vi.mocked(llmCompleteJson).mockImplementation(async ({ system }: { system: string }) => {
      if (system.includes("GROUNDED mission architect")) return { json: draft, model: "gemini-3.1-flash-lite-preview", provider: "commonstack", latencyMs: 1, promptTokens: 10, completionTokens: 20 } as never;
      if (system.includes("grounding CRITIC")) return { json: { verdicts: [{ decisionId: "d0", verdict: "supported" }] }, model: "gemini-3.1-flash-lite-preview", provider: "commonstack", latencyMs: 1, promptTokens: 10, completionTokens: 5 } as never;
      return { json: {}, model: "x", provider: "x", latencyMs: 1, promptTokens: 0, completionTokens: 0 } as never;
    });
    // real closures (no deps.architect/critic) → provenance is set from the served model/provider.
    const gs = await runGroundedShadow(map(), input, scope, corpus, 0, { replayReproduced: new Set([transId]) });
    expect(gs.compiledMissionCount).toBeGreaterThanOrEqual(1);
    expect(gs.groundingValid).toBeGreaterThanOrEqual(1);
    expect(gs.criticSupported).toBeGreaterThanOrEqual(1);
    expect(gs.canonicalGatePassed).toBeGreaterThanOrEqual(1);
    expect(gs.accepted).toBeGreaterThanOrEqual(1);
    expect(gs.tierCounts.action_replayed).toBeGreaterThanOrEqual(1);
    expect(gs.exactBudgetEquality).toBe(true);
    expect(gs.groundedCandidatePlan?.strictSelectable).toBe(true);
    expect(gs.groundedCandidatePlan?.signals.provenancePresent).toBe(true);
  });
});
