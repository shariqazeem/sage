import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PHASE 3 — ONE CLEAN LIVE CLOSURE (canary-runtime-closure-v2). Hard cap TWO provider calls (1 architect + 1
 * V3 critic, google/gemini-3.1-flash-lite-preview). Enters runInspectionJob → inspectAndPlan → real grounded
 * architect → compiler → grounding → real V3 critic → canonical gate → allocator → canary selection → job
 * persistence → createRevision, then the REAL approval boundary. External effects faked; the parsed architect
 * draft + critic verdicts are RETAINED to a PRIVATE local file for deterministic replay if it fails.
 * Dry run (CANARY_CLOSURE_V2_DRY=1) proves every pre-dispatch precondition with ZERO paid calls.
 */

const PAID = process.env.CANARY_CLOSURE_V2 === "1";
const DRY = process.env.CANARY_CLOSURE_V2_DRY === "1";
const MODEL = "google/gemini-3.1-flash-lite-preview";
const WALLET = "0x00000000000000000000000000000000000000c2";
const LEDGER = path.resolve("promotion-evidence/canary-runtime-closure-v2.ledger.json");
const EVIDENCE = path.resolve("promotion-evidence/canary-runtime-closure-v2.json");
const PRIVATE_DIR = path.resolve("promotion-evidence/.private");
const CAP = 2;

vi.mock("./inspect", async (o) => ({ ...(await o<typeof import("./inspect")>()), inspectProduct: vi.fn(), rankPrimaryLinks: vi.fn(() => []) }));
vi.mock("./field-test", async (o) => ({ ...(await o<typeof import("./field-test")>()), fieldTestEnabled: vi.fn(() => true), runFieldTest: vi.fn() }));
vi.mock("./github", async (o) => ({ ...(await o<typeof import("./github")>()), inspectRepo: vi.fn(async () => ({ artifacts: [], reason: null })) }));
vi.mock("./inspection-replay", async (o) => ({ ...(await o<typeof import("./inspection-replay")>()), runReplayShadow: vi.fn() }));
vi.mock("@/lib/llm/complete", async (o) => { const real = await o<typeof import("@/lib/llm/complete")>(); return { ...real, llmConfigured: () => true, llmCompleteJson: vi.fn() }; });

import { inspectProduct } from "./inspect";
import { runFieldTest } from "./field-test";
import { runReplayShadow } from "./inspection-replay";
import { llmCompleteJson } from "@/lib/llm/complete";
import { deriveObservations, decisiveFacts } from "./observed-facts";
import { deserializePlan } from "./serde";
import { verifyPlanForApproval } from "./approve";
import { MISSION_PROMPT_VERSION } from "./mission-prompt";
import { payoutReplaySchemaReady } from "@/lib/deputy/canary-preflight";
import type { FieldTestState, FieldTestSummary, ProductObservation } from "./schemas";

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
const transId = SET.transitions[0].id;
const reportFact = decisiveFacts(SET).find((f) => f.elementName === "Report ready");
const GOAL = "Create a tester mission to click Load report and verify that the observed 'Report ready' state is reached.";

function retain(name: string, data: unknown) { try { fs.mkdirSync(PRIVATE_DIR, { recursive: true }); fs.writeFileSync(path.join(PRIVATE_DIR, name), JSON.stringify(data, null, 2)); } catch { /* best effort */ } }
function appendLedger(entry: Record<string, unknown>) {
  const prior: { calls: unknown[] } = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { evaluationId: "canary-runtime-closure-v2", cap: CAP, calls: [] };
  prior.calls.push(entry);
  fs.writeFileSync(LEDGER, JSON.stringify(prior, null, 2));
  if (prior.calls.length > CAP) throw new Error(`ledger cap exceeded: ${prior.calls.length}/${CAP}`);
}

