import { describe, it, expect, vi, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * SIX-CALL GROUNDED ARCHITECT LIVE SMOKE — a tightly bounded, checkpointed paid evaluation of the grounded
 * architect + critic THROUGH the real runMissionBrain. Only the two V2 provider calls per fixture hit the
 * real gateway (ARCHITECT_SYSTEM_V2 → gemini, CRITIC_SYSTEM_V2 → haiku); the LEGACY architect/critic are
 * faked with a deterministic fixture. Everything else — strict raw parsing, Zod, validateMissionGrounding,
 * the grounded critic, validatePlanMissions, allocateBudget — runs for real.
 *
 * HARD LIMITS: ≤6 paid calls across the whole run (incl. resumes), NO retries, the call count is persisted
 * BEFORE every provider call, and the run STOPS on 429 / auth / abnormal finish / strict-parse / schema.
 *
 * Gated: nothing runs (and no key is read) unless GROUNDING_SMOKE_DRYRUN=1 (zero calls) or
 * GROUNDING_SMOKE=1 + GROUNDING_SMOKE_CONFIRM=CALL_CAP_6 (paid). So `npm run test` skips it entirely.
 */

// Mock the provider module: fake the LEGACY calls, delegate V2 to the REAL llmCompleteJson (set in beforeAll).
vi.mock("@/lib/llm/complete", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/complete")>();
  return { ...actual, llmCompleteJson: vi.fn() };
});

import { llmCompleteJson } from "@/lib/llm/complete";
import { runMissionBrain } from "./mission-brain";
import { deriveObservations } from "./observed-facts";
import { scopeFromObservations } from "./product-map";
import { buildObservationCorpus } from "./validate-mission";
import type { GroundingShadowResult } from "./mission-grounding-shadow";
import type { FieldTestState, FieldTestSummary, ProductMapV1, ProductObservation, FounderLaunchInput } from "./schemas";

const DRYRUN = process.env.GROUNDING_SMOKE_DRYRUN === "1";
const PAID = process.env.GROUNDING_SMOKE === "1";
const RESUME = process.env.GROUNDING_SMOKE_RESUME === "1";
const CAP = 6;
const ARCH_MODEL = "google/gemini-3.1-flash-lite-preview";
const CRITIC_MODEL = "anthropic/claude-haiku-4-5";
const EVIDENCE_DIR = path.resolve("promotion-evidence");
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, "grounded-architect-smoke-v1.json");
const CHECKPOINT_PATH = path.join(EVIDENCE_DIR, "grounded-architect-smoke-v1.checkpoint.json");

/* ─────────────────────────────── three controlled fixtures ─────────────────────────────── */
const stt = (o: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://x.example/", networkMethods: ["GET"], ...o });
const obs = (url: string, o: Partial<ProductObservation>): ProductObservation => ({ url, status: 200, title: "", headings: [], claims: [], ctas: [], forms: [], links: [], authBoundary: false, techHints: [], states: [], landmarks: [], snippets: [], inspectedAt: 1, contentSha256: "a".repeat(64), ...o });
function buildMap(fieldTest: FieldTestSummary, replayTransitionId?: string): ProductMapV1 {
  const set = deriveObservations(fieldTest);
  const finding = (v: string) => ({ value: v, confidence: 0.9, sources: [{ kind: "page" as const, ref: fieldTest.startUrl, observation: v }], browserConfirmed: true });
  const map = {
    productName: "P", category: "app", valueProp: "v", targetUserHypotheses: [], founderTargetUsers: "u",
    primaryJourney: [], routes: fieldTest.states.map((s) => finding(s.url)), interactiveSurfaces: [], trustSurfaces: [], claimRisks: [], observedStates: [],
    repoOnlyCapabilities: [], browserConfirmed: [], limitations: [], openQuestions: [], pagesInspected: fieldTest.states.length, repoFilesInspected: 0,
    digest: "0x00", fieldTest, observations: set,
  } as unknown as ProductMapV1;
  if (replayTransitionId) (map as { replayShadow?: unknown }).replayShadow = { version: "replay-shadow-v1", mode: "shadow", probes: 1, byClassification: { reproduced: 1 }, results: [{ probeId: "p", transitionId: replayTransitionId, classification: "reproduced" }] };
  return map;
}

// 1) state_claim — a real public claim + URL (not a button-presence check).
const claimFT: FieldTestSummary = { ran: true, startUrl: "https://acme-metrics.example/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1, states: [
  stt({ url: "https://acme-metrics.example/", visibleTextExcerpt: "Acme Metrics. See every metric in real time. Trusted by 5,000 teams. Start free trial.", notableElements: [{ tag: "h1", text: "See every metric in real time", role: "heading" }, { tag: "p", text: "Trusted by 5,000 teams", role: "note" }, { tag: "a", text: "Start free trial", role: "link" }] }),
] };
const claimObs = [obs("https://acme-metrics.example/", { title: "Acme Metrics", headings: ["See every metric in real time"], claims: ["Trusted by 5,000 teams"], ctas: ["Start free trial"], snippets: ["Trusted by 5,000 teams"] })];

