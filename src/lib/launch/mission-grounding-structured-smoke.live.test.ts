import { describe, it, expect, vi, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * STRUCTURED-OUTPUT CRITIC CLOSURE — a cumulative ≤5-call paid smoke that tests the SAME Haiku critic using
 * CommonStack's json_schema (schema-constrained) contract while preserving Sage's strict reject-never-repair
 * parser. It does NOT switch models or loosen parsing — it isolates whether the prior failure was caused by
 * json_object rather than json_schema.
 *
 * HARD LIMITS: ≤5 paid calls across ALL starts/resumes; NO retries; the cumulative count is persisted to an
 * APPEND-ONLY ledger BEFORE every call and is NEVER auto-deleted. Refuse any dispatch at callsConsumed >= 5.
 *
 * Gated: nothing runs (no key read) unless GROUNDING_STRUCTURED_DRYRUN=1 or
 * GROUNDING_STRUCTURED=1 + GROUNDING_STRUCTURED_CONFIRM=CALL_CAP_5.
 */

vi.mock("@/lib/llm/complete", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/complete")>();
  return { ...actual, llmCompleteJson: vi.fn() };
});

import { llmCompleteJson, LlmCompletionError } from "@/lib/llm/complete";
import { runMissionBrain } from "./mission-brain";
import { deriveObservations, decisiveFacts } from "./observed-facts";
import { scopeFromObservations } from "./product-map";
import { buildObservationCorpus } from "./validate-mission";
import type { GroundingShadowResult } from "./mission-grounding-shadow";
import type { FieldTestState, FieldTestSummary, ProductMapV1, ProductObservation, FounderLaunchInput } from "./schemas";

const DRYRUN = process.env.GROUNDING_STRUCTURED_DRYRUN === "1";
const PAID = process.env.GROUNDING_STRUCTURED === "1";
const CAP = 5;
const EVAL_ID = "grounded-structured-v2";
const ARCH_MODEL = "google/gemini-3.1-flash-lite-preview";
const CRITIC_MODEL = "anthropic/claude-haiku-4-5";
const EVIDENCE_DIR = path.resolve("promotion-evidence");
const LEDGER_PATH = path.join(EVIDENCE_DIR, `${EVAL_ID}.ledger.json`);
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, `${EVAL_ID}.json`);

/* ─────────── fixtures (self-contained; mirror the prior smoke) ─────────── */
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

// The deterministic grounded state_claim ARCHITECT candidate for step 1 (equivalent to the previously
// successful live architect output). Step 1 fakes the architect and tests ONLY the real Haiku critic.
const claimSet = deriveObservations(claimFT);
const claimFact = decisiveFacts(claimSet).find((f) => f.elementName === "Trusted by 5,000 teams") ?? decisiveFacts(claimSet)[0];
const FAKE_STATE_CLAIM_ARCHITECT = { missions: [{
  missionKey: "verify-trust-claim", title: "Verify the trust claim", objective: "Confirm the homepage states it is trusted by 5,000 teams",
  instructions: "1. Open the homepage. 2. Locate the 'Trusted by 5,000 teams' claim. 3. Report whether it is present and accurate.",
  targetSurface: claimFT.startUrl, criteria: ["The homepage displays the 'Trusted by 5,000 teams' claim"],
  evidenceRequirements: ["Quote the exact trust claim text shown on the homepage"], whyItMatters: "trust claims drive signups and must be accurate",
  sources: [{ kind: "page", ref: claimFT.startUrl, observation: "Trusted by 5,000 teams" }], priority: "high", riskCategory: "claim_validation",
  effortMinutes: 3, rewardWeight: 5, maxCompletions: 3, verificationMethod: "observation", confidence: 0.8, conditions: [], assumptions: [], disallowed: [],
  anchors: ["Trusted by 5,000 teams"],
  groundingV1: { observationSetDigest: claimSet.digest, criteria: [{ criterionIndex: 0, criterionKind: "content_claim", factRefs: [claimFact.id], transitionRef: null, evidenceIndex: 0, evidenceMode: "observation", pageUrl: claimFact.pageUrl, stateId: claimFact.stateId, supportRationale: "the claim text was observed on the page" }] },
}] };

/* ─────────── append-only ledger + cumulative 5-call cap ─────────── */
interface LedgerCall { seq: number; fixture: string; role: string; startedAt: string; completedAt: string | null; outcomeCode: string | null; terminalState: string }
interface StepResult { id: string; classification: string; metrics: Record<string, unknown> }
interface Ledger { evaluationId: string; hardCap: number; callsConsumed: number; calls: LedgerCall[]; stepResults: Record<string, StepResult> }
let ledger: Ledger = { evaluationId: EVAL_ID, hardCap: CAP, callsConsumed: 0, calls: [], stepResults: {} };
const persistLedger = () => { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2)); };

