/**
 * Public-identity integrity — the pre-decision, pre-broadcast invariant.
 *
 * A CampaignVault V2 payout must never occur when the campaign's PUBLIC identity and
 * its persisted / on-chain identity disagree. This module recomputes the whole
 * identity from the canonical PUBLIC records (the public campaign id, the public
 * mission keys, the locked mission specifications) using the FROZEN production hash
 * functions, and compares it against every stored, submitted, and on-chain value. It
 * trusts NOTHING stored — a persisted `campaignIdHash` that merely matches the chain
 * is not enough; it must also equal `campaignIdHash(publicCampaignId)`.
 *
 * Pure + deterministic (viem hashing only, no I/O, no `server-only`), so it runs
 * identically in the setup attachment and the settlement pipeline, and unit-tests
 * directly. It NEVER repairs an id or a hash — a mismatch is a fail-closed HOLD.
 */

import { campaignIdHash, computeCampaignPlan, missionIdHash } from "./mission-plan";
import { missionSpecDigest } from "./mission-spec";
import type { Mission } from "@/lib/db/schema";

/** The stable, machine-readable identity mismatch reasons. */
export type PublicIdentityMismatch =
  | "public_campaign_id_hash_mismatch"
  | "public_mission_id_hash_mismatch"
  | "mission_spec_digest_mismatch"
  | "submission_mission_identity_mismatch"
  | "mission_plan_recomputation_mismatch";

/** The locked-mission fields the recompute needs (public key + prose + economics). */
export interface IdentityMission {
  missionKey: string;
  /** stored bytes32 mission id hash. */
  missionIdHash: string;
  /** stored MissionSpecV1 digest (null when never locked). */
  specDigest: string | null;
  title: string;
  objective: string;
  instructions: string;
  targetSurface: string;
  criteria: string[];
  evidenceList: string[];
  rewardBase: bigint;
  maxCompletions: bigint;
}

export interface PublicIdentityInput {
  /** the canonical public campaign id (the DB primary key / URL slug). */
  publicCampaignId: string;
  storedCampaignIdHash: string | null;
  storedMissionPlanDigest: string | null;
  /** every mission of the campaign, in any order. */
  missions: IdentityMission[];
  /** the submission under settlement (its captured mission identity), if any. */
  submission?: { missionIdHash: string | null; missionSpecDigest: string | null } | null;
  /** the vault's on-chain identity, when a chain read is available (pre-broadcast). */
  onchain?: { campaignIdHash: string; missionPlanDigest: string } | null;
}

export interface IdentityMismatchDetail {
  field: string;
  reason: PublicIdentityMismatch;
}

export interface PublicIdentityResult {
  ok: boolean;
  mismatches: IdentityMismatchDetail[];
  /** the values recomputed from the public records (for logging / proof). */
  recomputed: { campaignIdHash: string | null; missionPlanDigest: string | null };
}

const eqHex = (a?: string | null, b?: string | null): boolean =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

/** Map a persisted mission row into the identity recompute shape. */
export function missionToIdentity(m: Mission): IdentityMission {
  return {
    missionKey: m.missionKey,
    missionIdHash: m.missionIdHash,
    specDigest: m.specDigest,
    title: m.title,
    objective: m.objective,
    instructions: m.instructions,
    targetSurface: m.targetSurface,
    criteria: m.criteria,
    evidenceList: m.evidenceList,
    rewardBase: BigInt(m.rewardAmount),
    maxCompletions: BigInt(m.maxCompletions),
  };
}

/**
 * Recompute the campaign/mission/spec/plan identity from the PUBLIC records and compare
 * it against the persisted, submitted, and on-chain values. Returns every mismatch (a
 * caller HOLDs on any). Never throws — an un-recomputable field is itself a mismatch.
 */
