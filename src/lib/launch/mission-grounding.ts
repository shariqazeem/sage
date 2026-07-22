import type { CandidateMission, MissionValidationIssue } from "./schemas";
import type { ObservationSetV1 } from "./observed-facts";
import { factIndex } from "./observed-facts";

/**
 * Mission Brain V2 — the deterministic GROUNDING gate. A mission may carry a design-time grounding map
 * (`groundingV1`) tying each criterion to the observed facts that support it, the evidence requirement
 * that proves it, and how Sage can verify it. This gate — pure, no model — rejects a mission whose map
 * doesn't hold up against the inspection's observation set:
 *
 *   · a cited fact/transition id that does not exist            → ungrounded_fact_ref
 *   · a criterion whose only sources are inferred (vision)      → inferred_decisive_source
 *   · a criterion with no grounding entry / bad evidence index  → criterion_evidence_unmapped
 *   · a verification mode that cannot prove the criterion       → evidence_mode_incapable
 *
 * Backward-compatible: a mission WITHOUT `groundingV1`, or an inspection WITHOUT an observation set, is a
 * no-op here — the existing anchor gate still applies. `groundingV1` is display-only and is stripped at
 * canonical compilation, so it never touches a spec digest or budget arithmetic.
 */
export function validateMissionGrounding(mission: CandidateMission, set: ObservationSetV1 | null | undefined): MissionValidationIssue[] {
  const g = mission.groundingV1;
  if (!g || !set) return [];
  const issues: MissionValidationIssue[] = [];
  const idx = factIndex(set);
  const byCriterion = new Map(g.criteria.map((c) => [c.criterionIndex, c]));

  for (let i = 0; i < mission.criteria.length; i++) {
    const gc = byCriterion.get(i);
    if (!gc) {
      issues.push({ code: "criterion_evidence_unmapped", field: `criteria[${i}]`, detail: "criterion has no grounding entry" });
      continue;
    }
    if (gc.evidenceIndex < 0 || gc.evidenceIndex >= mission.evidenceRequirements.length) {
      issues.push({ code: "criterion_evidence_unmapped", field: `criteria[${i}]`, detail: `evidenceIndex ${gc.evidenceIndex} out of range` });
    }
    // every cited id must exist in the observation set.
    for (const fid of gc.sourceFactIds) {
      if (!idx.facts.has(fid)) issues.push({ code: "ungrounded_fact_ref", field: `criteria[${i}]`, detail: `fact ${fid} not in the observation set` });
    }
    for (const tid of gc.sourceTransitionIds ?? []) {
      if (!idx.transitions.has(tid)) issues.push({ code: "ungrounded_fact_ref", field: `criteria[${i}]`, detail: `transition ${tid} not in the observation set` });
    }
    // at least one DECISIVE (seen) source — an inferred-only criterion cannot anchor.
    const existing = gc.sourceFactIds.map((id) => idx.facts.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof idx.facts.get>>[];
    const hasSeen = existing.some((f) => f.grounding === "seen" && f.decisive);
    if (existing.length > 0 && !hasSeen) {
      issues.push({ code: "inferred_decisive_source", field: `criteria[${i}]`, detail: "all cited sources are inferred (vision); a decisive source must be seen" });
    }
    // verification-mode capability: a URL mode needs a stable public-page (dom) source; observation mode
    // needs a real state/transition source.
    if (gc.verificationMode === "deterministic_url" || gc.verificationMode === "semantic_url") {
      if (!existing.some((f) => f.source === "dom")) {
        issues.push({ code: "evidence_mode_incapable", field: `criteria[${i}]`, detail: `${gc.verificationMode} needs a page (dom) source, none cited` });
      }
    } else if (gc.verificationMode === "observation") {
      const hasState = existing.some((f) => f.stateId != null) || (gc.sourceTransitionIds?.length ?? 0) > 0;
      if (!hasState) {
        issues.push({ code: "evidence_mode_incapable", field: `criteria[${i}]`, detail: "observation mode needs a state/transition source, none cited" });
      }
    }
  }
  return issues;
}

/* ─────────────────────────────────────────── coverage report ────────────── */

export interface CoverageReport {
  /** distinct field-test states Sage inspected. */
  inspectedStates: number;
  /** distinct states an accepted mission is grounded in. */
  coveredStates: number;
  /** inspected state ids that no accepted mission covers (high-value gaps to consider). */
  uncoveredStateIds: string[];
  /** accepted missions grounded in the SAME state + objective (duplicate coverage). */
  duplicateCoverage: number;
  /** mission count by risk category. */
  diversityByRisk: Record<string, number>;
  /** grounding-entry count by verification mode. */
  evidenceModeDistribution: Record<string, number>;
  acceptedMissions: number;
}

/** A deterministic coverage report over the observation set + the accepted missions. Pure. */
export function coverageReport(set: ObservationSetV1 | null | undefined, missions: CandidateMission[]): CoverageReport {
  const inspected = new Set<string>();
  for (const f of set?.facts ?? []) if (f.stateId) inspected.add(f.stateId);

  const covered = new Set<string>();
  const diversityByRisk: Record<string, number> = {};
  const evidenceModeDistribution: Record<string, number> = {};
  const idx = set ? factIndex(set) : null;
  const missionStateKey = new Map<string, string[]>(); // missionKey → sorted covered state ids

  for (const m of missions) {
    diversityByRisk[m.riskCategory] = (diversityByRisk[m.riskCategory] ?? 0) + 1;
    const states = new Set<string>();
    for (const gc of m.groundingV1?.criteria ?? []) {
      evidenceModeDistribution[gc.verificationMode] = (evidenceModeDistribution[gc.verificationMode] ?? 0) + 1;
      for (const fid of gc.sourceFactIds) {
        const f = idx?.facts.get(fid);
        if (f?.stateId) { covered.add(f.stateId); states.add(f.stateId); }
      }
    }
    missionStateKey.set(m.missionKey, [...states].sort());
  }

  // duplicate coverage: two missions with the SAME objective AND the same covered-state set.
  let duplicateCoverage = 0;
  const seen = new Set<string>();
  for (const m of missions) {
    const key = `${m.objective.trim().toLowerCase()}::${(missionStateKey.get(m.missionKey) ?? []).join(",")}`;
    if (seen.has(key)) duplicateCoverage++;
    else seen.add(key);
  }

  return {
    inspectedStates: inspected.size,
    coveredStates: covered.size,
    uncoveredStateIds: [...inspected].filter((s) => !covered.has(s)).sort(),
    duplicateCoverage,
    diversityByRisk,
    evidenceModeDistribution,
    acceptedMissions: missions.length,
  };
}

/* ───────────────────────────────────── canonical compilation strip ──────── */

/** Strip design-time-only grounding metadata for canonical compilation (never claims it survives to
 *  payout). Returns a shallow copy without `groundingV1`. */
export function stripGrounding<T extends { groundingV1?: unknown }>(mission: T): Omit<T, "groundingV1"> {
  const { groundingV1: _drop, ...rest } = mission;
  void _drop;
  return rest;
}
