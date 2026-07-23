import type { CandidateMission, MissionValidationReport, MissionValidationCode } from "./schemas";
import type { ObservationSetV1 } from "./observed-facts";
import { coverageReport, type CoverageReport } from "./mission-grounding";

/**
 * P-GEN metrics (Mission Brain V2) — deterministic quality measures over a round of candidate missions and
 * their validation reports. Computed purely from what the gate already found + the observation set, so the
 * same inputs always yield the same numbers. A promotion-quality round wants: anchor integrity 100%,
 * fact-reference integrity 100%, criterion↔evidence mapping 100%, target-scope validity 100%, zero
 * unsafe/auth-required missions, and zero budget drift. This module MEASURES; it never changes the gate,
 * the architect, or budget arithmetic.
 */

export interface GroundingMetrics {
  candidates: number;
  accepted: number;
  /** fraction of candidates with NO unanchored-claim finding (1 = perfect anchor integrity). */
  anchorIntegrity: number;
  /** among candidates carrying a grounding map: fraction with NO ungrounded/inferred-decisive fact ref. */
  factReferenceIntegrity: number;
  /** among candidates carrying a grounding map: fraction with all criteria mapped to capable evidence. */
  criterionEvidenceMapping: number;
  /** fraction of candidates whose target is in the inspected scope. */
  targetScopeValidity: number;
  /** count of candidates with any unsafe / secret / wallet-signing / fund-transfer / security finding. */
  unsafeOrAuthMissions: number;
  /** budget drift: |Σ(rewardWeight×maxCompletions over ACCEPTED) − stated| is not computed here (weights,
   *  not base units); this reports whether any accepted mission has an invalid reward/cap (a compile-time
   *  budget guard) — should be 0. Real base-unit balance is enforced by allocateBudget, untouched. */
  invalidRewardOrCap: number;
  /** fraction of candidates flagged duplicate (key or objective or coverage). */
  duplicateRate: number;
  coverage: CoverageReport;
  /** candidates whose critique failed to parse (fed in by the caller; 0 offline). */
  criticParseFailures: number;
  /** true when every promotion hard-metric is perfect. */
  promotionClean: boolean;
}

const has = (r: MissionValidationReport, ...codes: MissionValidationCode[]) => r.issues.some((i) => codes.includes(i.code));
const frac = (n: number, d: number) => (d === 0 ? 1 : n / d);

export function computeGroundingMetrics(
  candidates: CandidateMission[],
  reports: MissionValidationReport[],
  set: ObservationSetV1 | null | undefined,
  opts: { criticParseFailures?: number } = {},
): GroundingMetrics {
  const n = candidates.length;
  const withGrounding = candidates.filter((c) => c.groundingV1);
  const groundingReports = reports.filter((_r, i) => candidates[i].groundingV1);

  const anchorClean = reports.filter((r) => !has(r, "unanchored_claim")).length;
  const factRefClean = groundingReports.filter((r) => !has(r, "ungrounded_fact_ref", "inferred_decisive_source")).length;
  const mappingClean = groundingReports.filter((r) => !has(r, "criterion_evidence_unmapped", "evidence_mode_incapable", "instructions_criteria_inconsistent", "evidence_cannot_prove_criteria")).length;
  const scopeClean = reports.filter((r) => !has(r, "target_out_of_scope", "hallucinated_route")).length;
  const unsafe = reports.filter((r) => has(r, "destructive_instruction", "secret_request", "wallet_signing_request", "fund_transfer_request", "security_exploitation", "unsupported_evidence_type")).length;
  const invalidRewardOrCap = reports.filter((r) => has(r, "invalid_reward_or_cap")).length;
  const duplicate = reports.filter((r) => has(r, "duplicate_mission_key", "duplicate_objective")).length;

  const accepted = candidates.filter((_c, i) => reports[i].ok);
  const coverage = coverageReport(set, accepted);
  // coverage duplicates also count toward the duplicate rate.
  const duplicateRate = frac(duplicate + coverage.duplicateCoverage, n);

  const metrics: GroundingMetrics = {
    candidates: n,
    accepted: accepted.length,
    anchorIntegrity: frac(anchorClean, n),
    factReferenceIntegrity: frac(factRefClean, withGrounding.length),
    criterionEvidenceMapping: frac(mappingClean, withGrounding.length),
    targetScopeValidity: frac(scopeClean, n),
    unsafeOrAuthMissions: unsafe,
    invalidRewardOrCap,
    duplicateRate,
    coverage,
    criticParseFailures: opts.criticParseFailures ?? 0,
    promotionClean: false,
  };
  metrics.promotionClean =
    accepted.length > 0 && // never promotion-clean with zero accepted candidates...
    withGrounding.length > 0 && // ...or when NO candidate carried a grounding map (nothing was proven)
    accepted.every((m) => m.groundingV1 && m.groundingV1.criteria.length >= m.criteria.length) && // every accepted criterion mapped
    metrics.anchorIntegrity === 1 &&
    metrics.factReferenceIntegrity === 1 &&
    metrics.criterionEvidenceMapping === 1 &&
    metrics.targetScopeValidity === 1 &&
    metrics.unsafeOrAuthMissions === 0 &&
    metrics.invalidRewardOrCap === 0 &&
    metrics.criticParseFailures === 0;
  return metrics;
}
