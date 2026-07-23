import { describe, it, expect, vi, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * SEMANTIC MISSION DRAFT live smoke — a fresh evaluation (grounded-semantic-draft-v1) that runs the REAL
 * Gemini architect (now emitting the compact SEMANTIC DRAFT) + the REAL Haiku critic through the real
 * runMissionBrain, and verifies the deterministic compiler derives valid grounded missions. Only legacy LLM
 * calls are faked. Do NOT combine with the structured-v2 evidence/ledger — those are preserved unchanged.
 *
 * HARD CAP 6 paid calls across ALL sessions/resumes; the count is persisted BEFORE every call to an
 * append-only ledger that is NEVER auto-deleted; no retry; no quota probe; refuse dispatch at >= 6.
 * Guard: GROUNDING_SEMANTIC_CONFIRM=CALL_CAP_6.
 */
vi.mock("@/lib/llm/complete", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/complete")>();
  return { ...actual, llmCompleteJson: vi.fn() };
});

import { llmCompleteJson, LlmCompletionError } from "@/lib/llm/complete";
import { runMissionBrain } from "./mission-brain";
import { deriveObservations } from "./observed-facts";
import { scopeFromObservations } from "./product-map";
import { buildObservationCorpus } from "./validate-mission";
import type { GroundingShadowResult } from "./mission-grounding-shadow";
import type { FieldTestState, FieldTestSummary, ProductMapV1, ProductObservation, FounderLaunchInput } from "./schemas";

const DRYRUN = process.env.GROUNDING_SEMANTIC_DRYRUN === "1";
const PAID = process.env.GROUNDING_SEMANTIC === "1";
const CAP = 6;
const EVAL_ID = "grounded-semantic-draft-v1";
const ARCH_MODEL = "google/gemini-3.1-flash-lite-preview";
const CRITIC_MODEL = "anthropic/claude-haiku-4-5";
const EVIDENCE_DIR = path.resolve("promotion-evidence");
const LEDGER_PATH = path.join(EVIDENCE_DIR, `${EVAL_ID}.ledger.json`);
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, `${EVAL_ID}.json`);

