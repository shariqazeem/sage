import "server-only";

/**
 * The Mission Brain: architect → critic → deterministic quality gate. It calls the
 * REAL configured LLM (never a mock presented as real), parses its JSON defensively,
 * lets an independent critic accept/revise/reject each candidate, then runs EVERY
 * survivor through the deterministic validator (`validatePlanMissions`) so no unsafe,
 * hallucinated, or injected mission can reach the founder. Model output is untrusted
 * until it passes the gate.
 */

import { llmCompleteJson, llmConfigured } from "@/lib/llm/complete";
import { backoffMs } from "@/lib/llm/retry";
import { missionModel } from "@/lib/llm/mission-model";
import {
  ARCHITECT_SYSTEM,
  CRITIC_SYSTEM,
  MISSION_PROMPT_VERSION,
  buildArchitectUser,
  buildCriticUser,
} from "./mission-prompt";
import { validatePlanMissions, classifyVerifiability, observationScore, SUFFICIENCY_THRESHOLD, type ValidationScope } from "./validate-mission";
import { detectGatedActions, alreadyCovered, buildGatedActionMission } from "./gated-action-mission";
import type { GroundingShadowResult } from "./mission-grounding-shadow";
import { fieldTestForMap } from "./field-test";
import { hasUsableInspection } from "./product-map";
import { norm } from "./schemas";
import type {
  CandidateMission,
  FounderLaunchInput,
  MissionCritique,
  MissionPriority,
  MissionRiskCategory,
  MissionValidationReport,
  ProductMapV1,
  SourceRef,
} from "./schemas";

const RISK: MissionRiskCategory[] = [
  "critical_journey", "onboarding", "responsive", "wallet_payment", "claim_validation",
  "error_recovery", "accessibility", "cross_browser", "docs_consistency", "trust_safety", "regression",
];

/**
 * SHAPE TOLERANCE — a model asked for "instructions" answers with a paragraph on one call and a
 * list of numbered steps on the next; both are the same mission. Sage's RECEIVING parser accepts
 * either and normalizes, because throwing the mission away costs the founder the whole inspection
 * (a real production failure: every candidate dropped → `schema_mismatch` on a product Sage had
 * fully explored). This loosens only what Sage will READ. Nothing downstream is loosened — the
 * deterministic validate gate, the anchor check, and the grounding/coverage rules are untouched,
 * so a mission still has to earn acceptance on its content.
 */
const TEXT_KEYS = ["text", "step", "instruction", "description", "value", "label", "title"] as const;
function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of TEXT_KEYS) if (typeof o[k] === "string" && o[k]) return o[k] as string;
  }
  return "";
}
/** A required text field: string, a list of steps, or an object carrying the text. */
const asStr = (v: unknown, max = 6000): string => {
  if (typeof v === "string") return v.slice(0, max);
  if (Array.isArray(v)) {
    const lines = v.map(textOf).filter((s) => s.trim().length > 0);
    return lines.join("\n").slice(0, max);
  }
  return textOf(v).slice(0, max);
};
/** A list field: a real array, or a single item the model didn't bother to wrap. */
const asArr = (v: unknown): string[] => {
  const items = Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];
  return items
    .map(textOf)
    .filter((s) => s.trim().length > 0)
    .map((s) => s.slice(0, 600));
};
const clampNum = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
};
const asFloat = (v: unknown, dflt: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : dflt;
};

function coerceSources(v: unknown): SourceRef[] {
  const items = Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];
  return items
    .map((s) => {
      // A bare "https://…" is the same citation as {kind:"page", ref:"https://…"} — read both.
      if (typeof s === "string") {
        return { kind: "page", ref: s.slice(0, 600), observation: "" } as SourceRef;
      }
      const o = (s ?? {}) as Record<string, unknown>;
      const kind = o.kind === "repo" ? "repo" : o.kind === "founder" ? "founder" : "page";
      const ref = asStr(o.ref, 600) || asStr(o.url, 600);
      return { kind, ref, observation: asStr(o.observation, 400) } as SourceRef;
    })
    .filter((s) => s.ref.length > 0)
    .slice(0, 6);
}