// 2) safe_replay — before/after joined by ONE safe GET transition, reproduced.
const replayFT: FieldTestSummary = { ran: true, startUrl: "https://reportly.example/dashboard", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1, states: [
  stt({ url: "https://reportly.example/dashboard", visibleTextExcerpt: "Reportly dashboard. Click Load report to view this month's revenue.", notableElements: [{ tag: "button", text: "Load report", role: "button" }] }),
  stt({ trigger: "clicked 'Load report'", url: "https://reportly.example/dashboard/report", visibleTextExcerpt: "Report ready. Revenue this month is 12,400 dollars.", notableElements: [{ tag: "h2", text: "Report ready", role: "heading" }], pixelDeltaPct: 35, networkMethods: ["GET"] }),
] };
const replayTransId = deriveObservations(replayFT).transitions[0]?.id;
const replayObs = [obs("https://reportly.example/dashboard", { title: "Reportly", headings: ["Reportly dashboard"], ctas: ["Load report"], snippets: ["Click Load report to view this month's revenue"] }), obs("https://reportly.example/dashboard/report", { title: "Reportly report", headings: ["Report ready"], snippets: ["Revenue this month is 12,400 dollars"] })];

// 3) ghost_export — a legit onboarding product with NO export/CSV/download capability.
const ghostFT: FieldTestSummary = { ran: true, startUrl: "https://taskly.example/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1, states: [
  stt({ url: "https://taskly.example/app", visibleTextExcerpt: "Taskly. Your tasks for today. Add a task. Mark tasks complete. Invite a teammate.", notableElements: [{ tag: "button", text: "Add a task", role: "button" }, { tag: "button", text: "Mark complete", role: "button" }] }),
] };
const ghostObs = [obs("https://taskly.example/app", { title: "Taskly", headings: ["Your tasks for today"], ctas: ["Add a task", "Mark complete", "Invite a teammate"], snippets: ["Add a task", "Mark tasks complete"] })];

const input = (goal: string, url: string): FounderLaunchInput => ({ productUrl: url, goal, targetUsers: "u", totalBudgetBase: BigInt(2_000_000), tokenDecimals: 6 } as unknown as FounderLaunchInput);

interface Fixture { id: string; goal: string; map: () => ProductMapV1; observations: ProductObservation[]; fieldTest: FieldTestSummary; url: string }
const ALL_FIXTURES: Fixture[] = [
  { id: "state_claim", goal: "Validate that the public 'Trusted by 5,000 teams' claim is reachable and accurately reported.", map: () => buildMap(claimFT), observations: claimObs, fieldTest: claimFT, url: claimFT.startUrl },
  { id: "safe_replay", goal: "Test that clicking Load report reliably reaches the observed report outcome.", map: () => buildMap(replayFT, replayTransId), observations: replayObs, fieldTest: replayFT, url: replayFT.startUrl },
  { id: "ghost_export", goal: "Test the Export CSV workflow: download all of my tasks as a CSV file.", map: () => buildMap(ghostFT), observations: ghostObs, fieldTest: ghostFT, url: ghostFT.startUrl },
];
// Optional subset selector (GROUNDING_SMOKE_ONLY=state_claim,safe_replay) so a run can respect a running
// paid-call budget across sessions. Unset → all three fixtures (the full smoke).
const ONLY = process.env.GROUNDING_SMOKE_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const FIXTURES: Fixture[] = ONLY?.length ? ALL_FIXTURES.filter((f) => ONLY.includes(f.id)) : ALL_FIXTURES;