let realComplete: typeof import("@/lib/llm/complete");
let fakeArchitect = false;
let currentFixture = "";
let ghostArchitectMentioned = false;

async function dispatcher(opts: { system: string; user: string; parsePolicy?: string }): Promise<unknown> {
  const isArch = opts.system.includes("GROUNDED mission architect");
  const isCrit = opts.system.includes("grounding CRITIC");
  if (!isArch && !isCrit) return { json: { missions: [{ missionKey: "legacy-fixture", title: "Legacy fixture", objective: "placeholder legacy objective", instructions: "1. no-op", targetSurface: "https://x.example/" }] }, model: "legacy-fake", provider: "fake", latencyMs: 0, promptTokens: 0, completionTokens: 0, parsePolicy: "repair", finishReason: "stop", repaired: false, responseModel: "legacy-fake" };
  if (isArch && fakeArchitect) return { json: FAKE_STATE_CLAIM_ARCHITECT, model: "fake-architect", provider: "fake", latencyMs: 0, promptTokens: 0, completionTokens: 0, parsePolicy: "strict", finishReason: "stop", repaired: false, responseModel: "fake-architect" };
  // real V2 call under the cumulative cap
  if (opts.parsePolicy !== "strict") throw new Error("llm_v2_not_strict");
  if (ledger.callsConsumed >= CAP) throw new Error("llm_call_cap_reached"); // refuse — never exceed five
  const rec: LedgerCall = { seq: ledger.callsConsumed + 1, fixture: currentFixture, role: isArch ? "architect" : "critic", startedAt: new Date().toISOString(), completedAt: null, outcomeCode: null, terminalState: "in_flight" };
  ledger.calls.push(rec); ledger.callsConsumed += 1; persistLedger(); // PERSIST before dispatch
  try {
    const r = await realComplete.llmCompleteJson(opts as never); // REAL, once, no retry
    rec.completedAt = new Date().toISOString(); rec.outcomeCode = "ok"; rec.terminalState = "completed"; persistLedger();
    if (isArch) { const t = JSON.stringify((r as { json?: unknown }).json ?? "").toLowerCase(); ghostArchitectMentioned = /export|csv|download|spreadsheet|\.xlsx/.test(t); }
    return r;
  } catch (e) {
    rec.completedAt = new Date().toISOString(); rec.outcomeCode = e instanceof LlmCompletionError ? e.code : (e instanceof Error ? e.message.slice(0, 40) : "error"); rec.terminalState = "failed"; persistLedger();
    throw e;
  }
}