function slug(s: string): string {
  return norm(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "mission";
}

/** Extract the missions array from the model's JSON, tolerating common shape variations. */
function extractMissionArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  const o = (json ?? {}) as Record<string, unknown>;
  for (const k of ["missions", "Missions", "testingMissions", "plan", "data", "result"]) {
    const v = o[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object" && Array.isArray((v as Record<string, unknown>).missions)) return (v as { missions: unknown[] }).missions;
  }
  // a single mission object returned bare (has a title + objective) → wrap it.
  if (typeof o.title === "string" && typeof o.objective === "string") return [o];
  return [];
}

/** Coerce a raw model object into a well-typed CandidateMission (or null if unusable). */
export function coerceMission(raw: unknown, i: number): CandidateMission | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const title = asStr(o.title, 140);
  const objective = asStr(o.objective, 600);
  const instructions = asStr(o.instructions, 6000);
  const targetSurface = asStr(o.targetSurface, 600);
  if (!title || !objective || !instructions || !targetSurface) return null;
  const riskCategory = (RISK.includes(o.riskCategory as MissionRiskCategory) ? o.riskCategory : "critical_journey") as MissionRiskCategory;
  const priority = (["high", "medium", "low"].includes(o.priority as string) ? o.priority : "medium") as MissionPriority;
  return {
    missionKey: slug(asStr(o.missionKey, 48) || title) + (i >= 0 ? "" : ""),
    title,
    objective,
    instructions,
    targetSurface: norm(targetSurface),
    criteria: asArr(o.criteria).slice(0, 12),
    evidenceRequirements: asArr(o.evidenceRequirements).slice(0, 12),
    whyItMatters: asStr(o.whyItMatters, 800),
    sources: coerceSources(o.sources),
    priority,
    riskCategory,
    effortMinutes: clampNum(o.effortMinutes, 3, 240, 20),
    conditions: asArr(o.conditions).slice(0, 8),
    rewardWeight: clampNum(o.rewardWeight, 1, 10, 5),
    maxCompletions: clampNum(o.maxCompletions, 1, 50, 3),
    verificationMethod: asStr(o.verificationMethod, 800),
    confidence: asFloat(o.confidence, 0.6),
    assumptions: asArr(o.assumptions).slice(0, 6),
    disallowed: asArr(o.disallowed).slice(0, 8),
    anchors: asArr(o.anchors).slice(0, 12),
  };
}

/** Ensure mission keys are unique + kebab (defensive against model collisions). */
function dedupeKeys(missions: CandidateMission[]): CandidateMission[] {
  const seen = new Map<string, number>();
  return missions.map((m) => {
    const base = m.missionKey;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? m : { ...m, missionKey: `${base}-${n + 1}` };
  });
}

export interface MissionBrainResult {
  ok: boolean;
  reason: string | null;
  candidates: CandidateMission[];
  critiques: MissionCritique[];
  accepted: CandidateMission[];
  reports: MissionValidationReport[];
  needsInputQuestions: string[];
  model: string;
  provider: string;
  promptVersion: string;
  latencyMs: number;
  /** S2 grounded-architect shadow telemetry (present only when MISSION_GROUNDING_MODE ≠ off). Advisory;
   *  it never changes `accepted` / the legacy plan. */
  groundingShadow?: GroundingShadowResult;
}

/** The set of transition ids the shadow replay reproduced, from the inspection's leak-safe record. */
function replayReproducedSet(map: ProductMapV1): ReadonlySet<string> {
  return new Set((map.replayShadow?.results ?? []).filter((r) => r.classification === "reproduced").map((r) => r.transitionId));
}

const EMPTY = (reason: string): MissionBrainResult => ({
  ok: false, reason, candidates: [], critiques: [], accepted: [], reports: [],
  needsInputQuestions: [], model: "", provider: "", promptVersion: MISSION_PROMPT_VERSION, latencyMs: 0,
});

/** A tight map summary for the LLM — exact URLs (valid targets/citations) + surfaces,
 *  without the verbose sources/snippets that overwhelm the model on content-heavy sites. */