/* ─────────────────────────────── checkpoint + 6-call cap dispatcher ─────────────────────────────── */
type Checkpoint = { runId: string; callsConsumed: number; capMax: number; completedFixtures: string[]; currentFixture: string | null; stage: string; startedAt: string };
let ckpt: Checkpoint = { runId: "", callsConsumed: 0, capMax: CAP, completedFixtures: [], currentFixture: null, stage: "init", startedAt: "" };
const persist = () => { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(ckpt, null, 2)); };
let realComplete: typeof import("@/lib/llm/complete");
let v2ParsePolicyStrict = true;
const ghostFlag: Record<string, boolean> = {};
let scanningFixture = "";

async function dispatcher(opts: { system: string; user: string; parsePolicy?: string }): Promise<unknown> {
  const isArchitect = opts.system.includes("GROUNDED mission architect");
  const isCritic = opts.system.includes("grounding CRITIC");
  if (!isArchitect && !isCritic) {
    // LEGACY architect/critic → deterministic fixture (faked; ZERO real calls). A valid mission so the legacy
    // path coerces one and runMissionBrain reaches the shadow (whose result is all we measure).
    return { json: { missions: [{ missionKey: "legacy-fixture", title: "Legacy fixture", objective: "placeholder legacy objective for the bounded smoke", instructions: "1. no-op", targetSurface: FIXTURES.find((f) => f.url && opts.user.includes(f.url))?.url ?? "https://x.example/" }] }, model: "legacy-fake", provider: "fake", latencyMs: 0, promptTokens: 0, completionTokens: 0, parsePolicy: "repair", finishReason: "stop", repaired: false, responseModel: "legacy-fake" };
  }
  if (opts.parsePolicy !== "strict") v2ParsePolicyStrict = false; // the V2 calls MUST be strict
  if (ckpt.callsConsumed >= CAP) throw new Error("llm_call_cap_reached"); // hard stop — never exceed six
  ckpt.callsConsumed += 1; ckpt.stage = isArchitect ? "architect" : "critic"; persist(); // PERSIST before the call
  const r = await realComplete.llmCompleteJson(opts as never); // REAL provider call, exactly once (no retry)
  if (isArchitect) { const t = JSON.stringify((r as { json?: unknown }).json ?? "").toLowerCase(); ghostFlag[scanningFixture] = /export|csv|download|spreadsheet|\.xlsx/.test(t); }
  return r;
}

/* ─────────────────────────────── grading ─────────────────────────────── */
type Grade = { id: string; goal: string; fixtureDigest: string; pass: boolean; reasons: string[]; metrics: Record<string, unknown> };
function gradeFixture(fx: Fixture, gs: GroundingShadowResult | undefined): Grade {
  const reasons: string[] = [];
  const need = (cond: boolean, why: string) => { if (!cond) reasons.push(why); return cond; };
  const m = gs;
  const metrics: Record<string, unknown> = m ? {
    architectStatus: m.architectStatus, criticStatus: m.criticStatus, architectErrorCode: m.architectErrorCode, criticErrorCode: m.criticErrorCode,
    candidateCount: m.candidateCount, groundingValid: m.groundingValid, criticSupported: m.criticSupported, canonicalGatePassed: m.canonicalGatePassed,
    accepted: m.accepted, tierCounts: m.tierCounts, unsafeTransitionCount: m.unsafeTransitionCount, exactBudgetEquality: m.exactBudgetEquality,
    allocatedBudgetBase: m.allocatedBudgetBase, canonicalRejectionCodes: m.canonicalRejectionCodes, architectSchemaErrorPaths: m.architectSchemaErrorPaths, error: m.error,
    architectModelRequested: m.architectModelRequested, architectModelActual: m.architectModelActual, architectProvider: m.architectProvider,
    criticModelRequested: m.criticModelRequested, criticModelActual: m.criticModelActual, criticProvider: m.criticProvider,
    architectLatencyMs: m.architectLatencyMs, architectPromptTokens: m.architectPromptTokens, architectCompletionTokens: m.architectCompletionTokens,
    criticLatencyMs: m.criticLatencyMs, criticPromptTokens: m.criticPromptTokens, criticCompletionTokens: m.criticCompletionTokens,
    ghostMentionedByArchitect: ghostFlag[fx.id] ?? false,
  } : { error: "no_shadow" };
  if (!m) return { id: fx.id, goal: fx.goal, fixtureDigest: "none", pass: false, reasons: ["no groundingShadow result"], metrics };
  const digest = m.observationSetDigest;
  let pass: boolean;
  if (fx.id === "state_claim") {
    pass = [
      need(m.architectStatus === "ok", "architect not ok"),
      need(m.criticStatus === "ok", "critic not ok"),
      need(m.candidateCount >= 1, "no candidates"),
      need(m.groundingValid >= 1, "no grounding-valid mission"),
      need(m.criticSupported >= 1, "critic supported none"),
      need(m.canonicalGatePassed >= 1, "canonical gate passed none"),
      need(m.tierCounts.state_seen >= 1, "no state_seen tier"),
      need(m.exactBudgetEquality, "budget not exact"),
      need(m.unsafeTransitionCount === 0, "unsafe transition cited"),
    ].every(Boolean);
  } else if (fx.id === "safe_replay") {
    pass = [
      need(m.architectStatus === "ok", "architect not ok"),
      need(m.criticStatus === "ok", "critic not ok"),
      need(m.tierCounts.action_replayed >= 1, "no action_replayed tier"),
      need(m.canonicalGatePassed >= 1, "canonical gate passed none"),
      need(m.exactBudgetEquality, "budget not exact"),
      need(m.unsafeTransitionCount === 0, "unsafe transition cited"),
    ].every(Boolean);
  } else {
    // ghost_export — HONEST behavior: no ghost/unrelated mission accepted, and the critic supports none.
    pass = [
      need(m.accepted === 0, "a mission was accepted for a non-existent capability"),
      need(m.criticSupported === 0, "critic supported an unrelated/ghost mission"),
      need(m.architectStatus === "ok", "architect not ok"),
    ].every(Boolean);
  }
  return { id: fx.id, goal: fx.goal, fixtureDigest: digest, pass, reasons, metrics };
}

