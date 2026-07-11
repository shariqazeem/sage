/**
 * MissionSpecV1 — the canonical, validated, human-readable specification of a single
 * mission: the EXACT task Sage evaluated a tester's work against. Pure and
 * deterministic (viem hashing only), with a digest over every economically or
 * operationally meaningful field.
 *
 * SECURITY SCOPE — be truthful about what this is:
 *   - CampaignVault V2 (the contract) enforces missionIdHash, exact reward, completion
 *     cap, budget, velocity, lifecycle, recipient uniqueness, and replay protection.
 *   - MissionSpecV1 is an APPLICATION-LEVEL record of the prose (title/objective/
 *     instructions/criteria/evidence) Sage judged. The current CampaignVault does NOT
 *     store or enforce this prose. The proof surfaces the spec digest as an app-level
 *     integrity record, never as something "the chain verified."
 */

import { type Hex, encodeAbiParameters, keccak256, stringToHex } from "viem";

export const MISSION_SPEC_V1_DOMAIN = "sage.mission.spec.v1" as const;
const SPEC_DOMAIN = keccak256(stringToHex(MISSION_SPEC_V1_DOMAIN));

/** Product limits — bound lengths + list counts so a spec is reviewable + storable. */
export const SPEC_LIMITS = {
  title: 140,
  objective: 600,
  instructions: 6000,
  targetSurface: 600,
  item: 600,
  listMax: 20,
} as const;

/** The structured, load-bearing fields of a mission specification. */
export interface MissionSpecInput {
  /** bytes32 hex — the campaign identity (frozen scheme, from mission-plan.ts). */
  campaignIdHash: Hex;
  /** bytes32 hex — the campaign-scoped mission identity (frozen scheme). */
  missionIdHash: Hex;
  title: string;
  /** a concise tester-facing objective. */
  objective: string;
  /** step-by-step instructions the tester follows. */
  instructions: string;
  /** the target surface or URL the mission is performed against. */
  targetSurface: string;
  /** ordered acceptance criteria. */
  criteria: string[];
  /** ordered evidence requirements. */
  evidenceRequirements: string[];
  /** exact reward in token base units (6dp). */
  rewardBase: bigint;
  /** maximum paid completions. */
  maxCompletions: bigint;
}

/** A normalized spec — human text NFC-normalized + outer-trimmed, ready to digest. */
export interface NormalizedMissionSpec {
  campaignIdHash: Hex;
  missionIdHash: Hex;
  title: string;
  objective: string;
  instructions: string;
  targetSurface: string;
  criteria: string[];
  evidenceRequirements: string[];
  rewardBase: bigint;
  maxCompletions: bigint;
}

export type MissionSpecError =
  | "empty_title"
  | "empty_objective"
  | "empty_instructions"
  | "empty_target_surface"
  | "no_criteria"
  | "no_evidence"
  | "empty_criterion"
  | "empty_evidence_item"
  | "duplicate_criterion"
  | "duplicate_evidence"
  | "title_too_long"
  | "objective_too_long"
  | "instructions_too_long"
  | "target_surface_too_long"
  | "criterion_too_long"
  | "evidence_item_too_long"
  | "too_many_criteria"
  | "too_many_evidence"
  | "zero_reward"
  | "zero_max_completions"
  | "bad_campaign_id_hash"
  | "bad_mission_id_hash";

/**
 * Normalize a single human string: Unicode NFC + outer-whitespace trim. Outer trim is
 * meaning-preserving (leading/trailing whitespace is not content); inner text — case,
 * punctuation, spacing — is preserved exactly. NEVER rewrites content.
 */
export function normalizeText(s: string): string {
  return s.normalize("NFC").trim();
}

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Validate a mission specification under the product rules. Returns null when valid,
 * else the FIRST violated rule. Pure — the same checks the founder-setup + accessors
 * enforce, so an invalid spec never reaches persistence or a digest.
 */
