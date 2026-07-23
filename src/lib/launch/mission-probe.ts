import { createHash } from "node:crypto";
import { allowedKey } from "./inspection-replay";
import type { ObservationSetV1, ActionTransitionV1 } from "./observed-facts";
import type { CandidateMission, CriterionGroundingV1 } from "./schemas";
import type { ValidationScope } from "./validate-mission";

/**
 * Phase 2 — MissionProbeV1 + VerificationPolicyV1 DETERMINISTIC COMPILER.
 *
 * A MissionProbeV1 is the exact, replayable action Sage will re-perform in a guarded browser before a payout on
 * an action mission. It is derived ENTIRELY from the selected grounded mission + its CriterionGroundingV1 + the
 * canonical observation set + the positively-safe ActionTransitionV1 + the actual replay result. NO model emits
 * or edits a probe; a model-authored index, locator, URL, or outcome is impossible here. When the observation
 * record disagrees with model prose, the record wins (we never read prose in this module).
 *
 * A probe is compilable ONLY when every safety + grounding condition holds; otherwise a bounded rejection code
 * is returned and no probe. An action mission with no valid probe is NOT autonomous-payout eligible (Phase 4).
 */

export const MISSION_PROBE_VERSION = "mission-probe-v1" as const;
export const VERIFICATION_POLICY_VERSION = "verification-policy-v1" as const;

export interface MissionProbeV1 {
  version: typeof MISSION_PROBE_VERSION;
  probeId: string;
  missionKey: string;
  criterionIndex: number;
  kind: "action_replay";
  observationSetDigest: string;
  sourceFactIds: string[];
  sourceTransitionId: string;
  startUrl: string;
  action: { verb: "click" | "press"; role: string; name: string; key?: string };
  expected: { afterUrl: string; afterStateDigest: string; addedTexts: string[]; removedTexts: string[] };
  safety: { classification: "safe"; networkMethods: ("GET" | "HEAD")[]; inspectionReplayReproduced: true };
  probeDigest: string;
}

export interface VerificationPolicyV1 {
  version: typeof VERIFICATION_POLICY_VERSION;
  missionPlanDigest: string;
  productMapDigest: string;
  observationSetDigest: string;
  /** missionKeys that HAVE ≥1 action_outcome criterion — an action mission. If such a key is absent from
   *  `probes`, its probe could not compile, so the mission is NOT autonomous-payout eligible (HOLD in canary). */
  actionMissions: string[];
  probes: MissionProbeV1[];
  policyDigest: string;
}

/** Bounded rejection codes — the ONLY reasons a probe is not compilable (never raw text). */
export type ProbeRejectionCode =
  | "not_action_outcome"
  | "no_transition_cited"
  | "transition_not_in_set"
  | "unsafe_transition"
  | "methods_not_get_head"
  | "not_replay_reproduced"
  | "verb_not_replayable"
  | "no_locator_from_before_state"
  | "key_not_allowlisted"
  | "no_seen_after_state_fact"
  | "outcome_fact_not_in_after_state"
  | "inferred_after_state_only"
  | "no_outcome_signal"
  | "start_url_out_of_scope"
  | "after_url_out_of_scope";

const canon = (v: unknown): string => JSON.stringify(v);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const hostOf = (u: string): string | null => { try { return new URL(u).host.toLowerCase(); } catch { return null; } };
const inScope = (u: string, scope: ValidationScope): boolean => { const h = hostOf(u); return !!h && scope.hosts.has(h); };

export interface CompileProbeInput {
  mission: CandidateMission;
  criterionIndex: number;
  grounding: CriterionGroundingV1;
  set: ObservationSetV1;
  replayReproduced: ReadonlySet<string>;
  scope: ValidationScope;
}

/**
 * Compile ONE criterion into a MissionProbeV1, or return a bounded rejection code. Pure + deterministic; no
 * browser, no model, no prose. Every field is derived from the observation record; a disagreeing model prose
 * value can never override it (this module never reads prose).
 */