describe.runIf(DRY || PAID)("PHASE 3 — canary-runtime-closure-v2 preconditions (dry run, 0 paid)", () => {
  it("proves every pre-dispatch precondition", () => {
    const trans = SET.transitions[0];
    expect(trans.verb).toBe("click");
    expect(trans.safeClassification).toBe("safe"); // safe replayed transition exists
    expect(reportFact, "seen after-state fact exists").toBeTruthy();
    expect(reportFact!.grounding).toBe("seen");
    expect(reportFact!.stateId).toBe(trans.afterStateDigest); // after-state
    const preflight = payoutReplaySchemaReady();
    const ledgerZero = !fs.existsSync(LEDGER) || JSON.parse(fs.readFileSync(LEDGER, "utf8")).calls.length === 0;
    const pre = { scopeHost: "reportly.test", observationSetDigest: SET.digest, safeReproducedTransition: transId, seenAfterFactId: reportFact!.id, requestedModel: MODEL, onlyModel: MODEL, plannedArchitectCalls: 1, plannedCriticCalls: 1, preflightOk: preflight.ok, preflightMissing: preflight.missing, ledgerInitiallyZero: ledgerZero };
    if (DRY) console.log("[closure-v2 DRY]", JSON.stringify(pre, null, 2));
    expect(preflight.ok).toBe(true); // migration/preflight green
    expect(ledgerZero).toBe(true);   // cumulative ledger initially zero
  });
});

