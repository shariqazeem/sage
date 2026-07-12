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
import {
  ARCHITECT_SYSTEM,
  CRITIC_SYSTEM,
  MISSION_PROMPT_VERSION,
  buildArchitectUser,
  buildCriticUser,
} from "./mission-prompt";
import { validatePlanMissions, type ValidationScope } from "./validate-mission";
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

const asStr = (v: unknown, max = 6000): string => (typeof v === "string" ? v.slice(0, max) : "");
const asArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => (x as string).slice(0, 600)) : []);
const clampNum = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
};
const asFloat = (v: unknown, dflt: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : dflt;
};

function coerceSources(v: unknown): SourceRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      const kind = o.kind === "repo" ? "repo" : o.kind === "founder" ? "founder" : "page";
      return { kind, ref: asStr(o.ref, 600), observation: asStr(o.observation, 400) } as SourceRef;
    })
    .filter((s) => s.ref.length > 0)
    .slice(0, 6);
}

function slug(s: string): string {
  return norm(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "mission";
}

/** Coerce a raw model object into a well-typed CandidateMission (or null if unusable). */
function coerceMission(raw: unknown, i: number): CandidateMission | null {
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
}

const EMPTY = (reason: string): MissionBrainResult => ({
  ok: false, reason, candidates: [], critiques: [], accepted: [], reports: [],
  needsInputQuestions: [], model: "", provider: "", promptVersion: MISSION_PROMPT_VERSION, latencyMs: 0,
});

/** A tight map summary for the LLM — exact URLs (valid targets/citations) + surfaces,
 *  without the verbose sources/snippets that overwhelm the model on content-heavy sites. */
function compactMapForLlm(map: ProductMapV1): string {
  const vals = (f: { value: string }[], n = 12) => f.slice(0, n).map((x) => x.value);
  const inspectedUrls = [...new Set(map.routes.flatMap((r) => r.sources.map((s) => s.ref)))].slice(0, 14);
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
  });
}

async function architect(map: ProductMapV1, founder: FounderLaunchInput): Promise<{ candidates: CandidateMission[]; model: string; provider: string; latencyMs: number } | null> {
  const mapJson = compactMapForLlm(map);
  // The architect is the differentiator; the configured model is occasionally flaky
  // (returns empty/unparseable JSON). Retry a few times with slight temperature
  // variation before degrading honestly to a "failed" state.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await llmCompleteJson({
        system: ARCHITECT_SYSTEM,
        user: buildArchitectUser(mapJson, { goal: founder.goal, targetUsers: founder.targetUsers, missionCountHint: "3 to 6" }),
        maxTokens: 4000,
        temperature: attempt === 0 ? 0.3 : attempt === 1 ? 0.15 : 0.4,
      });
      const arr = (r.json as { missions?: unknown[] })?.missions;
      if (!Array.isArray(arr)) continue;
      const candidates = dedupeKeys(arr.map((m, i) => coerceMission(m, i)).filter((m): m is CandidateMission => m !== null));
      if (candidates.length === 0) continue;
      return { candidates, model: r.model, provider: r.provider, latencyMs: r.latencyMs };
    } catch {
      /* retry once */
    }
  }
  return null;
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
export async function runMissionBrain(
  map: ProductMapV1,
  founder: FounderLaunchInput,
  scope: ValidationScope,
): Promise<MissionBrainResult> {
  if (!llmConfigured()) return EMPTY("llm_not_configured");
  if (map.pagesInspected === 0) return EMPTY("no_inspected_pages");

  const arch = await architect(map, founder);
  if (!arch) return EMPTY("architect_failed");

  const critiques = await critic(arch.candidates, map);
  const byKey = new Map(critiques.map((c) => [c.missionKey, c]));
  const needsInputQuestions: string[] = [];

  // apply the critic: revise → corrected, reject/needs_input → drop, else keep.
  const survivors: CandidateMission[] = [];
  for (const cand of arch.candidates) {
    const verdict = byKey.get(cand.missionKey);
    if (!verdict || verdict.decision === "accept" || verdict.decision === "merge") survivors.push(cand);
    else if (verdict.decision === "revise" && verdict.revised) survivors.push({ ...verdict.revised, missionKey: cand.missionKey });
    else if (verdict.decision === "needs_input" && verdict.question) needsInputQuestions.push(verdict.question);
    // reject → dropped
  }

  // deterministic gate — the final authority. Only issue-free missions are accepted.
  const deduped = dedupeKeys(survivors);
  const reports = validatePlanMissions(deduped, scope);
  const accepted = deduped.filter((_m, i) => reports[i].ok);

  for (const q of map.openQuestions) if (!needsInputQuestions.includes(q)) needsInputQuestions.push(q);

  return {
    ok: accepted.length > 0,
    reason: accepted.length > 0 ? null : "no_missions_passed_validation",
    candidates: arch.candidates,
    critiques,
    accepted,
    reports,
    needsInputQuestions,
    model: arch.model,
    provider: arch.provider,
    promptVersion: MISSION_PROMPT_VERSION,
    latencyMs: arch.latencyMs,
  };
}
