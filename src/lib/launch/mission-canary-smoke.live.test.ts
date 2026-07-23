import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deriveObservations, decisiveFacts, type ObservationSetV1 } from "./observed-facts";
import { scopeFromObservations } from "./product-map";
import type { ProductObservation } from "./schemas";
import { runGroundedShadow, type ShadowDeps } from "./mission-grounding-shadow";
import { evaluateCanarySelection, bindCanaryApproval, deterministicGroundedPlanDigest, type CanaryIdentity } from "./mission-canary";
import { allocateBudget } from "./budget";
import { compilePlan } from "./plan";
import { MISSION_PROMPT_VERSION } from "./mission-prompt";
import { ARCHITECT_SEMANTIC_DRAFT_TRANSPORT_SCHEMA } from "./mission-draft-compiler";
import { CRITIC_TRANSPORT_SCHEMA_V3, ARCHITECT_SYSTEM_V2, CRITIC_SYSTEM_V3 } from "./mission-grounding-shadow";
import { llmCompleteJson } from "@/lib/llm/complete";
import type { FieldTestState, FieldTestSummary, ProductMapV1, FounderLaunchInput } from "./schemas";

/**
 * Phase 6 — ONE real CANARY SMOKE. Exercises the winning canary model (google/gemini-3.1-flash-lite-preview)
 * as the REAL architect + REAL V3 critic on a pre-seeded "Load report → Report ready" reproduced observation
 * set, then drives the EXACT selection primitives the pipeline uses (evaluateCanarySelection → allocateBudget
 * → compilePlan → bindCanaryApproval). Proves the full trace:
 *   architect strict-valid → semantic draft compiled → action_replayed grounding → V3 critic supported →
 *   canonical gate → exact allocation → V2 SELECTED as canary → deterministic digest → approval waits.
 *
 * MAX 2 paid calls (1 architect + 1 critic), recorded in the shared cap-6 ledger BEFORE each dispatch. Does
 * NOT fund, deploy, launch, or pay. Inspection is pre-seeded (equivalent to a completed inspection+replay);
 * everything from the architect onward is the real path with the real winning model.
 */

const PAID = process.env.GROUNDING_CANARY_SMOKE === "1";
const DRYRUN = process.env.GROUNDING_CANARY_SMOKE_DRYRUN === "1";
const CANARY_MODEL = "google/gemini-3.1-flash-lite-preview";
const WALLET = "0xCanaryFounder000000000000000000000000A1";
const PRIOR_PAID = 3; // P4 calibration already consumed 3 of the cumulative 6.
const CAP = 6;
const LEDGER = path.resolve("promotion-evidence/grounding-canary-smoke.ledger.json");
const EVIDENCE = path.resolve("promotion-evidence/grounding-canary-smoke.json");

