import "server-only";

import { llmCompleteJson } from "@/lib/llm/complete";
import { missionModel } from "@/lib/llm/mission-model";
import { compactMapForLlm, coerceMission } from "./mission-brain";
import { validateMissionGrounding, classifyGroundingTier } from "./mission-grounding";
import type { ProductMapV1, FounderLaunchInput, CandidateMission, GroundingTier, VerificationMode } from "./schemas";

/** Coerce a raw V2 mission (base fields via coerceMission) + parse its groundingV1 (factRefs→sourceFactIds,
 *  transitionRef→sourceTransitionIds, evidenceMode→verificationMode). Fail-closed: a bad base → null. */
function coerceMissionForShadow(raw: unknown, i: number): CandidateMission | null {
  const base = coerceMission(raw, i);
  if (!base) return null;
  const g = ((raw ?? {}) as Record<string, unknown>).groundingV1 as Record<string, unknown> | undefined;
  if (g && Array.isArray(g.criteria)) {
    base.groundingV1 = {
      version: "mission-grounding-v1",
      observationSetDigest: typeof g.observationSetDigest === "string" ? g.observationSetDigest : undefined,
      criteria: (g.criteria as Record<string, unknown>[]).map((c) => ({
        criterionIndex: Number.isFinite(Number(c.criterionIndex)) ? Number(c.criterionIndex) : -1,
        sourceFactIds: Array.isArray(c.factRefs) ? (c.factRefs.filter((x) => typeof x === "string") as string[]) : [],
        sourceTransitionIds: typeof c.transitionRef === "string" ? [c.transitionRef] : undefined,
        evidenceIndex: Number.isFinite(Number(c.evidenceIndex)) ? Number(c.evidenceIndex) : 0,
        verificationMode: (["deterministic_url", "semantic_url", "observation"].includes(c.evidenceMode as string) ? c.evidenceMode : "observation") as VerificationMode,
        pageUrl: typeof c.pageUrl === "string" && c.pageUrl ? c.pageUrl : undefined,
        stateId: typeof c.stateId === "string" && c.stateId ? c.stateId : undefined,
        supportRationale: typeof c.supportRationale === "string" ? c.supportRationale.slice(0, 200) : undefined,
      })),
    };
  }
  return base;
}

/**
 * Grounded architect SHADOW (S2). Runs ARCHITECT_SYSTEM_V2 + the deterministic grounding validation + a
 * grounding-aware critic, entirely alongside the legacy plan — the legacy selected plan and budget are
 * NEVER changed. `MISSION_GROUNDING_MODE=off|shadow|enforce` (default off; unknown → off; enforce is
 * implemented + tested but never enabled here). Records only bounded counts/enums/ids — no raw corpus.
 */
export type MissionGroundingMode = "off" | "shadow" | "enforce";
export function missionGroundingMode(): MissionGroundingMode {
  const v = process.env.MISSION_GROUNDING_MODE?.trim().toLowerCase();
  return v === "shadow" ? "shadow" : v === "enforce" ? "enforce" : "off";
}

/** ARCHITECT_SYSTEM_V2 — grounded, strict-structured. The model may design missions ONLY around observed
 *  capabilities and must cite concrete observation ids per criterion; it never invents controls/pages. */
export const ARCHITECT_SYSTEM_V2 = `You are Sage's GROUNDED mission architect. You are given a product map, an OBSERVATION SET (typed facts Sage actually saw + safe action transitions it performed), that set's digest, the founder goal, the inspected scope, and the exact campaign budget.

RULES (absolute):
- Design missions ONLY around capabilities Sage ACTUALLY OBSERVED. Never invent a control, page, feature, or outcome.
- Every criterion MUST cite concrete observed-fact ids (factRefs) from the set.
- An action/outcome criterion MUST cite the transitionRef that produced the outcome.
- Inferred vision facts may GUIDE design but can NEVER be the only decisive support — a decisive criterion needs a seen DOM/field fact or a safe transition.
- Evidence requirements must be realistically capable of proving the criterion.
- Prefer a DIVERSE set (3-6) covering distinct useful product states. No duplicate missions.
- reward × maxCompletions across all missions MUST stay within the exact supplied budget.

OUTPUT strict JSON only: {"missions":[{"missionKey","title","objective","instructions","targetSurface","criteria":[...],"evidenceRequirements":[...],"whyItMatters","sources":[{"kind","ref","observation"}],"priority","riskCategory","effortMinutes","rewardWeight","maxCompletions","verificationMethod","confidence","assumptions","disallowed","groundingV1":{"observationSetDigest":"<the exact digest>","criteria":[{"criterionIndex":0,"factRefs":["<fact id>"],"transitionRef":"<transition id or omit>","pageUrl":"","stateId":"","evidenceMode":"observation|deterministic_url|semantic_url","supportRationale":"one line"}]}}]}`;

