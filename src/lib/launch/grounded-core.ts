import { createHash } from "node:crypto";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import { addCoreMission, type CoreDecision, type CoreHint } from "./core-mission";
import { canaryPlanCommitment, deterministicGroundedPlanDigest } from "./mission-canary";
import type { GroundedCandidatePlan } from "./mission-grounding-shadow";
import { verificationPolicyV2Digest, validateVerificationPolicyV2Complete, type VerificationPolicyV2 } from "./mission-probe-v2";
import type { MissionPlanV1, ProductMapV1 } from "./schemas";
import type { ValidationScope } from "./validate-mission";

/**
 * THE CORE MISSION ON A GROUNDED PLAN (21 Nov 2026).
 *
 * The core mission (`core-mission.ts`) joined only the legacy plan, inside the mission brain. When the
 * canary selected the grounded V2 plan instead, that plan came straight from the grounded compiler and
 * never met it. Measured on staging: plausible.io, play2048, yara.garden, GitLab and Uniswap, the
 * interactive products where "how far did you get" matters most, all shipped without it.
 *
 * This module is the ONE place the core joins a grounded plan, and it is called at ONE moment: after
 * the canary has selected the plan, before its digest and commitment are taken and before the budget is
 * compiled. So every number and hash downstream describes the plan with its core in it:
 *   - the grounded digest is recomputed over the missions as they now are;
 *   - the budget compiler allocates across all of them, exactly, as it does for any plan;
 *   - the on-chain mission-plan digest (the compiled plan's) therefore includes the core;
 *   - the verification policy is compiled from the same missions and binds that digest;
 *   - the commitment binds that digest, the budget, the revision and the coverage statement below.
 *
 * WHAT THE STRICT SIGNALS STILL MEAN. A grounded plan's signals ("every criterion critic-supported",
 * "all decisive grounded") describe the missions the grounded chain wrote. The core is not one of
 * them and does not pretend to be: its words are fixed in code, it passes the same deterministic gate
 * beside the grounded missions (`addCoreMission` runs `validatePlanMissions` over the whole set), and
 * it is judged as observation-based work against Sage's own private record. The coverage statement
 * says so in a form a reader can check, rather than leaving it to be inferred from an absence.
 *
 * THE CORE AND THE REPLAY COVENANT. A replay covenant covers `action_outcome` criteria: Sage re-performs
 * a safe observed transition before paying. The core asks a person where they STOPPED; there is no
 * transition whose reproduction would prove that, so the core is outside the covenant by construction
 * and is paid on the observation judge alone. `verifyReplayPermit` already treats a mission the policy
 * does not mark as an action mission that way; `verifyGroundedSelection` refuses a selection whose
 * policy names the core, so the two can never disagree.
 */

export const GROUNDED_COVERAGE_VERSION = "grounded-coverage-v1" as const;

export type CoreAbsentReason =
  /** the plan already had a mission under the core's key, or no version of the core passed the gate */
  | "gate_refused"
  /** the core would not be judged as observation-based work, so it was not added */
  | "not_observation_based"
  /** the founder's budget cannot fund the plan with one more mission in it, exactly */
  | "budget_cannot_fund"
  /** the budget funded the builder's higher-priority flows first: the core was ranked below them for what this
   *  builder came for, and the allocator funds by priority (`CoreDecision`) */
  | "yielded";

export interface MissionCoverage {
  missionKey: string;
  core: boolean;
  /** how the compiled plan says this mission is judged */
  verifiabilityClass: "url-verifiable" | "observation-based";
  /** "inside" only when the attached, required policy carries an action criterion for this mission */
  replayCovenant: "inside" | "outside";
}

/** What the selected plan's verification covers, mission by mission, with the core named. */
export interface GroundedCoverageV1 {
  version: typeof GROUNDED_COVERAGE_VERSION;
  /** the compiled plan this statement describes */
  missionPlanDigest: string;
  policyRequired: boolean;
  policyDigest: string | null;
  /** the core mission's standing, or null when the plan carries none (`coreAbsentReason` says why) */
  core: { missionKey: typeof CORE_MISSION_KEY; verifiabilityClass: "observation-based"; replayCovenant: "outside"; hintFrom: CoreHint["from"] } | null;
  coreAbsentReason: CoreAbsentReason | null;
  /** every mission in the compiled plan, sorted by key */
  missions: MissionCoverage[];
  coverageDigest: string;
}

export interface CoreAttachment {
  /** the plan to select: with the core first when it was added, otherwise the plan as it came */
  plan: GroundedCandidatePlan;
  hint: CoreHint | null;
  absentReason: CoreAbsentReason | null;
}