export function compactMapForLlm(map: ProductMapV1): string {
  const vals = (f: { value: string }[], n = 12) => f.slice(0, n).map((x) => x.value);
  // inspectedUrls must include the FIELD TEST's really-visited pages/states: on a bot-walled/SPA
  // product the static routes are empty, and telling the architect "targetSurface MUST be one of []"
  // guaranteed an out-of-scope rejection for every mission it could ever write.
  const inspectedUrls = [
    ...new Set([
      ...map.routes.flatMap((r) => r.sources.map((s) => s.ref)),
      ...(map.fieldTest?.pages ?? []).map((p) => p.url),
      ...(map.fieldTest?.states ?? []).map((s) => s.url),
    ]),
  ].filter(Boolean).slice(0, 14);
  return JSON.stringify({
    productName: map.productName,
    category: map.category,
    valueProp: map.valueProp,
    founderTargetUsers: map.founderTargetUsers,
    inspectedUrls,
    routes: vals(map.routes, 14),
    primaryJourney: vals(map.primaryJourney),
    interactiveSurfaces: vals(map.interactiveSurfaces),
    trustSurfaces: vals(map.trustSurfaces),
    claimRisks: vals(map.claimRisks),
    observedStates: vals(map.observedStates),
    repoOnlyCapabilities: vals(map.repoOnlyCapabilities),
    limitations: map.limitations,
    openQuestions: map.openQuestions,
    pagesInspected: map.pagesInspected,
    repoFilesInspected: map.repoFilesInspected,
    note: "targetSurface and every cited page source MUST be one of inspectedUrls.",
    // Field-test observations (only present when Sage actually browsed the product). When
    // absent, this spread contributes nothing and the JSON is byte-identical to before.
    ...(map.fieldTest && (map.fieldTest.pages.length > 0 || map.fieldTest.states.length > 0) ? { fieldTest: fieldTestForMap(map.fieldTest) } : {}),
  });
}

/** Wait before the next attempt: seconds for a provider hiccup, a short jitter for a shape failure.
 *  The old ladder waited ~3s across five tries — too fast to outlive an outage worth waiting for. */
const jitter = (attempt: number, lastError?: unknown) =>
  new Promise((res) => setTimeout(res, backoffMs(attempt, lastError ?? new Error("shape"))));

/** Classify an architect failure for durable observability. */
function classifyBrainError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/unparseable/.test(m)) return "invalid_json";
  if (/empty/.test(m)) return "truncated_output";
  if (/status_(408|429|5\d\d)/.test(m)) return "provider_transient";
  if (/status_/.test(m)) return "provider_error";
  if (/abort|timeout/i.test(m)) return "provider_timeout";
  if (/not_configured/.test(m)) return "llm_not_configured";
  return "provider_error";
}

type ArchitectResult =
  | { ok: true; candidates: CandidateMission[]; model: string; provider: string; latencyMs: number }
  | { ok: false; error: string };

async function architect(map: ProductMapV1, founder: FounderLaunchInput, correction?: string): Promise<ArchitectResult> {
  const mapJson = compactMapForLlm(map);
  // Recovery ladder: retry transient/parse failures with jitter + temperature variation.
  // A `correction` (the deterministic validation errors from a prior round) steers the
  // model to fix specific problems rather than blindly regenerate. Never canned output.
  let lastError = "architect_failed";
  let lastThrown: unknown = null; // the raw error, so a provider hiccup waits and a shape failure doesn't
  for (let attempt = 0; attempt < 5; attempt++) {
    await jitter(attempt, lastThrown);
    try {
      const base = buildArchitectUser(
        mapJson,
        { goal: founder.goal, targetUsers: founder.targetUsers, missionCountHint: "3 to 6" },
        { hasFieldTest: !!(map.fieldTest && (map.fieldTest.pages.length > 0 || map.fieldTest.states.length > 0)) },
      );
      // On a repeated schema failure, add an explicit shape reminder (model-independent nudge).
      const shapeNudge = attempt >= 1 ? `\n\nRespond with EXACTLY this shape and nothing else: {"missions":[ {...}, {...} ]}. The top-level key MUST be "missions" and its value MUST be a JSON array.` : "";
      const user = (correction
        ? `${base}\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED by deterministic validation for these reasons — fix them exactly (keep everything in scope, cite only inspectedUrls, no destructive/secret/wallet/fund actions):\n${correction.slice(0, 2000)}`
        : base) + shapeNudge;
      const r = await llmCompleteJson({ system: ARCHITECT_SYSTEM, user, maxTokens: 4200, temperature: attempt === 0 ? 0.3 : attempt === 1 ? 0.15 : 0.45, model: missionModel() });
      const arr = extractMissionArray(r.json);
      if (arr.length === 0) { lastError = "schema_mismatch"; continue; }
      const candidates = dedupeKeys(arr.map((m, i) => coerceMission(m, i)).filter((m): m is CandidateMission => m !== null));
      if (candidates.length === 0) { lastError = "schema_mismatch"; continue; }
      return { ok: true, candidates, model: r.model, provider: r.provider, latencyMs: r.latencyMs };
    } catch (e) {
      lastError = classifyBrainError(e);
      lastThrown = e;
      if (lastError === "llm_not_configured") break;
    }
  }
  return { ok: false, error: lastError };
}