/* ─────────── fixtures (self-contained) ─────────── */
const stt = (o: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://x.example/", networkMethods: ["GET"], ...o });
const obs = (url: string, o: Partial<ProductObservation>): ProductObservation => ({ url, status: 200, title: "", headings: [], claims: [], ctas: [], forms: [], links: [], authBoundary: false, techHints: [], states: [], landmarks: [], snippets: [], inspectedAt: 1, contentSha256: "a".repeat(64), ...o });
function buildMap(fieldTest: FieldTestSummary, replayTransitionId?: string): ProductMapV1 {
  const set = deriveObservations(fieldTest);
  const finding = (v: string) => ({ value: v, confidence: 0.9, sources: [{ kind: "page" as const, ref: fieldTest.startUrl, observation: v }], browserConfirmed: true });
  const map = { productName: "P", category: "app", valueProp: "v", targetUserHypotheses: [], founderTargetUsers: "u", primaryJourney: [], routes: fieldTest.states.map((s) => finding(s.url)), interactiveSurfaces: [], trustSurfaces: [], claimRisks: [], observedStates: [], repoOnlyCapabilities: [], browserConfirmed: [], limitations: [], openQuestions: [], pagesInspected: fieldTest.states.length, repoFilesInspected: 0, digest: "0x00", fieldTest, observations: set } as unknown as ProductMapV1;
  if (replayTransitionId) (map as { replayShadow?: unknown }).replayShadow = { version: "replay-shadow-v1", mode: "shadow", probes: 1, byClassification: { reproduced: 1 }, results: [{ probeId: "p", transitionId: replayTransitionId, classification: "reproduced" }] };
  return map;
}
const claimFT: FieldTestSummary = { ran: true, startUrl: "https://acme-metrics.example/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1, states: [stt({ url: "https://acme-metrics.example/", visibleTextExcerpt: "Acme Metrics. See every metric in real time. Trusted by 5,000 teams. Start free trial.", notableElements: [{ tag: "h1", text: "See every metric in real time", role: "heading" }, { tag: "p", text: "Trusted by 5,000 teams", role: "note" }, { tag: "a", text: "Start free trial", role: "link" }] })] };
const claimObs = [obs("https://acme-metrics.example/", { title: "Acme Metrics", headings: ["See every metric in real time"], claims: ["Trusted by 5,000 teams"], ctas: ["Start free trial"], snippets: ["Trusted by 5,000 teams"] })];
const replayFT: FieldTestSummary = { ran: true, startUrl: "https://reportly.example/dashboard", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1, states: [stt({ url: "https://reportly.example/dashboard", visibleTextExcerpt: "Reportly dashboard. Click Load report to view this month's revenue.", notableElements: [{ tag: "button", text: "Load report", role: "button" }] }), stt({ trigger: "clicked 'Load report'", url: "https://reportly.example/dashboard/report", visibleTextExcerpt: "Report ready. Revenue this month is 12,400 dollars.", notableElements: [{ tag: "h2", text: "Report ready", role: "heading" }], pixelDeltaPct: 35, networkMethods: ["GET"] })] };
const replayTransId = deriveObservations(replayFT).transitions[0]?.id;
const replayObs = [obs("https://reportly.example/dashboard", { title: "Reportly", headings: ["Reportly dashboard"], ctas: ["Load report"], snippets: ["Click Load report to view this month's revenue"] }), obs("https://reportly.example/dashboard/report", { title: "Reportly report", headings: ["Report ready"], snippets: ["Revenue this month is 12,400 dollars"] })];
const ghostFT: FieldTestSummary = { ran: true, startUrl: "https://taskly.example/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1, states: [stt({ url: "https://taskly.example/app", visibleTextExcerpt: "Taskly. Your tasks for today. Add a task. Mark tasks complete. Invite a teammate.", notableElements: [{ tag: "button", text: "Add a task", role: "button" }, { tag: "button", text: "Mark complete", role: "button" }] })] };
const ghostObs = [obs("https://taskly.example/app", { title: "Taskly", headings: ["Your tasks for today"], ctas: ["Add a task", "Mark complete", "Invite a teammate"], snippets: ["Add a task", "Mark tasks complete"] })];
const input = (goal: string, url: string): FounderLaunchInput => ({ productUrl: url, goal, targetUsers: "u", totalBudgetBase: BigInt(2_000_000), tokenDecimals: 6 } as unknown as FounderLaunchInput);

interface Fixture { id: string; goal: string; kind: "positive_state" | "positive_action" | "ghost"; map: () => ProductMapV1; observations: ProductObservation[]; fieldTest: FieldTestSummary; url: string }
const FIXTURES: Fixture[] = [
  { id: "state_claim", goal: "Validate that the public 'Trusted by 5,000 teams' claim is reachable and accurately reported.", kind: "positive_state", map: () => buildMap(claimFT), observations: claimObs, fieldTest: claimFT, url: claimFT.startUrl },
  { id: "safe_replay", goal: "Test that clicking Load report reliably reaches the observed report outcome.", kind: "positive_action", map: () => buildMap(replayFT, replayTransId), observations: replayObs, fieldTest: replayFT, url: replayFT.startUrl },
  { id: "ghost_export", goal: "Test the Export CSV workflow: download all of my tasks as a CSV file.", kind: "ghost", map: () => buildMap(ghostFT), observations: ghostObs, fieldTest: ghostFT, url: ghostFT.startUrl },
];

/* ─────────── append-only ledger + 6-call cap ─────────── */
interface LedgerCall { seq: number; fixture: string; role: string; startedAt: string; completedAt: string | null; outcomeCode: string | null; terminalState: string }
interface StepResult { id: string; classification: string; metrics: Record<string, unknown> }
interface Ledger { evaluationId: string; hardCap: number; callsConsumed: number; calls: LedgerCall[]; stepResults: Record<string, StepResult> }
let ledger: Ledger = { evaluationId: EVAL_ID, hardCap: CAP, callsConsumed: 0, calls: [], stepResults: {} };
const persistLedger = () => { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2)); };
let realComplete: typeof import("@/lib/llm/complete");
let currentFixture = "";
let ghostArchitectMentioned = false;

async function dispatcher(opts: { system: string; user: string; parsePolicy?: string }): Promise<unknown> {
  const isArch = opts.system.includes("GROUNDED mission architect");
  const isCrit = opts.system.includes("grounding CRITIC");
  if (!isArch && !isCrit) return { json: { missions: [{ missionKey: "legacy-fixture", title: "Legacy fixture", objective: "placeholder legacy objective", instructions: "1. no-op", targetSurface: "https://x.example/" }] }, model: "legacy-fake", provider: "fake", latencyMs: 0, promptTokens: 0, completionTokens: 0, parsePolicy: "repair", finishReason: "stop", repaired: false, responseModel: "legacy-fake" };
  if (opts.parsePolicy !== "strict") throw new Error("llm_v2_not_strict");
  if (ledger.callsConsumed >= CAP) throw new Error("llm_call_cap_reached");
  const rec: LedgerCall = { seq: ledger.callsConsumed + 1, fixture: currentFixture, role: isArch ? "architect" : "critic", startedAt: new Date().toISOString(), completedAt: null, outcomeCode: null, terminalState: "in_flight" };
  ledger.calls.push(rec); ledger.callsConsumed += 1; persistLedger();
  try {
    const r = await realComplete.llmCompleteJson(opts as never);
    rec.completedAt = new Date().toISOString(); rec.outcomeCode = "ok"; rec.terminalState = "completed"; persistLedger();
    if (isArch) { const t = JSON.stringify((r as { json?: unknown }).json ?? "").toLowerCase(); ghostArchitectMentioned = /export|csv|download|spreadsheet|\.xlsx/.test(t); }
    return r;
  } catch (e) {
    rec.completedAt = new Date().toISOString(); rec.outcomeCode = e instanceof LlmCompletionError ? e.code : (e instanceof Error ? e.message.slice(0, 40) : "error"); rec.terminalState = "failed"; persistLedger();
    throw e;
  }
}

const normModel = (m: string | null | undefined) => (m ?? "").replace(/^(google|anthropic|openai|meta|mistral)\//, "").replace(/-\d{6,}$/, "");
const servedExplained = (requested: string, served: string | null) => !served || normModel(requested) === normModel(served);

function metricsOf(gs: GroundingShadowResult | undefined) {
  if (!gs) return { error: "no_shadow" };
  return { architectStatus: gs.architectStatus, criticStatus: gs.criticStatus, architectErrorCode: gs.architectErrorCode, criticErrorCode: gs.criticErrorCode,
    architectContractVersion: gs.architectContractVersion, draftMissionCount: gs.draftMissionCount, draftCriterionCount: gs.draftCriterionCount,
    compiledMissionCount: gs.compiledMissionCount, compilerRejectedCount: gs.compilerRejectedCount, compilerRejectionCodes: gs.compilerRejectionCodes,
    derivedAnchorCount: gs.derivedAnchorCount, derivedSourceCount: gs.derivedSourceCount, derivedTargetSurfaceCount: gs.derivedTargetSurfaceCount,
    groundingValid: gs.groundingValid, criticSupported: gs.criticSupported, canonicalGatePassed: gs.canonicalGatePassed, accepted: gs.accepted,
    tierCounts: gs.tierCounts, unsafeTransitionCount: gs.unsafeTransitionCount, exactBudgetEquality: gs.exactBudgetEquality, allocatedBudgetBase: gs.allocatedBudgetBase,
    architectContentShape: gs.architectContentShape, criticContentShape: gs.criticContentShape, canonicalRejectionCodes: gs.canonicalRejectionCodes, architectSchemaErrorPaths: gs.architectSchemaErrorPaths, error: gs.error,
    architectModelActual: gs.architectModelActual, criticModelActual: gs.criticModelActual, architectProvider: gs.architectProvider, criticProvider: gs.criticProvider,
    architectPromptTokens: gs.architectPromptTokens, architectCompletionTokens: gs.architectCompletionTokens, architectLatencyMs: gs.architectLatencyMs,
    criticPromptTokens: gs.criticPromptTokens, criticCompletionTokens: gs.criticCompletionTokens, criticLatencyMs: gs.criticLatencyMs };
}

/** classify to the EXACT failing layer — never mislabel one layer as another. */
function classify(gs: GroundingShadowResult | undefined, kind: Fixture["kind"]): string {
  if (!gs) return "inconclusive";
  if (gs.architectErrorCode === "llm_status_429" || gs.criticErrorCode === "llm_status_429") return "quota_blocked";
  if (gs.architectStatus === "provider_error") return "provider_failed";
  if (gs.architectStatus === "strict_parse_error") return "strict_transport_failed";
  if (gs.architectStatus === "schema_invalid") return "semantic_schema_failed";
  if (kind === "ghost") return (gs.accepted === 0 && gs.criticSupported === 0) ? "ok" : "canonical_gate_failed";
  if (gs.compiledMissionCount === 0) return "draft_compiler_failed";
  if (gs.groundingValid === 0) return "grounding_failed";
  if (gs.criticStatus === "provider_error") return "provider_failed";
  if (gs.criticStatus === "strict_parse_error") return "strict_transport_failed";
  if (gs.criticStatus === "schema_invalid") return "semantic_schema_failed";
  if (gs.criticSupported === 0) return "critic_semantic_failed";
  if (gs.canonicalGatePassed === 0) return "canonical_gate_failed";
  if (!gs.budgetCompiled || !gs.exactBudgetEquality) return "budget_compile_failed";
  if (kind === "positive_state" && gs.tierCounts.state_seen < 1) return "grounding_failed";
  if (kind === "positive_action" && gs.tierCounts.action_replayed < 1) return "grounding_failed";
  if (kind === "positive_action" && gs.unsafeTransitionCount > 0) return "grounding_failed";
  return "ok";
}

describe.runIf(DRYRUN || PAID)(`grounded architect — semantic-draft live smoke (${EVAL_ID})`, () => {
  beforeAll(async () => {
    if (PAID) { try { process.loadEnvFile(path.resolve(".env")); } catch { /* key may already be present */ } }
    realComplete = (await vi.importActual("@/lib/llm/complete")) as typeof import("@/lib/llm/complete");
    vi.mocked(llmCompleteJson).mockImplementation(dispatcher as never);
    process.env.MISSION_MODEL = ARCH_MODEL;
    process.env.MISSION_GROUNDING_CRITIC_MODEL = CRITIC_MODEL;
    process.env.MISSION_GROUNDING_MODE = "shadow";
  });

  it.runIf(DRYRUN)("DRY-RUN — plans the run and makes ZERO provider calls", () => {
    console.log("[semantic-smoke] DRY-RUN plan:\n" + JSON.stringify({ evaluationId: EVAL_ID, hardCap: CAP, requestedModels: { architect: ARCH_MODEL, critic: CRITIC_MODEL }, transportSchema: "sage_grounded_architect_semantic_draft_v1 (strict)", fixtures: FIXTURES.map((f) => ({ id: f.id, kind: f.kind, digest: deriveObservations(f.fieldTest).digest })), ledgerPath: LEDGER_PATH, evidencePath: EVIDENCE_PATH, confirm: "GROUNDING_SEMANTIC_CONFIRM=CALL_CAP_6", stopConditions: ["429 quota", "provider/strict/schema/compiler failure", "unexplained served-model substitution"] }, null, 2));
    expect(ledger.callsConsumed).toBe(0);
    expect(replayTransId).toBeTruthy();
  });

  it.runIf(PAID)("LIVE — cumulative ≤6 real calls, append-only ledger, semantic-draft architect + critic", async () => {
    expect(process.env.GROUNDING_SEMANTIC_CONFIRM).toBe("CALL_CAP_6");
    if (fs.existsSync(LEDGER_PATH)) ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    ledger.stepResults = ledger.stepResults ?? {};
    persistLedger();

    let modelSubstitution: string | null = null;
    const checkServed = (gs?: GroundingShadowResult) => { if (!gs) return; if (gs.architectModelActual && !servedExplained(ARCH_MODEL, gs.architectModelActual)) modelSubstitution = `architect ${ARCH_MODEL}→${gs.architectModelActual}`; if (gs.criticModelActual && !servedExplained(CRITIC_MODEL, gs.criticModelActual)) modelSubstitution = `critic ${CRITIC_MODEL}→${gs.criticModelActual}`; };
    const save = (r: StepResult) => { ledger.stepResults[r.id] = r; persistLedger(); return r; };

    const steps: StepResult[] = [];
    let stop = false;
    for (const fx of FIXTURES) {
      if (stop) break;
      let r = ledger.stepResults[fx.id];
      if (!r) {
        currentFixture = fx.id; ghostArchitectMentioned = false;
        const gs = ledger.callsConsumed < CAP ? (await runMissionBrain(fx.map(), input(fx.goal, fx.url), scopeFromObservations(fx.observations, []), buildObservationCorpus(fx.observations, fx.fieldTest))).groundingShadow : undefined;
        checkServed(gs);
        r = save({ id: fx.id, classification: classify(gs, fx.kind), metrics: { ...metricsOf(gs), ghostArchitectMentioned } });
      }
      steps.push(r);
      if (r.classification !== "ok" || modelSubstitution) stop = true;
    }

    const anyQuota = steps.some((s) => s.classification === "quota_blocked");
    const green = !modelSubstitution && !anyQuota && steps.length === FIXTURES.length && steps.every((s) => s.classification === "ok");
    const firstFail = steps.find((s) => s.classification !== "ok");
    const recommendation = modelSubstitution ? "inconclusive" : anyQuota ? "quota_blocked" : green ? "semantic_smoke_green" : (firstFail ? firstFail.classification : "inconclusive");
    const configurationConclusive = !anyQuota && !modelSubstitution && steps.length > 0 && steps[0].classification !== "inconclusive";
    const capabilityConclusive = green || (firstFail?.classification === "critic_semantic_failed");

    const evidence = { artifact: EVAL_ID, note: "semantic mission-draft closure — NOT model approval, NOT promotion-ready", timestamp: new Date().toISOString(), callsConsumed: ledger.callsConsumed, hardCap: CAP, ledgerPath: path.basename(LEDGER_PATH), modelSubstitution, requestedModels: { architect: ARCH_MODEL, critic: CRITIC_MODEL }, architectContractVersion: "semantic-draft-v1", transportSchemas: { architect: "sage_grounded_architect_semantic_draft_v1", critic: "sage_grounded_critic_v2" }, configurationConclusive, capabilityConclusive, steps, recommendation };
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
    console.log(`[semantic-smoke] recommendation=${recommendation} callsConsumed=${ledger.callsConsumed} steps=${steps.map((s) => s.id + ":" + s.classification).join(", ")}`);

    expect(ledger.callsConsumed).toBeLessThanOrEqual(CAP);
  }, 240_000);
});