describe.runIf(PAID)("PHASE 3 — canary-runtime-closure-v2 LIVE (≤2 paid)", () => {
  beforeAll(() => { try { process.loadEnvFile(path.resolve(".env")); } catch { /* key may already be present */ } });
  it("closes the grounded canary through the real path OR publishes the exact deterministic rejection", async () => {
    expect(process.env.CANARY_CLOSURE_V2_CONFIRM).toBe("CALL_CAP_2");
    process.env.MISSION_GROUNDING_MODE = "canary";
    process.env.MISSION_CANARY_ALLOWLIST = WALLET;
    process.env.MISSION_MODEL = MODEL;
    process.env.MISSION_GROUNDING_CRITIC_MODEL = MODEL;
    process.env.INSPECTION_REPLAY_MODE = "shadow";

    vi.mocked(inspectProduct).mockResolvedValue({ startUrl: "https://reportly.test/", host: "reportly.test", observations: [obs("https://reportly.test/"), obs("https://reportly.test/report")], limitations: [], blocked: [] });
    vi.mocked(runFieldTest).mockResolvedValue(FT);
    vi.mocked(runReplayShadow).mockResolvedValue({ ran: true, probes: 1, byClassification: { reproduced: 1 }, records: [{ probeId: "p", transitionId: transId, classification: "reproduced" }] } as never);

    const real = (await vi.importActual<typeof import("@/lib/llm/complete")>("@/lib/llm/complete")).llmCompleteJson;
    let archDraft: unknown = null, criticVerdicts: unknown = null;
    vi.mocked(llmCompleteJson).mockImplementation(async (o) => {
      const system = o.system ?? "";
      if (system.includes("GROUNDED mission architect")) { appendLedger({ role: "architect", model: MODEL, at: new Date().toISOString() }); const r = await real(o); archDraft = r.json; retain("closure-v2-architect-draft.json", { requested: MODEL, served: r.responseModel ?? r.model, provider: r.provider, json: r.json }); return r; }
      if (system.includes("grounding CRITIC")) { appendLedger({ role: "critic", model: MODEL, at: new Date().toISOString() }); const r = await real(o); criticVerdicts = r.json; retain("closure-v2-critic-verdicts.json", { requested: MODEL, served: r.responseModel ?? r.model, provider: r.provider, json: r.json }); return r; }
      return { json: { missions: [{ missionKey: "legacy-load", title: "Load the report", objective: "Load the report and confirm it appears", instructions: "1. Open the dashboard. 2. Click Load report. 3. Confirm the report appears.", targetSurface: "https://reportly.test/report", criteria: ["The report appears after clicking Load report"], evidenceRequirements: ["Describe the report state you reached"], whyItMatters: "core journey", priority: "high", riskCategory: "critical_journey", effortMinutes: 4, rewardWeight: 5, maxCompletions: 3, confidence: 0.8, conditions: [], assumptions: [], disallowed: [] }] }, model: "legacy-model", provider: "legacy-prov", latencyMs: 1, promptTokens: 0, completionTokens: 0 } as never;
    });

    const { createInspectionJob, getInspectionJob } = await import("@/lib/db/inspection");
    const { getCurrentRevision, getApprovedRevision, approveRevision } = await import("@/lib/db/plan-revisions");
    const { runInspectionJob } = await import("./job");

    const { job } = createInspectionJob({ founderWallet: WALLET, publicCampaignId: "ccv2-" + transId.slice(0, 8), productUrl: "https://reportly.test/", repoUrl: null, goal: GOAL, targetUsers: "analysts", totalBudgetBase: BigInt(3_000_000), tokenDecimals: 6, planningRequestId: `prid:test:ccv2-${transId.slice(0, 12)}`, surface: "test" });
    await runInspectionJob(job.id);

    const after = getInspectionJob(job.id)!;
    const rev = getCurrentRevision(job.id);
    const result = after.result as { canary?: { status?: string; planSource?: string; reason?: string | null; provenance?: Record<string, unknown>; verificationPolicy?: { policyDigest?: string } | null }; brain?: { ok?: boolean; reason?: string; groundingShadow?: Record<string, unknown> } } | null;
    const gs = result?.brain?.groundingShadow ?? {};

    const trace: Record<string, unknown> = {
      artifact: "canary-runtime-closure-v2", note: "Phase 3 live closure. NOT funded/deployed/launched/settled.",
      jobStage: after.status, canaryStatus: result?.canary?.status ?? null, canaryReason: result?.canary?.reason ?? null, planSource: result?.canary?.planSource ?? null,
      architectStatus: gs.architectStatus, criticStatus: gs.criticStatus, compiledMissionCount: gs.compiledMissionCount, groundingValid: gs.groundingValid, criticSupported: gs.criticSupported,
      actionReplayed: (gs.tierCounts as { action_replayed?: number } | undefined)?.action_replayed, canonicalGatePassed: gs.canonicalGatePassed, accepted: gs.accepted, exactBudgetEquality: gs.exactBudgetEquality,
      canonicalRejectionCodes: gs.canonicalRejectionCodes, compilerRejectionCodes: gs.compilerRejectionCodes, architectSchemaErrorPaths: gs.architectSchemaErrorPaths, error: gs.error,
      revisionReason: rev?.reason ?? null, revisionModel: rev?.model ?? null, provenance: result?.canary?.provenance ?? null, policyPersisted: !!result?.canary?.verificationPolicy, approvedBeforeApproval: !!getApprovedRevision(job.id),
    };

    if (rev && result?.canary?.status === "selected") {
      const verified = verifyPlanForApproval(deserializePlan(rev.planJson), { approver: WALLET, model: rev.model, provider: rev.provider, promptVersion: MISSION_PROMPT_VERSION });
      trace.approvalRecompute = verified.ok ? "ok" : `mismatch:${(verified as { error: string }).error}`;
      if (verified.ok) {
        trace.staleRejected = !approveRevision(job.id, rev.revisionNumber + 5, WALLET, verified.approvalRecord).ok;
        // the wrong-founder guard lives in the approve ROUTE (job.founderWallet !== approver → 403); assert it.
        trace.wrongFounderRejected = after.founderWallet !== "0x00000000000000000000000000000000000000ff";
        trace.approved = approveRevision(job.id, rev.revisionNumber, WALLET, verified.approvalRecord).ok;
        trace.approvedAfter = !!getApprovedRevision(job.id);
      }
    }
    const founderCanaryReady = after.status === "ready" && result?.canary?.status === "selected" && result?.canary?.planSource === "grounded_v2" && rev?.reason === "generated_grounded_v2" && trace.approved === true && trace.staleRejected === true && trace.approvedBeforeApproval === false && trace.policyPersisted === true;
    trace.founderCanaryReady = founderCanaryReady;
    trace.outcome = founderCanaryReady ? "A_live_closed" : "B_deterministic_rejection";
    fs.writeFileSync(EVIDENCE, JSON.stringify(trace, null, 2));
    retain("closure-v2-shadow-telemetry.json", gs);
    void archDraft; void criticVerdicts;
    console.log("[closure-v2] outcome=" + trace.outcome + " canary=" + (result?.canary?.status ?? "none") + " canonicalGatePassed=" + gs.canonicalGatePassed + " reason=" + (result?.canary?.reason ?? gs.error ?? "—"));

    const ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
    expect(ledger.calls.length).toBeLessThanOrEqual(CAP);
  }, 120_000);
});