/* ─────────── served-model normalization (unexplained substitution stops the run) ─────────── */
const normModel = (m: string | null | undefined) => (m ?? "").replace(/^(google|anthropic|openai|meta|mistral)\//, "").replace(/-\d{6,}$/, "");
const servedExplained = (requested: string, served: string | null) => !served || normModel(requested) === normModel(served);

function metricsOf(gs: GroundingShadowResult | undefined) {
  if (!gs) return { error: "no_shadow" };
  return { architectStatus: gs.architectStatus, criticStatus: gs.criticStatus, criticErrorCode: gs.criticErrorCode, architectErrorCode: gs.architectErrorCode,
    candidateCount: gs.candidateCount, groundingValid: gs.groundingValid, criticSupported: gs.criticSupported, canonicalGatePassed: gs.canonicalGatePassed, accepted: gs.accepted,
    tierCounts: gs.tierCounts, unsafeTransitionCount: gs.unsafeTransitionCount, exactBudgetEquality: gs.exactBudgetEquality, allocatedBudgetBase: gs.allocatedBudgetBase,
    architectContentShape: gs.architectContentShape, criticContentShape: gs.criticContentShape, criticHttpStatus: gs.criticHttpStatus, criticRetryAfterMs: gs.criticRetryAfterMs,
    architectModelRequested: gs.architectModelRequested, architectModelActual: gs.architectModelActual, architectProvider: gs.architectProvider,
    criticModelRequested: gs.criticModelRequested, criticModelActual: gs.criticModelActual, criticProvider: gs.criticProvider, criticResponseSchemaName: gs.criticResponseSchemaName,
    architectPromptTokens: gs.architectPromptTokens, architectCompletionTokens: gs.architectCompletionTokens, architectLatencyMs: gs.architectLatencyMs,
    criticPromptTokens: gs.criticPromptTokens, criticCompletionTokens: gs.criticCompletionTokens, criticLatencyMs: gs.criticLatencyMs,
    canonicalRejectionCodes: gs.canonicalRejectionCodes, architectSchemaErrorPaths: gs.architectSchemaErrorPaths };
}

/** classify the step-1 critic-only compatibility test precisely. */
function classifyStep1(gs: GroundingShadowResult | undefined): string {
  if (!gs) return "inconclusive";
  if (gs.criticErrorCode === "llm_status_429") return "quota_blocked";
  if (gs.criticStatus === "provider_error" && gs.criticHttpStatus === 400) return "structured_contract_unsupported";
  if (gs.criticStatus === "provider_error") return "critic_transport_error"; // other transport error
  if (gs.criticStatus === "strict_parse_error") return "structured_contract_violated";
  if (gs.criticStatus === "ok" && gs.criticSupported >= 1 && gs.canonicalGatePassed >= 1 && gs.tierCounts.state_seen >= 1 && gs.exactBudgetEquality) return "ok";
  if (gs.criticStatus === "ok") return "critic_semantic_failed";
  return "inconclusive";
}

describe.runIf(DRYRUN || PAID)(`grounded architect — structured-output critic closure (${EVAL_ID})`, () => {
  beforeAll(async () => {
    if (PAID) { try { process.loadEnvFile(path.resolve(".env")); } catch { /* key may already be present */ } }
    realComplete = (await vi.importActual("@/lib/llm/complete")) as typeof import("@/lib/llm/complete");
    vi.mocked(llmCompleteJson).mockImplementation(dispatcher as never);
    process.env.MISSION_MODEL = ARCH_MODEL;
    process.env.MISSION_GROUNDING_CRITIC_MODEL = CRITIC_MODEL;
    process.env.MISSION_GROUNDING_MODE = "shadow";
  });

  it.runIf(DRYRUN)("DRY-RUN — plans the run and makes ZERO provider calls", () => {
    console.log("[structured-smoke] DRY-RUN plan:\n" + JSON.stringify({
      evaluationId: EVAL_ID, hardCap: CAP, requestedModels: { architect: ARCH_MODEL, critic: CRITIC_MODEL },
      responseFormat: "json_schema (strict:true) — sage_grounded_architect_v2 / sage_grounded_critic_v2",
      sequence: ["step1 state_claim critic-only (fake architect, REAL Haiku critic) — max 1 call", "step2 safe_replay (real architect+critic) — max 2", "step3 ghost_export (real architect, critic if candidate) — max 2"],
      ledgerPath: LEDGER_PATH, evidencePath: EVIDENCE_PATH, confirm: "GROUNDING_STRUCTURED_CONFIRM=CALL_CAP_5",
      stopConditions: ["429 quota", "auth/billing", "HTTP 400 schema incompat", "strict_parse (structured_contract_violated)", "schema_invalid", "unexplained served-model substitution"],
    }, null, 2));
    expect(ledger.callsConsumed).toBe(0);
    expect(claimFact).toBeTruthy();
    expect(replayTransId).toBeTruthy();
  });

  it.runIf(PAID)("LIVE — cumulative ≤5 real calls, append-only ledger, json_schema critic", async () => {
    expect(process.env.GROUNDING_STRUCTURED_CONFIRM).toBe("CALL_CAP_5");
    if (fs.existsSync(LEDGER_PATH)) ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")); // cumulative — never reset
    ledger.stepResults = ledger.stepResults ?? {};
    persistLedger();

    const steps: StepResult[] = [];
    let stop = false;
    let modelSubstitution: string | null = null;
    // only compare a REAL role's served model (the faked step-1 architect is "fake-architect", not a substitution).
    const checkServed = (gs: GroundingShadowResult | undefined) => {
      if (!gs) return;
      if (gs.criticModelActual && !servedExplained(CRITIC_MODEL, gs.criticModelActual)) modelSubstitution = `critic ${CRITIC_MODEL}→${gs.criticModelActual}`;
      if (!fakeArchitect && gs.architectModelActual && !servedExplained(ARCH_MODEL, gs.architectModelActual)) modelSubstitution = `architect ${ARCH_MODEL}→${gs.architectModelActual}`;
    };
    const save = (r: StepResult) => { ledger.stepResults[r.id] = r; persistLedger(); return r; }; // resume-durable

    // STEP 1 — state_claim critic-only (fake architect, REAL Haiku critic). Max 1 call. Resume-skips if done.
    fakeArchitect = true; currentFixture = "state_claim";
    let s1r = ledger.stepResults["state_claim"];
    if (!s1r) {
      const s1 = ledger.callsConsumed < CAP ? (await runMissionBrain(buildMap(claimFT), input("Validate that the public 'Trusted by 5,000 teams' claim is reachable and accurately reported.", claimFT.startUrl), scopeFromObservations(claimObs, []), buildObservationCorpus(claimObs, claimFT))).groundingShadow : undefined;
      checkServed(s1);
      s1r = save({ id: "state_claim", classification: classifyStep1(s1), metrics: metricsOf(s1) });
    }
    steps.push(s1r);
    if (s1r.classification !== "ok" || modelSubstitution) stop = true;

    // STEP 2 — safe_replay (real architect + critic). Max 2 calls. Only if step 1 passed.
    if (!stop) {
      fakeArchitect = false; currentFixture = "safe_replay";
      let s2r = ledger.stepResults["safe_replay"];
      if (!s2r) {
        const s2 = ledger.callsConsumed < CAP ? (await runMissionBrain(buildMap(replayFT, replayTransId), input("Test that clicking Load report reliably reaches the observed report outcome.", replayFT.startUrl), scopeFromObservations(replayObs, []), buildObservationCorpus(replayObs, replayFT))).groundingShadow : undefined;
        checkServed(s2);
        const ok = !!s2 && s2.architectStatus === "ok" && s2.criticStatus === "ok" && s2.tierCounts.action_replayed >= 1 && s2.canonicalGatePassed >= 1 && s2.exactBudgetEquality && s2.unsafeTransitionCount === 0;
        s2r = save({ id: "safe_replay", classification: ok ? "ok" : (s2?.criticErrorCode === "llm_status_429" ? "quota_blocked" : "failed"), metrics: metricsOf(s2) });
      }
      steps.push(s2r);
      if (s2r.classification !== "ok" || modelSubstitution) stop = true;
    }

    // STEP 3 — ghost_export (real architect; critic only if a candidate is produced). Max 2 calls.
    if (!stop) {
      fakeArchitect = false; currentFixture = "ghost_export";
      let s3r = ledger.stepResults["ghost_export"];
      if (!s3r) {
        const s3 = ledger.callsConsumed < CAP ? (await runMissionBrain(buildMap(ghostFT), input("Test the Export CSV workflow: download all of my tasks as a CSV file.", ghostFT.startUrl), scopeFromObservations(ghostObs, []), buildObservationCorpus(ghostObs, ghostFT))).groundingShadow : undefined;
        checkServed(s3);
        const ok = !!s3 && s3.accepted === 0 && s3.criticSupported === 0 && s3.architectStatus === "ok";
        s3r = save({ id: "ghost_export", classification: ok ? "ok" : (s3?.criticErrorCode === "llm_status_429" ? "quota_blocked" : "failed"), metrics: { ...metricsOf(s3), ghostArchitectMentioned } });
      }
      steps.push(s3r);
    }

    // recommendation + conclusiveness
    const anyQuota = steps.some((s) => s.classification === "quota_blocked");
    const step1 = steps.find((s) => s.id === "state_claim")!;
    let recommendation: string;
    if (modelSubstitution) recommendation = "inconclusive";
    else if (anyQuota) recommendation = "quota_blocked";
    else if (step1.classification === "structured_contract_unsupported") recommendation = "structured_contract_unsupported";
    else if (step1.classification === "structured_contract_violated") recommendation = "structured_contract_violated";
    else if (step1.classification === "critic_semantic_failed") recommendation = "critic_semantic_failed";
    else if (steps.length === 3 && steps.every((s) => s.classification === "ok")) recommendation = "structured_smoke_green";
    else recommendation = "inconclusive";

    const configurationConclusive = !anyQuota && !modelSubstitution && ["ok", "structured_contract_unsupported", "structured_contract_violated", "critic_semantic_failed"].includes(step1.classification);
    const capabilityConclusive = recommendation === "structured_smoke_green" || recommendation === "critic_semantic_failed";

    const evidence = {
      artifact: EVAL_ID, note: "structured-output critic closure — NOT model approval, NOT promotion-ready",
      timestamp: new Date().toISOString(), callsConsumed: ledger.callsConsumed, hardCap: CAP, ledgerPath: path.basename(LEDGER_PATH),
      requestedModels: { architect: ARCH_MODEL, critic: CRITIC_MODEL }, responseFormat: "json_schema strict:true",
      transportSchemas: { architect: "sage_grounded_architect_v2", critic: "sage_grounded_critic_v2" },
      modelSubstitution, configurationConclusive, capabilityConclusive, steps, recommendation,
      hypothesis: "Did json_schema (vs json_object) let the strict parser accept the Haiku critic's output?",
    };
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
    // NOTE: the ledger is intentionally NOT deleted (append-only audit of paid spend).
    console.log(`[structured-smoke] recommendation=${recommendation} callsConsumed=${ledger.callsConsumed} configConclusive=${configurationConclusive} capConclusive=${capabilityConclusive}`);
    console.log(`[structured-smoke] step1 critic: ${step1.classification}`);

    expect(ledger.callsConsumed).toBeLessThanOrEqual(CAP);
  }, 180_000);
});