export function verifyPublicIdentity(input: PublicIdentityInput): PublicIdentityResult {
  const mismatches: IdentityMismatchDetail[] = [];
  const push = (field: string, reason: PublicIdentityMismatch) => mismatches.push({ field, reason });

  // 1. campaignIdHash — recomputed from the PUBLIC campaign id (trust nothing stored).
  let recomputedCID: string | null = null;
  try {
    recomputedCID = campaignIdHash(input.publicCampaignId);
  } catch {
    recomputedCID = null;
  }
  if (!recomputedCID) {
    // an un-hashable public id can never match anything committed → fail closed.
    push("publicCampaignId", "public_campaign_id_hash_mismatch");
  } else {
    if (input.storedCampaignIdHash != null && !eqHex(recomputedCID, input.storedCampaignIdHash)) {
      push("stored campaignIdHash", "public_campaign_id_hash_mismatch");
    }
    if (input.onchain && !eqHex(recomputedCID, input.onchain.campaignIdHash)) {
      push("on-chain campaignIdHash", "public_campaign_id_hash_mismatch");
    }
  }

  // 2. per-mission: recompute missionIdHash + MissionSpecV1 digest from public ids + prose.
  const recomputedMidByKey = new Map<string, string>();
  const recomputedSpecByKey = new Map<string, string>();
  for (const m of input.missions) {
    let recomputedMID: string | null = null;
    try {
      recomputedMID = missionIdHash(input.publicCampaignId, m.missionKey);
    } catch {
      recomputedMID = null;
    }
    if (recomputedMID) {
      recomputedMidByKey.set(m.missionKey, recomputedMID);
      if (!eqHex(recomputedMID, m.missionIdHash)) {
        push(`mission ${m.missionKey} idHash`, "public_mission_id_hash_mismatch");
      }
    } else {
      push(`mission ${m.missionKey} idHash`, "public_mission_id_hash_mismatch");
    }

    // recompute the spec digest from the recomputed ids + the locked prose. Invalid /
    // empty prose can't be digested — treat as un-recomputable (only a mismatch when a
    // spec digest was actually stored to compare against).
    let recomputedSpec: string | null = null;
    if (recomputedCID && recomputedMID) {
      try {
        recomputedSpec = missionSpecDigest({
          campaignIdHash: recomputedCID as `0x${string}`,
          missionIdHash: recomputedMID as `0x${string}`,
          title: m.title,
          objective: m.objective,
          instructions: m.instructions,
          targetSurface: m.targetSurface,
          criteria: m.criteria,
          evidenceRequirements: m.evidenceList,
          rewardBase: m.rewardBase,
          maxCompletions: m.maxCompletions,
        });
      } catch {
        recomputedSpec = null;
      }
    }
    if (recomputedSpec) recomputedSpecByKey.set(m.missionKey, recomputedSpec);
    if (m.specDigest != null && (!recomputedSpec || !eqHex(recomputedSpec, m.specDigest))) {
      push(`mission ${m.missionKey} specDigest`, "mission_spec_digest_mismatch");
    }
  }

  // 3. missionPlanDigest — recomputed from the public id + each mission's reward + cap.
  let recomputedPlan: string | null = null;
  try {
    recomputedPlan = computeCampaignPlan(
      input.publicCampaignId,
      input.missions.map((m) => ({
        missionKey: m.missionKey,
        rewardBase: m.rewardBase,
        maxCompletions: m.maxCompletions,
      })),
    ).missionPlanDigest;
  } catch {
    recomputedPlan = null;
  }
  if (input.storedMissionPlanDigest != null && !eqHex(recomputedPlan, input.storedMissionPlanDigest)) {
    push("stored missionPlanDigest", "mission_plan_recomputation_mismatch");
  }
  if (input.onchain && !eqHex(recomputedPlan, input.onchain.missionPlanDigest)) {
    push("on-chain missionPlanDigest", "mission_plan_recomputation_mismatch");
  }

  // 4. submission identity — the submission must target a recomputed mission, and its
  //    captured spec digest must equal that mission's recomputed spec.
  if (input.submission?.missionIdHash) {
    const key = [...recomputedMidByKey.entries()].find(([, mid]) =>
      eqHex(mid, input.submission!.missionIdHash),
    )?.[0];
    if (!key) {
      push("submission missionIdHash", "submission_mission_identity_mismatch");
    } else if (
      input.submission.missionSpecDigest != null &&
      !eqHex(input.submission.missionSpecDigest, recomputedSpecByKey.get(key) ?? null)
    ) {
      push("submission missionSpecDigest", "submission_mission_identity_mismatch");
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches,
    recomputed: { campaignIdHash: recomputedCID, missionPlanDigest: recomputedPlan },
  };
}

/** Compact, stable reason string for a hold detail / log (deduped reasons). */
export function identityMismatchSummary(result: PublicIdentityResult): string {
  return [...new Set(result.mismatches.map((m) => m.reason))].join(", ");
}