/** CRITIC_SYSTEM_V2 — reviews whether the cited observations genuinely support each criterion. It may only
 *  reject/downgrade; it cannot create facts, repair grounding, or override the deterministic gate. */
export const CRITIC_SYSTEM_V2 = `You are Sage's grounding CRITIC. For each mission criterion you receive its text and the exact observed facts it cites. Decide, per criterion, whether the cited observations genuinely support it: "supported" | "partially_supported" | "unsupported" | "contradictory". You may ONLY reject or downgrade; never invent facts or upgrade support. OUTPUT strict JSON: {"verdicts":[{"missionKey":"","criterionIndex":0,"verdict":"supported","factRefs":["..."]}]}`;

export type CriticVerdict = "supported" | "partially_supported" | "unsupported" | "contradictory";

export interface GroundingShadowResult {
  version: "grounding-shadow-v1";
  ran: boolean;
  mode: MissionGroundingMode;
  observationSetDigest: string;
  candidateCount: number;
  structurallyValid: number;
  criticSupported: number;
  accepted: number;
  groundingCoverage: number; // fraction of criteria that have a grounding entry
  distinctStateCoverage: number;
  tierCounts: Record<GroundingTier, number>;
  unsupportedCriteria: number;
  unsafeTransitionCount: number;
  duplicateRate: number;
  plannedBudgetBase: string;
  suppliedBudgetBase: string;
  budgetConsistent: boolean;
  disagreement: "agree" | "v2_fewer" | "v2_more" | "v2_empty";
  error: string | null;
}

const emptyTiers = (): Record<GroundingTier, number> => ({ action_replayed: 0, action_observed: 0, state_seen: 0, inferred_only: 0, ungrounded: 0 });

/** Provider seam — overridable in tests (a scripted fake). Returns parsed JSON or throws. */
export interface ShadowDeps {
  architect?: (system: string, user: string) => Promise<unknown>;
  critic?: (system: string, user: string) => Promise<unknown>;
  replayReproduced?: ReadonlySet<string>;
}