/**
 * Add the core mission to a selected grounded plan. Pure: the plan handed in is never changed. When no
 * version of the core passes the gate beside the plan's own missions, the plan comes back as it was,
 * with the reason; a plan without its core is better than one carrying a mission Sage cannot stand behind.
 */
export function attachCoreToGroundedPlan(
  plan: GroundedCandidatePlan,
  ctx: {
    map: Pick<ProductMapV1, "productName" | "fieldTest" | "observations" | "productKind">;
    productUrl: string;
    scope: ValidationScope;
    corpus: string;
    modelHint: CoreHint | null;
    /** where the core stands for this builder (its priority); absent, the old rule: it leads */
    decision?: CoreDecision;
  },
): CoreAttachment {
  const added = addCoreMission({ map: ctx.map, productUrl: ctx.productUrl, scope: ctx.scope, corpus: ctx.corpus, accepted: plan.missions, modelHint: ctx.modelHint, decision: ctx.decision });
  if (!added) return { plan, hint: null, absentReason: "gate_refused" };
  if (added.mission.verifiabilityClass !== "observation-based" || added.mission.groundingV1) return { plan, hint: null, absentReason: "not_observation_based" };
  // first, so it is the mission a builder and a tester meet first (the same place it takes on a legacy plan)
  return { plan: { ...plan, missions: [added.mission, ...plan.missions] }, hint: added.hint, absentReason: null };
}

const sha = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex");

function coverageDigest(c: Omit<GroundedCoverageV1, "coverageDigest">): string {
  return sha({ version: c.version, missionPlanDigest: c.missionPlanDigest, policyRequired: c.policyRequired, policyDigest: c.policyDigest, core: c.core, coreAbsentReason: c.coreAbsentReason, missions: c.missions });
}

/**
 * The coverage statement for a compiled, selected plan. Derived from exactly what settlement will read:
 * the compiled plan's own mission list and the policy that will be attached (null when not required).
 */
export function buildGroundedCoverage(input: {
  plan: Pick<MissionPlanV1, "missionPlanDigest" | "missions">;
  /** the policy that will be ATTACHED: null unless it is required */
  policy: Pick<VerificationPolicyV2, "policyDigest" | "actionCriteria"> | null;
  coreHintFrom: CoreHint["from"] | null;
  coreAbsentReason: CoreAbsentReason | null;
}): GroundedCoverageV1 {
  const { plan, policy } = input;
  const inside = new Set((policy?.actionCriteria ?? []).map((a) => a.missionKey));
  const missions: MissionCoverage[] = [...plan.missions]
    .sort((a, b) => a.missionKey.localeCompare(b.missionKey))
    .map((m) => ({
      missionKey: m.missionKey,
      core: m.missionKey === CORE_MISSION_KEY,
      verifiabilityClass: m.verifiabilityClass ?? "observation-based",
      replayCovenant: inside.has(m.missionKey) ? "inside" : "outside",
    }));
  const hasCore = missions.some((m) => m.core);
  const body: Omit<GroundedCoverageV1, "coverageDigest"> = {
    version: GROUNDED_COVERAGE_VERSION,
    missionPlanDigest: plan.missionPlanDigest,
    policyRequired: policy !== null,
    policyDigest: policy?.policyDigest ?? null,
    core: hasCore ? { missionKey: CORE_MISSION_KEY, verifiabilityClass: "observation-based", replayCovenant: "outside", hintFrom: input.coreHintFrom ?? "generic" } : null,
    coreAbsentReason: hasCore ? null : (input.coreAbsentReason ?? "gate_refused"),
    missions,
  };
  return { ...body, coverageDigest: coverageDigest(body) };
}

/** The founder's budget, written the one way the commitment has always written it. */
export const commitmentBudgetText = (totalBudgetBase: bigint, tokenDecimals: number): string => `${totalBudgetBase} base units @ ${tokenDecimals}dp`;

/** The commitment for a selected grounded plan: the compiled plan's digest, the budget, the revision and the coverage. */
export function groundedSelectionCommitment(input: { plan: Pick<MissionPlanV1, "missionPlanDigest" | "totalBudgetBase" | "revision">; founderBudgetBase: bigint; tokenDecimals: number; coverageDigest: string }): string {
  return canaryPlanCommitment({
    planDigest: input.plan.missionPlanDigest,
    budgetText: commitmentBudgetText(input.founderBudgetBase, input.tokenDecimals),
    budgetBase: input.plan.totalBudgetBase.toString(),
    revision: input.plan.revision,
    coverageDigest: input.coverageDigest,
  }).commitment;
}

