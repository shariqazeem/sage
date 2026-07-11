/**
 * The mission-plan domain model — pure, deterministic, and aligned 1:1 with
 * CampaignVault V2's on-chain constraints. Turns an app-level campaign + missions
 * into the exact identity hashes, mission specs, budget, and plan digest the vault
 * enforces, and validates the plan under the SAME rules the constructor does
 * (≤32 missions, nonzero reward/cap, unique ids, budget = Σ reward×maxCompletions).
 *
 * Pure — viem hashing only. The mission-generation AI (a later pass) produces the
 * mission inputs; this module validates + encodes them.
 */

import { type Hex, encodeAbiParameters, keccak256, stringToHex } from "viem";
import { missionPlanDigest, type MissionSpec } from "@/lib/deputy/campaign-commitment";

export const MAX_MISSIONS = 32;

/**
 * FROZEN v1 identity-hash scheme. Do NOT change these constructions without a new
 * version tag — a deployed CampaignVault stores these bytes32 immutably.
 *
 *   campaignIdHash = keccak256(abi.encode(
 *       keccak256("SAGE_CAMPAIGN_ID_V1"),
 *       keccak256(utf8Nfc(publicCampaignId))
 *   ))
 *   missionIdHash  = keccak256(abi.encode(
 *       keccak256("SAGE_MISSION_ID_V1"),
 *       campaignIdHash,                       // scopes the mission to its campaign
 *       keccak256(utf8Nfc(publicMissionId))
 *   ))
 *
 * Reproduced byte-for-byte in Solidity (contracts/test/CampaignVault.t.sol golden
 * vectors) and pinned in mission-plan.test.ts. Input rules: IDs are Unicode
 * NFC-normalized, must be non-empty, and are NOT lowercased (case is significant).
 */
export const SAGE_CAMPAIGN_ID_V1 = "SAGE_CAMPAIGN_ID_V1" as const;
export const SAGE_MISSION_ID_V1 = "SAGE_MISSION_ID_V1" as const;
const CAMPAIGN_DOMAIN = keccak256(stringToHex(SAGE_CAMPAIGN_ID_V1));
const MISSION_DOMAIN = keccak256(stringToHex(SAGE_MISSION_ID_V1));

/** Normalize a public ID: Unicode NFC, non-empty (never lowercased). */
export function normalizePublicId(id: string): string {
  const n = id.normalize("NFC");
  if (n.length === 0) throw new Error("public id must be non-empty");
  return n;
}

export interface MissionInput {
  /** stable public mission key (unique within the campaign). */
  missionKey: string;
  rewardBase: bigint; // token base units (6dp)
  maxCompletions: bigint;
}

/** Deterministic on-chain campaign identity (nonzero bytes32). Frozen v1 scheme. */
export function campaignIdHash(publicCampaignId: string): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [CAMPAIGN_DOMAIN, keccak256(stringToHex(normalizePublicId(publicCampaignId)))],
    ),
  );
}

/** Deterministic on-chain mission id (bytes32), scoped to its campaign. Frozen v1. */
export function missionIdHash(publicCampaignId: string, publicMissionId: string): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [
        MISSION_DOMAIN,
        campaignIdHash(publicCampaignId),
        keccak256(stringToHex(normalizePublicId(publicMissionId))),
      ],
    ),
  );
}

export type MissionPlanError =
  | "no_missions"
  | "too_many_missions"
  | "duplicate_mission_key"
  | "zero_reward"
  | "zero_max_completions"
  | "budget_overflow";

/**
 * Validate a mission plan under the vault's exact rules. Returns null when valid,
 * else the first violated rule. Pure — the same checks the constructor enforces,
 * caught early so the app never broadcasts a doomed createCampaignVault.
 */
export function validateMissionPlan(missions: MissionInput[]): MissionPlanError | null {
  if (missions.length === 0) return "no_missions";
  if (missions.length > MAX_MISSIONS) return "too_many_missions";
  const seen = new Set<string>();
  let budget = BigInt(0);
  for (const m of missions) {
    if (seen.has(m.missionKey)) return "duplicate_mission_key";
    seen.add(m.missionKey);
    if (m.rewardBase <= BigInt(0)) return "zero_reward";
    if (m.maxCompletions <= BigInt(0)) return "zero_max_completions";
    budget += m.rewardBase * m.maxCompletions;
  }
  // bytes32/uint256 ceiling — mirrors the checked arithmetic on-chain.
  if (budget > (BigInt(1) << BigInt(256)) - BigInt(1)) return "budget_overflow";
  return null;
}

/** The exact budget ceiling the vault will compute: Σ (reward × maxCompletions). */
export function missionPlanBudget(missions: MissionInput[]): bigint {
  return missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));
}

/** App missions → the on-chain MissionSpec[] (creation order preserved). */
export function toMissionSpecs(campaignKey: string, missions: MissionInput[]): MissionSpec[] {
  return missions.map((m) => ({
    missionId: missionIdHash(campaignKey, m.missionKey),
    rewardBase: m.rewardBase,
    maxCompletions: m.maxCompletions,
  }));
}

export interface CampaignPlan {
  campaignIdHash: Hex;
  missionPlanDigest: Hex;
  budgetBase: bigint;
  specs: MissionSpec[];
}

/**
 * Compute the full on-chain plan (identity, digest, budget, specs) for a campaign.
 * Throws (via validateMissionPlan) surfaced by the caller — call validate first.
 */
export function computeCampaignPlan(campaignKey: string, missions: MissionInput[]): CampaignPlan {
  const cid = campaignIdHash(campaignKey);
  const specs = toMissionSpecs(campaignKey, missions);
  return {
    campaignIdHash: cid,
    missionPlanDigest: missionPlanDigest(cid, specs),
    budgetBase: missionPlanBudget(missions),
    specs,
  };
}