async function critic(candidates: CandidateMission[], map: ProductMapV1): Promise<MissionCritique[]> {
  const candJson = JSON.stringify({ missions: candidates });
  const mapJson = compactMapForLlm(map);
  try {
    const r = await llmCompleteJson({
      system: CRITIC_SYSTEM,
      user: buildCriticUser(candJson, mapJson),
      maxTokens: 3000,
      temperature: 0,
      model: missionModel(),
    });
    const arr = (r.json as { critiques?: unknown[] })?.critiques;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const decision = (["accept", "revise", "merge", "reject", "needs_input"].includes(o.decision as string) ? o.decision : "accept") as MissionCritique["decision"];
        const revised = o.revised ? (coerceMission(o.revised, 0) ?? undefined) : undefined;
        return {
          missionKey: asStr(o.missionKey, 48),
          decision,
          reasons: asArr(o.reasons).slice(0, 5),
          revised,
          question: o.question ? asStr(o.question, 300) : undefined,
        } as MissionCritique;
      })
      .filter((c) => c.missionKey.length > 0);
  } catch {
    return [];
  }
}

/**
 * Run the full brain. Requires a configured LLM (honest fail otherwise). Applies the
 * critic's verdicts, then the deterministic gate; `accepted` is the founder-visible set.
 */
/** Apply the critic verdicts to candidates (revise → corrected, reject/needs_input → drop). */
function applyCritic(candidates: CandidateMission[], critiques: MissionCritique[], needsInput: string[]): CandidateMission[] {
  const byKey = new Map(critiques.map((c) => [c.missionKey, c]));
  const survivors: CandidateMission[] = [];
  for (const cand of candidates) {
    const v = byKey.get(cand.missionKey);
    if (!v || v.decision === "accept" || v.decision === "merge") survivors.push(cand);
    else if (v.decision === "revise" && v.revised) survivors.push({ ...v.revised, missionKey: cand.missionKey });
    else if (v.decision === "needs_input" && v.question && !needsInput.includes(v.question)) needsInput.push(v.question);
  }
  return survivors;
}

/** Deterministic observation-richness signals gathered from the map + corpus (for the sufficiency gate). */
function gatherRichness(map: ProductMapV1, corpus: string) {
  const ft = map.fieldTest;
  const els = new Set<string>();
  for (const s of ft?.states ?? []) for (const e of s.notableElements ?? []) if (e.text) els.add(e.text.toLowerCase());
  for (const v of ft?.visionObservations ?? []) for (const e of v.uiElements ?? []) if (e.label) els.add(e.label.toLowerCase());
  for (const p of ft?.pages ?? []) for (const c of p.ctas ?? []) els.add(c.toLowerCase());
  return {
    states: ft?.states?.length ?? 0,
    // field-test pages ARE inspected pages (read by the real browser). Counting only static-HTML
    // observations here sent a bot-walled product (0 static, 6 crawled pages) to needs_input as
    // "insufficient observation" while a full crawl sat unused on the summary.
    pages: map.pagesInspected + (ft?.pages?.length ?? 0),
    vision: ft?.visionObservations?.length ?? 0,
    distinctElements: els.size,
    textLen: corpus.length,
  };
}