export interface GroundedSelectionRecord {
  groundedDigest: string;
  planDigest: string;
  planCommitment: string;
  coverage: GroundedCoverageV1;
  verificationPolicy: VerificationPolicyV2 | null;
  verificationPolicyDigest: string | null;
  verificationPolicyRequired: boolean;
}

export type GroundedSelectionCheck = { ok: true } | { ok: false; reason: string };

const sameKeys = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/**
 * Does a selection's record still describe the plan it was taken over? Everything is RECOMPUTED from the
 * grounded missions and the compiled plan; nothing stored is trusted. The pipeline runs this on its own
 * output before it calls a grounded plan ready, so a record that has drifted from its plan (a mission
 * added after the digest, a policy bound to an earlier compile, a commitment over other numbers) is
 * refused there, not found later by a founder. A reader holding the plan can run the same check.
 */
export function verifyGroundedSelection(input: {
  /** the grounded plan that was selected, with its core */
  groundedPlan: GroundedCandidatePlan;
  /** the plan compiled from it */
  plan: Pick<MissionPlanV1, "missionPlanDigest" | "missions" | "totalBudgetBase" | "allocatedBase" | "revision">;
  founderBudgetBase: bigint;
  tokenDecimals: number;
  record: GroundedSelectionRecord;
}): GroundedSelectionCheck {
  const { groundedPlan, plan, record } = input;
  const no = (reason: string): GroundedSelectionCheck => ({ ok: false, reason });

  // the plan: the same missions on both sides, at most one core, money exact
  const groundedKeys = groundedPlan.missions.map((m) => m.missionKey);
  const planKeys = plan.missions.map((m) => m.missionKey);
  if (new Set(planKeys).size !== planKeys.length) return no("duplicate_mission_key");
  if (!sameKeys(groundedKeys, planKeys)) return no("plan_missions_differ_from_grounded");
  let allocated = BigInt(0);
  for (const m of plan.missions) allocated += m.rewardBase * m.maxCompletions;
  if (allocated !== plan.allocatedBase || plan.allocatedBase !== plan.totalBudgetBase || plan.totalBudgetBase !== input.founderBudgetBase) return no("budget_not_exact");

  // the digests
  if (deterministicGroundedPlanDigest(groundedPlan) !== record.groundedDigest) return no("grounded_digest_mismatch");
  if (record.planDigest !== plan.missionPlanDigest) return no("plan_digest_mismatch");

  // the policy: attached if and only if required, bound to THIS plan, complete, self-consistent
  const policy = record.verificationPolicy;
  if (record.verificationPolicyRequired !== (policy !== null)) return no("policy_required_disagrees");
  if (policy) {
    if (verificationPolicyV2Digest(policy) !== policy.policyDigest || policy.policyDigest !== record.verificationPolicyDigest) return no("policy_digest_mismatch");
    if (policy.missionPlanDigest !== plan.missionPlanDigest) return no("policy_plan_mismatch");
    if (!validateVerificationPolicyV2Complete(policy).complete) return no("policy_incomplete");
    if (policy.observationSetDigest !== groundedPlan.observationSetDigest) return no("policy_observation_set_mismatch");
    const known = new Set(planKeys);
    if ([...policy.actionCriteria, ...policy.probes].some((x) => !known.has(x.missionKey))) return no("policy_names_unknown_mission");
    if ([...policy.actionCriteria, ...policy.probes].some((x) => x.missionKey === CORE_MISSION_KEY)) return no("core_inside_replay_covenant");
  } else if (record.verificationPolicyDigest !== null) return no("policy_digest_without_policy");

  // the coverage: recomputed from the plan and the policy, it must be what was recorded
  const stated = record.coverage;
  const coreMission = plan.missions.find((m) => m.missionKey === CORE_MISSION_KEY);
  if (coreMission && (coreMission.verifiabilityClass ?? "observation-based") !== "observation-based") return no("core_not_observation_based");
  if (groundedPlan.missions.find((m) => m.missionKey === CORE_MISSION_KEY)?.groundingV1) return no("core_carries_grounding");
  const expected = buildGroundedCoverage({ plan, policy, coreHintFrom: stated.core?.hintFrom ?? null, coreAbsentReason: stated.coreAbsentReason });
  if (!!stated.core !== !!coreMission) return no("coverage_core_disagrees");
  if (expected.coverageDigest !== stated.coverageDigest || coverageDigest(stated) !== stated.coverageDigest) return no("coverage_mismatch");

  // the commitment: over this plan, this budget, this revision, this coverage
  const commitment = groundedSelectionCommitment({ plan, founderBudgetBase: input.founderBudgetBase, tokenDecimals: input.tokenDecimals, coverageDigest: stated.coverageDigest });
  if (commitment !== record.planCommitment) return no("commitment_mismatch");
  return { ok: true };
}