const isStop = (gs?: GroundingShadowResult): string | null => {
  if (!gs) return null;
  for (const [role, s, code] of [["architect", gs.architectStatus, gs.architectErrorCode], ["critic", gs.criticStatus, gs.criticErrorCode]] as const) {
    if (s === "provider_error" || s === "strict_parse_error" || s === "schema_invalid") return `${role}:${s}:${code ?? ""}`;
  }
  return null;
};

/* ─────────────────────────────── the harness ─────────────────────────────── */
describe.runIf(DRYRUN || PAID)("grounded architect — six-call live smoke", () => {
  beforeAll(async () => {
    if (PAID) { try { process.loadEnvFile(path.resolve(".env")); } catch { /* key may already be in env */ } }
    realComplete = (await vi.importActual("@/lib/llm/complete")) as typeof import("@/lib/llm/complete");
    vi.mocked(llmCompleteJson).mockImplementation(dispatcher as never);
    process.env.MISSION_MODEL = ARCH_MODEL;
    process.env.MISSION_GROUNDING_CRITIC_MODEL = CRITIC_MODEL;
    process.env.MISSION_GROUNDING_MODE = "shadow";
  });

  it.runIf(DRYRUN)("DRY-RUN — plans the run and makes ZERO provider calls", () => {
    const plan = {
      fixtures: FIXTURES.map((f) => ({ id: f.id, goal: f.goal, digest: deriveObservations(f.fieldTest).digest })),
      requestedModels: { architect: ARCH_MODEL, critic: CRITIC_MODEL },
      maxPossiblePaidCalls: CAP,
      perFixture: "1 architect (real) + up to 1 critic (real); legacy calls are faked",
      stopConditions: ["429", "auth/billing", "abnormal/missing finish_reason", "repaired/fenced/truncated (strict_parse_error)", "schema_invalid", "unexplained served-model substitution"],
      checkpointPath: CHECKPOINT_PATH,
      evidencePath: EVIDENCE_PATH,
      guards: { start: "GROUNDING_SMOKE=1", confirm: "GROUNDING_SMOKE_CONFIRM=CALL_CAP_6", resume: "GROUNDING_SMOKE_RESUME=1" },
    };
    console.log("[grounding-smoke] DRY-RUN plan:\n" + JSON.stringify(plan, null, 2));
    expect(ckpt.callsConsumed).toBe(0);
    expect(FIXTURES.length).toBe(3);
    expect(replayTransId).toBeTruthy();
  });

  it.runIf(PAID)("LIVE — ≤6 real calls, checkpointed, writes sanitized evidence", async () => {
    expect(process.env.GROUNDING_SMOKE_CONFIRM).toBe("CALL_CAP_6"); // explicit confirmation guard
    const exists = fs.existsSync(CHECKPOINT_PATH);
    if (exists && !RESUME) throw new Error(`checkpoint exists (${CHECKPOINT_PATH}); pass GROUNDING_SMOKE_RESUME=1 to resume or delete it`);
    ckpt = exists && RESUME ? JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8")) : { runId: `smoke-${Date.now()}`, callsConsumed: 0, capMax: CAP, completedFixtures: [], currentFixture: null, stage: "init", startedAt: new Date().toISOString() };
    persist();

    const grades: Grade[] = [];
    let stopReason: string | null = null;
    for (const fx of FIXTURES) {
      if (ckpt.completedFixtures.includes(fx.id)) { grades.push({ id: fx.id, goal: fx.goal, fixtureDigest: "resumed_skip", pass: false, reasons: ["completed in a prior session (skipped on resume)"], metrics: {} }); continue; }
      ckpt.currentFixture = fx.id; scanningFixture = fx.id; persist();
      const scope = scopeFromObservations(fx.observations, []);
      const corpus = buildObservationCorpus(fx.observations, fx.fieldTest);
      const brain = await runMissionBrain(fx.map(), input(fx.goal, fx.url), scope, corpus);
      const gs = brain.groundingShadow;
      grades.push(gradeFixture(fx, gs));
      ckpt.completedFixtures.push(fx.id); persist();
      stopReason = isStop(gs);
      if (stopReason) break; // STOP the whole eval on a provider/parse/schema failure
    }

    const ranAll = FIXTURES.length === ALL_FIXTURES.length;
    const selectedAllPassed = grades.length > 0 && grades.every((g) => g.pass);
    const green = ranAll && ckpt.callsConsumed <= CAP && v2ParsePolicyStrict && !stopReason && selectedAllPassed;
    const quotaBlocked = !!stopReason?.includes("provider_error") && ckpt.callsConsumed <= 1;
    // green needs ALL THREE; a deliberate subset (budget-respecting) can be at best inconclusive.
    const recommendation = green ? "smoke_green" : quotaBlocked ? "quota_blocked" : stopReason ? "smoke_failed" : "inconclusive";

    const roleTotals = (role: "architect" | "critic") => grades.reduce((a, g) => { const md = g.metrics as Record<string, number>; a.promptTokens += Number(md[`${role}PromptTokens`] ?? 0); a.completionTokens += Number(md[`${role}CompletionTokens`] ?? 0); a.latencyMs += Number(md[`${role}LatencyMs`] ?? 0); return a; }, { promptTokens: 0, completionTokens: 0, latencyMs: 0 });

    const evidence = {
      artifact: "grounded-architect-smoke-v1", note: "one three-fixture smoke — NOT model approval and NOT promotion-ready",
      runId: ckpt.runId, timestamp: new Date().toISOString(),
      callsConsumed: ckpt.callsConsumed, hardCap: CAP, v2ParsePolicyStrict, stopReason,
      selectedFixtures: FIXTURES.map((f) => f.id), ranAllFixtures: ranAll, selectedAllPassed,
      requestedModels: { architect: ARCH_MODEL, critic: CRITIC_MODEL },
      versions: { parser: "strict-v1", architectPrompt: "ARCHITECT_SYSTEM_V2", criticPrompt: "CRITIC_SYSTEM_V2", schema: "grounding-shadow-v1" },
      roleTotals: { architect: roleTotals("architect"), critic: roleTotals("critic") },
      fixtures: grades,
      conclusive: recommendation === "smoke_green" || recommendation === "smoke_failed",
      recommendation,
    };
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
    if (fs.existsSync(CHECKPOINT_PATH)) fs.unlinkSync(CHECKPOINT_PATH); // run complete → clear the checkpoint
    console.log(`[grounding-smoke] recommendation=${recommendation} callsConsumed=${ckpt.callsConsumed} stop=${stopReason ?? "none"}`);
    console.log(`[grounding-smoke] evidence → ${EVIDENCE_PATH}`);

    expect(ckpt.callsConsumed).toBeLessThanOrEqual(CAP); // the ONE hard invariant this test enforces
  }, 180_000);
});
