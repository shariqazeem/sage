import { compileVerificationPolicyV2 } from "@/lib/launch/mission-probe-v2";
import type { ObservationSetV1, ObservedFactV1, ActionTransitionV1 } from "@/lib/launch/observed-facts";
import type { CandidateMission } from "@/lib/launch/schemas";
import type { ValidationScope } from "@/lib/launch/validate-mission";
import type { Campaign } from "@/lib/db/schema";

/** Shared V2 policy + policy-REQUIRED campaign fixtures for the deputy payout-replay tests (not a .test file). */

export const V2_SCOPE: ValidationScope = { hosts: new Set(["app.test"]) } as ValidationScope;
const fact: ObservedFactV1 = { version: "obs-fact-v1", id: "f-after", source: "field_transition", grounding: "seen", decisive: true, pageUrl: "https://app.test/report", stateId: "s-after", visibleTexts: ["Report ready"], provenanceDigest: "pd" };
const trans: ActionTransitionV1 = { version: "action-transition-v1", id: "t-load", startUrl: "https://app.test/", beforeStateDigest: "b", verb: "click", locator: { role: "button", accessibleName: "Load report" }, afterUrl: "https://app.test/report", afterStateDigest: "s-after", addedTexts: ["Report ready"], removedTexts: [], observableChange: true, networkMethodSummary: "get_observed", safeClassification: "safe", provenance: { fromStateIndex: 0, toStateIndex: 1 } };
export const V2_SET: ObservationSetV1 = { version: "obs-set-v1" as ObservationSetV1["version"], facts: [fact], transitions: [trans], captureVersion: 1, digest: "setdig" };
export const V2_MISSION: CandidateMission = { missionKey: "m-load", criteria: ["c"], evidenceRequirements: ["e"], groundingV1: { version: "mission-grounding-v1", observationSetDigest: "setdig", criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", sourceFactIds: ["f-after"], sourceTransitionIds: ["t-load"], evidenceIndex: 0, verificationMode: "observation" }] } } as unknown as CandidateMission;

export function makeV2Policy(missions: CandidateMission[] = [V2_MISSION], replayed = new Set(["t-load"])) {
  return compileVerificationPolicyV2({ missionPlanDigest: "0xplan", productMapDigest: "0xmap", set: V2_SET, missions, replayReproduced: replayed, scope: V2_SCOPE }).policy;
}

/** A policy-REQUIRED canary campaign carrying a complete V2 policy (the common case under test). */
export function v2Campaign(over: Partial<Campaign> = {}, missions?: CandidateMission[], replayed?: Set<string>): Campaign {
  const policy = makeV2Policy(missions, replayed);
  return { id: "c1", title: "T", rewardAmount: 500_000, vaultAddress: `0x${"1".repeat(40)}`, ownerIsSage: true, autonomy: "autopilot", autopilotThreshold: 0.85, perWalletPayoutCap: 1, missionPlanDigest: "0xplan", verificationPolicy: policy, verificationPolicyDigest: policy.policyDigest, verificationPolicyRequired: true, ...over } as unknown as Campaign;
}