export function compileMissionProbe(input: CompileProbeInput): { probe: MissionProbeV1 } | { rejected: ProbeRejectionCode } {
  const { mission, criterionIndex, grounding, set, replayReproduced, scope } = input;

  if (grounding.criterionKind !== "action_outcome") return { rejected: "not_action_outcome" };

  const transitionId = grounding.sourceTransitionIds?.[0];
  if (!transitionId) return { rejected: "no_transition_cited" };
  const transition: ActionTransitionV1 | undefined = set.transitions.find((t) => t.id === transitionId);
  if (!transition) return { rejected: "transition_not_in_set" };

  // safety — positively established (never assumed): safe classification + GET/HEAD-only observed.
  if (transition.safeClassification !== "safe") return { rejected: "unsafe_transition" };
  if (transition.networkMethodSummary !== "get_observed") return { rejected: "methods_not_get_head" };
  // the replay must have ACTUALLY reproduced this transition (subtractive: no replay ⇒ no probe).
  if (!replayReproduced.has(transitionId)) return { rejected: "not_replay_reproduced" };

  // the control that was acted on — the locator is built from the BEFORE state (the result state's elements
  // are the OUTCOME, not the control). click/press only.
  if (transition.verb !== "click" && transition.verb !== "press") return { rejected: "verb_not_replayable" };
  const loc = transition.locator;
  const role = loc.role ?? "";
  const name = loc.accessibleName ?? loc.raw ?? "";
  if (!name) return { rejected: "no_locator_from_before_state" };
  let key: string | undefined;
  if (transition.verb === "press") {
    const k = allowedKey(name) ?? undefined;
    if (!k) return { rejected: "key_not_allowlisted" };
    key = k;
  }

  // the cited outcome facts MUST be SEEN facts of the transition's AFTER state — never inferred, never another
  // state. `grounding.sourceFactIds` are the criterion's citations; keep only the ones that positively belong
  // to the after-state and are `seen`.
  const cited = new Set(grounding.sourceFactIds ?? []);
  const afterFacts = set.facts.filter((f) => cited.has(f.id) && f.stateId === transition.afterStateDigest);
  if (afterFacts.length === 0) {
    // any cited fact that exists but is NOT in the after-state is a mis-grounding; distinguish inferred-only.
    const anyCitedExists = set.facts.some((f) => cited.has(f.id));
    if (anyCitedExists) {
      const citedInferred = set.facts.filter((f) => cited.has(f.id)).every((f) => f.grounding !== "seen");
      return { rejected: citedInferred ? "inferred_after_state_only" : "outcome_fact_not_in_after_state" };
    }
    return { rejected: "no_seen_after_state_fact" };
  }
  const seenAfter = afterFacts.filter((f) => f.grounding === "seen");
  if (seenAfter.length === 0) return { rejected: "inferred_after_state_only" };

  // at least one bounded, SPECIFIC outcome signal — an after-state added text that is grounded in a seen
  // after-fact's visible texts (never an invented string).
  const expectedAddedTexts = [...new Set(transition.addedTexts)]
    .filter((t) => seenAfter.some((f) => f.visibleTexts.some((x) => x.includes(t) || t.includes(x))))
    .sort();
  if (expectedAddedTexts.length === 0) return { rejected: "no_outcome_signal" };

  // start + after URLs must be within canonical scope.
  if (!inScope(transition.startUrl, scope)) return { rejected: "start_url_out_of_scope" };
  if (!inScope(transition.afterUrl, scope)) return { rejected: "after_url_out_of_scope" };

  const sourceFactIds = seenAfter.map((f) => f.id).sort();
  const removedTexts = [...new Set(transition.removedTexts)].sort();
  const body = {
    version: MISSION_PROBE_VERSION,
    missionKey: mission.missionKey,
    criterionIndex,
    kind: "action_replay" as const,
    observationSetDigest: set.digest,
    sourceFactIds,
    sourceTransitionId: transition.id,
    startUrl: transition.startUrl,
    action: { verb: transition.verb, role, name, ...(key ? { key } : {}) },
    expected: { afterUrl: transition.afterUrl, afterStateDigest: transition.afterStateDigest, addedTexts: expectedAddedTexts, removedTexts },
    // get_observed guarantees GET/HEAD-only; canonicalize to ["GET"] as the safe-methods marker.
    safety: { classification: "safe" as const, networkMethods: ["GET"] as ("GET" | "HEAD")[], inspectionReplayReproduced: true as const },
  };
  const probeDigest = sha(canon(body));
  const probe: MissionProbeV1 = { ...body, probeId: probeDigest.slice(0, 24), probeDigest };
  return { probe };
}

export interface CompilePolicyInput {
  missionPlanDigest: string;
  productMapDigest: string;
  set: ObservationSetV1;
  missions: CandidateMission[];
  replayReproduced: ReadonlySet<string>;
  scope: ValidationScope;
}

export interface CompilePolicyResult {
  policy: VerificationPolicyV1;
  /** bounded rejection codes for action_outcome criteria that could NOT compile a probe (never raw text). */
  rejections: { missionKey: string; criterionIndex: number; code: ProbeRejectionCode }[];
}

/**
 * Compile the immutable VerificationPolicyV1 for a plan: one MissionProbeV1 per compilable action_outcome
 * criterion. Non-action criteria simply produce no probe (not a rejection). Deterministic: probes are sorted
 * by (missionKey, criterionIndex) and the policyDigest is canonical over the version + digests + probes.
 */
export function compileVerificationPolicy(input: CompilePolicyInput): CompilePolicyResult {
  const probes: MissionProbeV1[] = [];
  const rejections: CompilePolicyResult["rejections"] = [];
  const actionMissionSet = new Set<string>();
  for (const mission of input.missions) {
    const criteria = mission.groundingV1?.criteria ?? [];
    for (const gc of criteria) {
      if (gc.criterionKind !== "action_outcome") continue; // not an action probe; no rejection
      actionMissionSet.add(mission.missionKey); // this mission IS an action mission
      const r = compileMissionProbe({ mission, criterionIndex: gc.criterionIndex, grounding: gc, set: input.set, replayReproduced: input.replayReproduced, scope: input.scope });
      if ("probe" in r) probes.push(r.probe);
      else rejections.push({ missionKey: mission.missionKey, criterionIndex: gc.criterionIndex, code: r.rejected });
    }
  }
  probes.sort((a, b) => a.missionKey.localeCompare(b.missionKey) || a.criterionIndex - b.criterionIndex);
  const policyBody = {
    version: VERIFICATION_POLICY_VERSION,
    missionPlanDigest: input.missionPlanDigest,
    productMapDigest: input.productMapDigest,
    observationSetDigest: input.set.digest,
    actionMissions: [...actionMissionSet].sort(),
    probes,
  };
  const policyDigest = sha(canon(policyBody));
  return { policy: { ...policyBody, policyDigest }, rejections };
}

/** Recompute a policy's digest for tamper detection (used at approval + settlement). */
export function verificationPolicyDigest(policy: Omit<VerificationPolicyV1, "policyDigest">): string {
  return sha(canon({ version: policy.version, missionPlanDigest: policy.missionPlanDigest, productMapDigest: policy.productMapDigest, observationSetDigest: policy.observationSetDigest, actionMissions: policy.actionMissions, probes: policy.probes }));
}