/** SPECIFIC needs_input questions generated from what Sage DID see (never confabulated). */
function sufficiencyQuestions(map: ProductMapV1, founderGoal = ""): string[] {
  const qs: string[] = [];
  // NEVER ASK FOR WHAT THE FOUNDER ALREADY SAID. A founder who wrote "make users launch a campaign"
  // has already answered "what is the most important thing a tester should confirm?" — asking it back
  // is the least useful thing an agent can do, and it reads as not having listened. A goal that names
  // an action and a target is specific enough to design against; the only honest remaining question
  // is about ACCESS Sage lacks, which the questions below already cover.
  const goalIsSpecific =
    /\b(make|have|let|get|ensure|verify|confirm|check|test)\b/i.test(founderGoal) &&
    founderGoal.trim().split(/\s+/).length >= 4;
  const ft = map.fieldTest;
  const vis = ft?.visionObservations ?? [];
  const types = [...new Set(vis.flatMap((v) => v.productTypeSignals))].slice(0, 2);
  const scene = vis.map((v) => v.sceneDescription).find(Boolean);
  if (types.length && !goalIsSpecific) qs.push(`Sage's inspection was thin, but the product looks like ${types.join(" / ")}. What is the single most important thing a tester should confirm actually works?`);
  if (scene && !goalIsSpecific) qs.push(`The most Sage could see was: "${scene.slice(0, 120)}". What specific, checkable outcome would you pay a tester to demonstrate?`);
  if ((ft?.states?.length ?? 0) <= 1 && map.pagesInspected <= 1 && (ft?.pages?.length ?? 0) <= 1) qs.push("Sage could only reach the entry screen — is there a login, invite code, or specific step it needs, or (if your site blocks bots) can you allowlist Sage's requests (they carry an `x-sage-agent` header)?");
  if (qs.length === 0) {
    qs.push(
      goalIsSpecific
        ? // they told us WHAT they want; the only thing Sage is missing is a way IN.
          "Sage couldn't get far enough into your product to design missions it can verify. Is there a demo link, a test account, or a step it needs — or (if your site blocks bots) can you allowlist its requests (they carry an `x-sage-agent` header)?"
        : "Sage's inspection didn't surface enough to design paid missions with confidence. What is the one flow you most want validated, and how would a tester prove they completed it?",
    );
  }
  return qs.slice(0, 3);
}

/**
 * Questions built from WHY the designed missions died, so the founder answers the real problem.
 * Measured on production needs_input rows: a docs site whose missions the critic rejected as
 * "presence checks" was asked "where should a new user start?" — the map's generic seed question,
 * with no connection to what actually happened and no answer that would change the outcome.
 */
export function rejectionQuestionsFor(
  candidates: CandidateMission[],
  critiques: MissionCritique[],
  reports: MissionValidationReport[],
): string[] {
  const qs: string[] = [];
  const rejected = critiques.filter((c) => c.decision === "reject" && (c.reasons ?? []).length > 0);
  if (rejected.length > 0 && candidates.length > 0) {
    const first = candidates.find((m) => m.missionKey === rejected[0].missionKey) ?? candidates[0];
    const reason = ((rejected[0].reasons ?? [])[0] ?? "it could not be verified").replace(/[.\s]+$/, "");
    qs.push(
      `Sage designed ${candidates.length} mission idea${candidates.length === 1 ? "" : "s"} and rejected ${rejected.length >= candidates.length ? "all of them" : "most of them"} itself. For example "${first.title}" was rejected because: ${String(reason).slice(0, 160)}. What should a tester DO in your product, and what should be visibly true on screen once they've done it? Sage will design against that.`,
    );
  }
  const unseenCited = reports.some((rep) =>
    rep.issues.some((i) => i.code === "hallucinated_route" || i.code === "unknown_source_ref" || i.code === "target_out_of_scope"),
  );
  if (unseenCited) {
    qs.push(
      "Some mission ideas cited pages Sage never actually reached. If specific pages or flows matter most, share direct links Sage can open, or allowlist its requests (they carry an `x-sage-agent` header).",
    );
  }
  return qs.slice(0, 2);
}