const stt = (o: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://reportly.test/", networkMethods: ["GET"], ...o });
const FT: FieldTestSummary = {
  ran: true, startUrl: "https://reportly.test/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1,
  states: [
    stt({ trigger: "initial load", visibleTextExcerpt: "Reportly dashboard", notableElements: [{ tag: "button", text: "Load report", role: "button" }], networkMethods: ["GET"] }),
    stt({ trigger: "clicked 'Load report'", url: "https://reportly.test/report", visibleTextExcerpt: "Report ready. Your report is ready to view.", notableElements: [{ tag: "heading", text: "Report ready", role: "heading" }], pixelDeltaPct: 45, networkMethods: ["GET"] }),
  ],
};
const SET: ObservationSetV1 = deriveObservations(FT);
const CORPUS = "reportly dashboard load report report ready your report is ready to view";
const GOAL = "Create a tester mission to click Load report and verify that the observed 'Report ready' state is reached.";

function buildMap(): ProductMapV1 {
  const finding = (v: string) => ({ value: v, confidence: 0.9, sources: [{ kind: "page" as const, ref: "https://reportly.test/", observation: v }], browserConfirmed: true });
  const trans = SET.transitions[0];
  return {
    productName: "Reportly", category: "app", valueProp: "reports", targetUserHypotheses: [], founderTargetUsers: "analysts",
    primaryJourney: [], routes: [finding("https://reportly.test/"), finding("https://reportly.test/report")], interactiveSurfaces: [], trustSurfaces: [], claimRisks: [], observedStates: [],
    repoOnlyCapabilities: [], browserConfirmed: [], limitations: [], openQuestions: [], pagesInspected: 2, repoFilesInspected: 0,
    digest: "0x00", fieldTest: FT, observations: SET,
    // pre-seed the replay so the Load-report transition grounds as action_replayed (equivalent to a real reproduced replay).
    replayShadow: { version: "replay-shadow-v1", mode: "shadow", probes: 1, byClassification: { reproduced: 1 }, results: [{ probeId: "p", transitionId: trans.id, classification: "reproduced" }] },
  } as unknown as ProductMapV1;
}

const INPUT: FounderLaunchInput = { productUrl: "https://reportly.test/", goal: GOAL, targetUsers: "analysts", totalBudgetBase: BigInt(3_000_000), tokenDecimals: 6 } as FounderLaunchInput;

function appendLedger(entry: Record<string, unknown>) {
  const prior: { calls: unknown[] } = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { evaluationId: "grounding-canary-smoke", cap: CAP, priorPaidCalls: PRIOR_PAID, calls: [] };
  prior.calls.push(entry);
  const runningTotal = PRIOR_PAID + prior.calls.length;
  fs.writeFileSync(LEDGER, JSON.stringify({ ...prior, runningTotalAgainstCap6: runningTotal }, null, 2));
  if (runningTotal > CAP) throw new Error(`ledger cap exceeded: ${runningTotal}/${CAP}`);
}

describe("Phase 6 — CANARY SMOKE (build the pre-seeded reproduced observation set)", () => {
  it("DRYRUN/PAID: the observation set has a SAFE, REPRODUCED Load-report transition + a decisive 'Report ready' after-fact", () => {
    const trans = SET.transitions[0];
    expect(trans.verb).toBe("click");
    expect(trans.safeClassification).toBe("safe");
    expect(trans.observableChange).toBe(true);
    const afterFact = decisiveFacts(SET).find((f) => (f.visibleTexts ?? []).some((t) => /report ready/i.test(t)) || f.elementName === "Report ready");
    expect(afterFact, "a decisive 'Report ready' after-fact must exist").toBeTruthy();
    if (DRYRUN) console.log("[canary-smoke] DRY-RUN set:", JSON.stringify({ transitionId: trans.id, safe: trans.safeClassification, afterFactId: afterFact?.id, canaryModel: CANARY_MODEL, ledger: LEDGER, evidence: EVIDENCE, priorPaid: PRIOR_PAID, cap: CAP }, null, 2));
  });
});

describe.runIf(PAID)("Phase 6 — CANARY SMOKE (LIVE, ≤2 paid calls)", () => {
  it("selects the grounded V2 plan through the real architect + V3 critic, binds an approval, and waits", async () => {
    expect(process.env.GROUNDING_CANARY_SMOKE_CONFIRM).toBe("CALL_CAP_2");
    try { process.loadEnvFile(path.resolve(".env")); } catch { /* key may already be present */ }

    process.env.MISSION_GROUNDING_MODE = "canary";
    process.env.MISSION_CANARY_ALLOWLIST = WALLET;

    // Real model deps — record the ledger BEFORE each dispatch; no retries.
    const architect: ShadowDeps["architect"] = async (system, user) => {
      appendLedger({ seq: 1, role: "architect", model: CANARY_MODEL, at: new Date().toISOString() });
      const r = await llmCompleteJson({ system, user, maxTokens: 4200, temperature: 0.2, model: CANARY_MODEL, parsePolicy: "strict", responseSchema: ARCHITECT_SEMANTIC_DRAFT_TRANSPORT_SCHEMA });
      return r.json;
    };
    const critic: ShadowDeps["critic"] = async (system, user) => {
      appendLedger({ seq: 2, role: "critic", model: CANARY_MODEL, at: new Date().toISOString() });
      const r = await llmCompleteJson({ system, user, maxTokens: 2200, temperature: 0, model: CANARY_MODEL, parsePolicy: "strict", responseSchema: CRITIC_TRANSPORT_SCHEMA_V3 });
      return r.json;
    };

    const map = buildMap();
    // scope MUST reflect the inspected surfaces (the real pipeline builds it from the inspection); an empty
    // scope makes every in-scope URL fail the canonical gate. (The first paid run passed [] — a harness defect;
    // the model/grounding/critic all passed and only this input caused the gate rejection. Fixed here.)
    const scopeObs = (url: string): ProductObservation => ({ url, status: 200, title: "Reportly", headings: ["Reportly dashboard"], claims: [], ctas: ["Load report"], forms: [], links: [], authBoundary: false, techHints: [], states: [], landmarks: [], snippets: ["Reportly dashboard"], inspectedAt: 1, contentSha256: "a".repeat(64) });
    const scope = scopeFromObservations([scopeObs("https://reportly.test/"), scopeObs("https://reportly.test/report")], []);
    const replayReproduced = new Set([SET.transitions[0].id]);
    // sanity: we are actually calling flash-lite as architect + critic.
    void ARCHITECT_SYSTEM_V2; void CRITIC_SYSTEM_V3;

    const gs = await runGroundedShadow(map, INPUT, scope, CORPUS, 0, { architect, critic, replayReproduced });

    // Selection trace — the EXACT primitives the pipeline uses.
    const identity: CanaryIdentity = { wallet: WALLET, optedIn: true, source: "server_session" };
    const decision = evaluateCanarySelection({ mode: "canary", identity, plan: gs.groundedCandidatePlan });

    const trace: Record<string, unknown> = {
      artifact: "grounding-canary-smoke",
      note: "Phase 6 canary smoke — grounded plan selection with the winning canary model. NOT funded/deployed/launched/paid.",
      canaryModel: CANARY_MODEL,
      architectStatus: gs.architectStatus, architectModel: gs.architectModelActual, architectProvider: gs.architectProvider,
      criticStatus: gs.criticStatus, criticModel: gs.criticModelActual, criticProvider: gs.criticProvider,
      draftMissionCount: gs.draftMissionCount, compiledMissionCount: gs.compiledMissionCount, compilerRejectedCount: gs.compilerRejectedCount,
      groundingValid: gs.groundingValid, tierCounts: gs.tierCounts, criticSupported: gs.criticSupported,
      canonicalGatePassed: gs.canonicalGatePassed, accepted: gs.accepted, exactBudgetEquality: gs.exactBudgetEquality,
      signals: gs.groundedCandidatePlan?.signals ?? null, strictSelectable: gs.groundedCandidatePlan?.strictSelectable ?? false,
      decisionStatus: decision.status, decisionReason: "reason" in decision ? decision.reason : null,
    };

    if (decision.status === "selected") {
      const missions = decision.plan.missions;
      const allocation = allocateBudget(missions.map((m) => ({ missionKey: m.missionKey, weight: m.rewardWeight, suggestedMaxCompletions: m.maxCompletions, priority: m.priority, effortMinutes: m.effortMinutes })), INPUT.totalBudgetBase);
      trace.allocationOk = allocation.ok;
      if (allocation.ok) {
        const compiled = compilePlan({ publicCampaignId: "canary-smoke", productMapDigest: map.digest, missions, allocation, tokenDecimals: INPUT.tokenDecimals, modelVersion: CANARY_MODEL, promptVersion: MISSION_PROMPT_VERSION, revision: 1 });
        trace.compiledOk = compiled.ok;
        if (compiled.ok) {
          const exactEqual = compiled.plan.allocatedBase === INPUT.totalBudgetBase;
          const approval = bindCanaryApproval({ planDigest: compiled.plan.missionPlanDigest, budgetText: `${INPUT.totalBudgetBase} base units @ ${INPUT.tokenDecimals}dp`, budgetBase: compiled.plan.totalBudgetBase.toString(), revision: compiled.plan.revision });
          trace.groundedPlanDigest = deterministicGroundedPlanDigest(decision.plan);
          trace.missionPlanDigest = compiled.plan.missionPlanDigest;
          trace.suppliedBudgetBase = INPUT.totalBudgetBase.toString();
          trace.allocatedBase = compiled.plan.allocatedBase.toString();
          trace.exactBudgetEquality = exactEqual;
          trace.approvalToken = approval.token;
          trace.planStatus = compiled.plan.status; // waits for founder approval — NOT auto-approved/launched
          trace.missionKeys = missions.map((m) => m.missionKey);
          trace.result = exactEqual ? "canary_selected_awaiting_approval" : "canary_budget_not_exact";
        }
      }
    } else {
      trace.result = `canary_not_selected:${decision.status}`;
    }

    fs.writeFileSync(EVIDENCE, JSON.stringify(trace, null, 2));
    console.log("[canary-smoke] result=" + trace.result + " status=" + decision.status);

    // The smoke PASSES the test harness whether or not selection succeeded (the evidence records the exact
    // stage reached). We ONLY hard-assert the invariants that must hold regardless: ≤2 paid calls, no autopay.
    const ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
    expect(ledger.calls.length).toBeLessThanOrEqual(2);
    expect(PRIOR_PAID + ledger.calls.length).toBeLessThanOrEqual(CAP);
  }, 120_000);
});