export function validateMissionSpec(input: MissionSpecInput): MissionSpecError | null {
  if (!BYTES32_RE.test(input.campaignIdHash)) return "bad_campaign_id_hash";
  if (!BYTES32_RE.test(input.missionIdHash)) return "bad_mission_id_hash";

  const title = normalizeText(input.title);
  if (title.length === 0) return "empty_title";
  if (title.length > SPEC_LIMITS.title) return "title_too_long";

  const objective = normalizeText(input.objective);
  if (objective.length === 0) return "empty_objective";
  if (objective.length > SPEC_LIMITS.objective) return "objective_too_long";

  const instructions = normalizeText(input.instructions);
  if (instructions.length === 0) return "empty_instructions";
  if (instructions.length > SPEC_LIMITS.instructions) return "instructions_too_long";

  const target = normalizeText(input.targetSurface);
  if (target.length === 0) return "empty_target_surface";
  if (target.length > SPEC_LIMITS.targetSurface) return "target_surface_too_long";

  const criteria = input.criteria.map(normalizeText);
  if (criteria.length === 0) return "no_criteria";
  if (criteria.length > SPEC_LIMITS.listMax) return "too_many_criteria";
  if (criteria.some((c) => c.length === 0)) return "empty_criterion";
  if (criteria.some((c) => c.length > SPEC_LIMITS.item)) return "criterion_too_long";
  if (new Set(criteria).size !== criteria.length) return "duplicate_criterion";

  const evidence = input.evidenceRequirements.map(normalizeText);
  if (evidence.length === 0) return "no_evidence";
  if (evidence.length > SPEC_LIMITS.listMax) return "too_many_evidence";
  if (evidence.some((e) => e.length === 0)) return "empty_evidence_item";
  if (evidence.some((e) => e.length > SPEC_LIMITS.item)) return "evidence_item_too_long";
  if (new Set(evidence).size !== evidence.length) return "duplicate_evidence";

  if (input.rewardBase <= BigInt(0)) return "zero_reward";
  if (input.maxCompletions <= BigInt(0)) return "zero_max_completions";
  return null;
}

/** Normalize a validated spec. Throws (via validateMissionSpec) if invalid — validate first. */
export function normalizeMissionSpec(input: MissionSpecInput): NormalizedMissionSpec {
  const err = validateMissionSpec(input);
  if (err) throw new Error(`invalid mission spec: ${err}`);
  return {
    campaignIdHash: input.campaignIdHash,
    missionIdHash: input.missionIdHash,
    title: normalizeText(input.title),
    objective: normalizeText(input.objective),
    instructions: normalizeText(input.instructions),
    targetSurface: normalizeText(input.targetSurface),
    criteria: input.criteria.map(normalizeText),
    evidenceRequirements: input.evidenceRequirements.map(normalizeText),
    rewardBase: input.rewardBase,
    maxCompletions: input.maxCompletions,
  };
}

const SPEC_ABI = [
  { type: "bytes32" }, // domain
  { type: "bytes32" }, // campaignIdHash
  { type: "bytes32" }, // missionIdHash
  { type: "bytes32" }, // title
  { type: "bytes32" }, // objective
  { type: "bytes32" }, // instructions
  { type: "bytes32" }, // targetSurface
  { type: "bytes32[]" }, // criteria (ordered)
  { type: "bytes32[]" }, // evidenceRequirements (ordered)
  { type: "uint256" }, // rewardBase
  { type: "uint256" }, // maxCompletions
] as const;

/**
 * The canonical MissionSpecV1 digest. Covers every economically/operationally
 * meaningful field: id hashes, title, objective, instructions, target surface, the
 * ORDERED criteria + evidence (reordering changes the digest), the exact `rewardBase`
 * (base units — one unit changes the digest), and `maxCompletions`. Pure presentation
 * metadata is NOT part of `MissionSpecInput` at all — there is no `displayReward` or
 * `displayOrder` field — so a derived display string (e.g. "$0.50") can never affect
 * the digest; only the exact integer base-unit reward does. Deterministic.
 */
export function missionSpecDigest(input: MissionSpecInput): Hex {
  const n = normalizeMissionSpec(input);
  const h = (s: string): Hex => keccak256(stringToHex(s));
  return keccak256(
    encodeAbiParameters(SPEC_ABI, [
      SPEC_DOMAIN,
      n.campaignIdHash,
      n.missionIdHash,
      h(n.title),
      h(n.objective),
      h(n.instructions),
      h(n.targetSurface),
      n.criteria.map(h),
      n.evidenceRequirements.map(h),
      n.rewardBase,
      n.maxCompletions,
    ]),
  );
}