export async function runMissionBrain(
  map: ProductMapV1,
  founder: FounderLaunchInput,
  scope: ValidationScope,
  corpus: string,
): Promise<MissionBrainResult> {
  if (!llmConfigured()) return EMPTY("llm_not_configured");
  // "Nothing inspected" only when the static crawl AND the real browser both saw nothing. A bot-walled
  // store or client-rendered SPA has 0 static pages but a field test — hand it to the SUFFICIENCY GATE
  // below, which judges whether what the browser DID see is rich enough to design paid work (else it
  // asks a specific question rather than confabulating). `hasUsableInspection` is the SAME shared
  // predicate the pipeline gate uses, so the two can never drift apart.
  if (!hasUsableInspection(map)) return EMPTY("no_inspected_pages");

  // SUFFICIENCY GATE — if Sage saw too little to design work worth paying for, ask the founder
  // SPECIFIC questions built from what WAS seen, rather than letting the architect confabulate a plan.
  // BUT once the founder has ANSWERED (folded into the goal), step aside and let the architect try
  // with that intent — the anchor gate still guarantees every mission stays real. This converges the
  // needs_input → answer → re-plan loop instead of asking the same question forever on a thin product.
  const answered = /Founder clarification/i.test(founder.goal);
  if (!answered && observationScore(gatherRichness(map, corpus)) < SUFFICIENCY_THRESHOLD) {
    return { ...EMPTY("insufficient_observation"), needsInputQuestions: sufficiencyQuestions(map, founder.goal) };
  }

  const needsInputQuestions: string[] = [];
  const run = async (arch: Extract<ArchitectResult, { ok: true }>) => {
    const critiques = await critic(arch.candidates, map);
    const survivors = dedupeKeys(applyCritic(arch.candidates, critiques, needsInputQuestions));
    // the anchor gate runs mechanically over the observation corpus — an unanchored ("Zoom Control")
    // claim is rejected here regardless of what the model said. The verifiability class is stamped on
    // each accepted mission (deterministic, never model-provided) for the plan's honest disclosure.
    // Eyes V2: thread the inspection's observation set so the grounding gate can check any design-time
    // grounding map a candidate carries (no-op for candidates without one — backward-compatible).
    const reports = validatePlanMissions(survivors, scope, corpus, map.observations);
    const accepted = survivors
      .filter((_m, i) => reports[i].ok)
      .map((m) => ({ ...m, verifiabilityClass: classifyVerifiability(m) }));
    return { critiques, survivors, reports, accepted };
  };

  let arch = await architect(map, founder);
  // The grounded-architect shadow (S2) is INDEPENDENT measurement: it runs whenever mode≠off and the
  // observations are sufficient, EVEN when the legacy architect returns empty / fails / produces zero
  // survivors — so its result is still recorded. It never changes the legacy externally-visible result;
  // a V2 failure is fully caught. dynamic import breaks the mission-brain ↔ shadow require cycle.
  const computeShadow = async (legacyCount: number): Promise<GroundingShadowResult | undefined> => {
    try {
      const s = await import("./mission-grounding-shadow");
      return s.missionGroundingMode() !== "off" ? await s.runGroundedShadow(map, founder, scope, corpus, legacyCount, { replayReproduced: replayReproducedSet(map) }) : undefined;
    } catch { return undefined; }
  };

  if (!arch.ok) {
    const gs = await computeShadow(0); // legacy architect failed → V2 shadow still measured
    return { ...EMPTY(arch.error), needsInputQuestions, ...(gs ? { groundingShadow: gs } : {}) };
  }
  let r = await run(arch);

  // CORRECTIVE ROUND: if nothing survived, feed the exact rejection reasons back to the architect
  // ONCE — the gate's validation issues AND the critic's verdicts. This is a real model correction —
  // never canned missions, never a weakened gate. The critic half is load-bearing: measured across
  // 56 production no_missions_passed_validation rows, 31 died at the CRITIC (mostly "presence check /
  // not worth paying for") — and zero survivors meant zero gate reports, so this round fired blind
  // and the architect regenerated the same shape of mission it had just had rejected.
  if (r.accepted.length === 0) {
    const gateIssues = r.reports.flatMap((rep) => rep.issues.map((x) => `${rep.missionKey}: ${x.code} — ${x.detail}`));
    const criticIssues = r.critiques
      .filter((c) => c.decision === "reject" || c.decision === "revise")
      .flatMap((c) => (c.reasons ?? []).slice(0, 2).map((x) => `${c.missionKey}: critic — ${x}`));
    const issues = [...gateIssues, ...criticIssues].slice(0, 10).join("; ");
    const steer = criticIssues.length > 0
      ? "\nDesign DIFFERENT missions that survive that review: each must make the tester DO something and name the specific on-screen outcome that proves it happened — never a mission that only confirms text or elements exist."
      : "";
    const arch2 = await architect(map, founder, issues ? `${issues}${steer}` : "produce specific, in-scope, non-destructive missions that cite inspectedUrls");
    if (arch2.ok) { arch = arch2; r = await run(arch2); }
  }

  // PLAN-SHAPE CORRECTIVE ROUND — ONE bounded round that fixes the two shapes a first pass gets
  // wrong, adopted ONLY when it genuinely improves the plan; the deterministic gate still judges
  // every mission.
  //   · URL FLOOR: a plan with readable page evidence should carry ≥1 url-verifiable mission (the
  //     cleanly auto-payable class) — interactive exploration otherwise drifts observation-only
  //     (the P-GEN flag on plausible.io / brittanychiang.com).
  //   · MISSION COUNT vs BUDGET: a budget that comfortably funds several distinct missions must not
  //     collapse onto one — a $10 budget with a single surviving mission paid 2 testers $5.00 each
  //     for 5-minute work (measured: commonstack.ai). More DISTINCT missions is more coverage per
  //     dollar; the effort-anchored sample policy then sizes each mission's testers fairly.
  if (r.accepted.length > 0) {
    const urlAccepted = r.accepted.filter((m) => m.verifiabilityClass === "url-verifiable").length;
    const readablePages = map.pagesInspected + (map.fieldTest?.pages?.length ?? 0);
    const wantUrl = urlAccepted === 0 && readablePages >= 2;
    // missions this budget funds at a modest ~$3 each (3 testers × ~$1) — a shape hint, not money
    // math the model sees; capped so the ask stays inside the architect's 3-6 design band.
    const fundable = Math.min(4, Number(founder.totalBudgetBase / BigInt(3_000_000)));
    const wantMore = r.accepted.length < Math.min(3, fundable);
    if (wantUrl || wantMore) {
      const asks = [
        ...(wantMore
          ? [
              `The plan has only ${r.accepted.length} mission(s) but the budget funds ${Math.min(4, fundable)} DISTINCT ones. Keep the strongest existing mission(s) and ADD more that test DIFFERENT observed parts of the product (different pages, flows, or states — never a rephrasing of an existing mission).`,
            ]
          : []),
        ...(wantUrl
          ? [
              "The plan is missing a URL-VERIFIABLE mission. ADD one mission whose criteria hinge on REACHING a specific inspected URL and QUOTING specific text found there (a public page + exact quoted text — Sage can auto-verify that). Anchor it to a real inspected page from inspectedUrls; no subjective/experiential language in that mission.",
            ]
          : []),
      ].join("\n");
      const arch3 = await architect(map, founder, asks);
      if (arch3.ok) {
        const r3 = await run(arch3);
        const url3 = r3.accepted.filter((m) => m.verifiabilityClass === "url-verifiable").length;
        const urlOk = !wantUrl || url3 >= 1;
        const moreOk = !wantMore || r3.accepted.length > r.accepted.length;
        if (urlOk && moreOk && r3.accepted.length >= r.accepted.length) {
          arch = arch3;
          r = r3;
        }
      }
    }
  }

  // THE GATED ACTION THE FOUNDER ASKED FOR. Some of what a founder most wants proven sits behind a
  // boundary Sage must never cross — buying credits, paying for compute, registering a real account.
  // Sage reaches the gate, sees it, and correctly stops; the architect then has nothing observable to
  // design against and writes about whatever it COULD reach. Measured live on clawup.org at $400 with
  // the goal "testers must launch an agent, which requires purchasing credits": the plan that came
  // back was a single mission about the brand guidelines page.
  //
  // A person with their own payment method walks straight through that gate. So the mission is built
  // deterministically here rather than asked of the model: it must anchor on the doorway Sage really
  // saw and must read as url-verifiable, and both of those are mechanical checks the same gate
  // applies to every other mission. It is added ONLY when the founder's own words named the action
  // and nothing in the plan already covers it — inventing a paid step is the failure `intent-guard`
  // exists to prevent, and this must never become that in reverse.
  try {
    // The candidate lines come from the anchor CORPUS itself, split on its own separator. Any other
    // source risks proposing an anchor that is not a literal substring of it, which the gate would
    // then reject — the corpus is the definition of "what Sage observed", so read it directly.
    const observedLines = corpus.split(" • ").filter((l) => l.trim().length > 0);
    const gated = detectGatedActions(founder.goal, observedLines);
    const uncovered = gated.filter((a) => !alreadyCovered(a, r.accepted));
    if (uncovered.length > 0) {
      const built = uncovered.map((a, i) =>
        buildGatedActionMission(a, {
          // The surface must be one the validator KNOWS Sage inspected, else the mission is refused
          // as out of scope. The entry url is the safest such surface and is where the gate was read.
          targetSurface: [...scope.knownUrls].find((u) => u === founder.productUrl) ?? founder.productUrl,
          productName: map.productName,
          index: i,
        }),
      );
      // The synthesized missions face the SAME deterministic gate as model-authored ones. Anything
      // that fails it is dropped in silence — a mission Sage cannot stand behind is not an improvement.
      const gatedReports = validatePlanMissions(built, scope, corpus, map.observations);
      const gatedAccepted = built
        .filter((_m, i) => gatedReports[i].ok)
        .map((m) => ({ ...m, verifiabilityClass: classifyVerifiability(m) }));
      if (gatedAccepted.length > 0) r = { ...r, accepted: [...r.accepted, ...gatedAccepted] };

      /**
       * THE COVERAGE CONFESSION — a founder-named action with NO surviving mission is said out
       * loud, never shipped around in silence.
       *
       * This exact silence is how the clawup founder asked "make an account and try to launch an
       * agent" and received brand-asset trivia with no hint anything was missing: detection fired,
       * synthesis was attempted, the validator dropped it (correctly — nothing anchorable), and the
       * plan simply shipped smaller. Detection and synthesis are fixed upstream; this line covers
       * the residue, because there will always be residue — a product whose docs never name the
       * action, a wall with no doorway text. An advisory question costs the founder five seconds;
       * discovering the gap after funding costs their trust.
       */
      const stillUncovered = uncovered.filter((a) => !alreadyCovered(a, r.accepted));
      for (const a of stillUncovered) {
        const q = `Your goal asks for "${a.sourcePhrase.slice(0, 120)}", but Sage could not anchor a mission for that step on anything it observed or read — the plan covers the rest of your goal without it. Reply if you want to proceed anyway, or tell Sage where that step lives (a URL or doc) and it will re-plan.`;
        if (!needsInputQuestions.includes(q)) needsInputQuestions.push(q);
      }
    }
  } catch {
    /* a synthesized extra is a bonus, never a reason the whole plan fails */
  }

  // WHEN THE PLAN DIED, SAY WHY FIRST. The map's open questions are generic seeds written before any
  // mission existed; on a total rejection they used to lead (and often WERE the whole ask), which is
  // how a fully-read docs site got "where should a new user start?". The rejection-derived questions
  // carry the actual cause, so they go first and the seeds become trailing context.
  if (r.accepted.length === 0) {
    for (const q of rejectionQuestionsFor(arch.candidates, r.critiques, r.reports)) {
      if (!needsInputQuestions.includes(q)) needsInputQuestions.push(q);
    }
  }
  for (const q of map.openQuestions) if (!needsInputQuestions.includes(q)) needsInputQuestions.push(q);
  // Never dead-end the founder loop: if the gate rejected every mission but neither the critic nor the
  // map surfaced a question (e.g. a bot-walled/SPA product the browser reached but couldn't anchor a
  // mission to), fall back to the SPECIFIC sufficiency questions built from what Sage DID see — so the
  // needs_input → answer → re-plan loop always has something concrete to answer.
  if (r.accepted.length === 0 && needsInputQuestions.length === 0) {
    for (const q of sufficiencyQuestions(map, founder.goal)) if (!needsInputQuestions.includes(q)) needsInputQuestions.push(q);
  }

  const groundingShadow = await computeShadow(r.accepted.length);

  return {
    ok: r.accepted.length > 0,
    reason: r.accepted.length > 0 ? null : "no_missions_passed_validation",
    candidates: arch.candidates,
    critiques: r.critiques,
    accepted: r.accepted,
    reports: r.reports,
    ...(groundingShadow ? { groundingShadow } : {}),
    needsInputQuestions,
    model: arch.model,
    provider: arch.provider,
    promptVersion: MISSION_PROMPT_VERSION,
    latencyMs: arch.latencyMs,
  };
}