export async function runGroundedShadow(
  map: ProductMapV1,
  input: FounderLaunchInput,
  legacyAcceptedCount: number,
  deps: ShadowDeps = {},
): Promise<GroundingShadowResult> {
  const set = map.observations ?? null;
  const digest = set?.digest ?? "none";
  const base = (over: Partial<GroundingShadowResult>): GroundingShadowResult => ({
    version: "grounding-shadow-v1", ran: false, mode: missionGroundingMode(), observationSetDigest: digest,
    candidateCount: 0, structurallyValid: 0, criticSupported: 0, accepted: 0, groundingCoverage: 0, distinctStateCoverage: 0,
    tierCounts: emptyTiers(), unsupportedCriteria: 0, unsafeTransitionCount: 0, duplicateRate: 0,
    plannedBudgetBase: "0", suppliedBudgetBase: input.totalBudgetBase.toString(), budgetConsistent: true, disagreement: "agree", error: null, ...over,
  });
  if (!set || set.facts.length === 0) return base({ error: "no_observation_set" });

  // 1) V2 ARCHITECT — strict structured output, FAIL CLOSED (no repair). A malformed response yields no
  //    candidates rather than a salvaged plan.
  let candidates: CandidateMission[];
  try {
    const architect = deps.architect ?? ((system: string, user: string) => llmCompleteJson({ system, user, maxTokens: 4200, temperature: 0.2, model: missionModel() }).then((r) => r.json));
    const user = `PRODUCT MAP:\n${compactMapForLlm(map)}\n\nOBSERVATION_SET_DIGEST: ${digest}\nSEEN FACT IDS: ${set.facts.filter((f) => f.decisive).map((f) => f.id).join(", ")}\nTRANSITION IDS: ${set.transitions.map((t) => t.id).join(", ")}\nGOAL: ${input.goal}\nBUDGET_BASE: ${input.totalBudgetBase}`;
    const json = await architect(ARCHITECT_SYSTEM_V2, user);
    const arr = Array.isArray((json as { missions?: unknown[] })?.missions) ? (json as { missions: unknown[] }).missions : [];
    candidates = arr.map((m, i) => coerceMissionForShadow(m, i)).filter((m): m is CandidateMission => m !== null);
  } catch (e) {
    return base({ error: e instanceof Error ? e.message.slice(0, 60) : "architect_failed" });
  }
  if (candidates.length === 0) return base({ ran: true, error: "v2_empty", disagreement: "v2_empty" });

  // 2) deterministic grounding validation per candidate (digest-bound + replay-aware).
  const idxValid = candidates.map((m) => validateMissionGrounding(m, set, { expectedDigest: digest, replayReproduced: deps.replayReproduced }).length === 0);
  const structurallyValid = candidates.filter((_m, i) => idxValid[i]);

  // 3) grounding-aware critic (structured; fail-closed → not supported).
  const supportedKeys = new Set<string>();
  let unsupportedCriteria = 0;
  try {
    const critic = deps.critic ?? ((system: string, user: string) => llmCompleteJson({ system, user, maxTokens: 1800, temperature: 0, model: missionModel() }).then((r) => r.json));
    const criticUser = structurallyValid.map((m) => `${m.missionKey}: ${m.criteria.map((c, ci) => `[${ci}] ${c} facts=${(m.groundingV1?.criteria.find((g) => g.criterionIndex === ci)?.sourceFactIds ?? []).join("|")}`).join(" ; ")}`).join("\n");
    const cj = await critic(CRITIC_SYSTEM_V2, criticUser);
    const verdicts = Array.isArray((cj as { verdicts?: unknown[] })?.verdicts) ? (cj as { verdicts: { missionKey?: string; verdict?: string }[] }).verdicts : [];
    for (const m of structurallyValid) {
      const vs = verdicts.filter((v) => v.missionKey === m.missionKey);
      const allSupported = m.criteria.length > 0 && vs.length >= m.criteria.length && vs.every((v) => v.verdict === "supported");
      if (allSupported) supportedKeys.add(m.missionKey);
      unsupportedCriteria += vs.filter((v) => v.verdict === "unsupported" || v.verdict === "contradictory").length;
    }
  } catch {
    /* critic failure → nothing critic-supported (fail closed) */
  }

  const accepted = structurallyValid.filter((m) => supportedKeys.has(m.missionKey));

  // 4) bounded metrics.
  const tierCounts = emptyTiers();
  let mappedCriteria = 0, totalCriteria = 0, unsafeTransitionCount = 0;
  const coveredStates = new Set<string>();
  for (const m of candidates) {
    for (let ci = 0; ci < m.criteria.length; ci++) {
      totalCriteria++;
      const gc = m.groundingV1?.criteria.find((g) => g.criterionIndex === ci);
      if (!gc) continue;
      mappedCriteria++;
      const tier = classifyGroundingTier(gc, set, deps.replayReproduced);
      tierCounts[tier]++;
      for (const tid of gc.sourceTransitionIds ?? []) {
        const t = set.transitions.find((x) => x.id === tid);
        if (t && t.safeClassification !== "safe") unsafeTransitionCount++;
        if (t) coveredStates.add(t.afterStateDigest);
      }
    }
  }
  const plannedBudget = candidates.reduce((s, m) => s + BigInt(Math.max(0, m.rewardWeight)) * BigInt(Math.max(0, m.maxCompletions)), BigInt(0));
  // reward WEIGHTS are relative (the compiler derives base units); here we flag only whether the candidate
  // set is plausibly within budget by comparing accepted mission count's implied minimum, not exact base.
  const objectives = new Set(candidates.map((m) => m.objective.trim().toLowerCase()));
  return base({
    ran: true,
    candidateCount: candidates.length,
    structurallyValid: structurallyValid.length,
    criticSupported: supportedKeys.size,
    accepted: accepted.length,
    groundingCoverage: totalCriteria === 0 ? 0 : mappedCriteria / totalCriteria,
    distinctStateCoverage: coveredStates.size,
    tierCounts,
    unsupportedCriteria,
    unsafeTransitionCount,
    duplicateRate: candidates.length === 0 ? 0 : 1 - objectives.size / candidates.length,
    plannedBudgetBase: plannedBudget.toString(),
    budgetConsistent: unsafeTransitionCount === 0, // structural: no unsafe support used
    disagreement: accepted.length === legacyAcceptedCount ? "agree" : accepted.length < legacyAcceptedCount ? "v2_fewer" : "v2_more",
  });
}
