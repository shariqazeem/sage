import "server-only";

import { getAddress, isAddress, type Address, type Hex } from "viem";

import { db } from "@/lib/db";
import { campaigns, missions as missionsTable } from "@/lib/db/schema";
import { nowSeconds } from "@/lib/db/keys";
import { recordEvent } from "@/lib/db/campaigns";
import {
  computeCampaignPlan,
  missionIdHash as computeMissionIdHash,
  normalizePublicId,
  validateMissionPlan,
  type MissionInput,
} from "./mission-plan";
import { missionSpecDigest, validateMissionSpec } from "./mission-spec";
import { evaluateCampaignAgreement } from "./vault-strategy";
import { operatorAddress as realOperatorAddress } from "@/lib/deputy/signer";
import {
  realCampaignVaultAdapter,
  type CampaignVaultAdapter,
} from "@/lib/deputy/campaign-vault";
import { isSameWallet } from "@/lib/auth/session";
import type { Campaign, Mission } from "@/lib/db/schema";

/**
 * Protected founder/developer setup for attaching a CampaignVault V2 campaign to
 * Sage. This is NOT the final AI onboarding — it is the SAFE operational surface for
 * a controlled live exercise. It computes a reviewable preview (all hashes + budgets),
 * verifies the DEPLOYED vault against the plan using the SAME agreement check the
 * settlement pipeline uses, and persists the campaign + missions ATOMICALLY only when
 * that agreement passes. It never deploys, never funds, and never touches a key.
 */

/* ─────────────────────────────────────────────────────── inputs ────────── */

export interface V2MissionSetupInput {
  missionKey: string;
  title: string;
  objective: string;
  instructions: string;
  targetSurface: string;
  criteria: string[];
  evidenceRequirements: string[];
  /** exact reward in token base units (6dp). */
  rewardBase: bigint;
  maxCompletions: bigint;
}

export interface V2SetupInput {
  publicCampaignId: string;
  title: string;
  productUrl: string;
  chainId: number;
  expectedToken: string;
  founderAddress: string;
  /** the Sage operator the founder configured the vault with. */
  operatorAddress: string;
  guardian: string;
  factoryAddress: string;
  vaultAddress: string;
  missions: V2MissionSetupInput[];
}

/* ─────────────────────────────────────────────────────── preview ───────── */

export interface V2MissionPreview {
  missionKey: string;
  missionIdHash: Hex;
  specDigest: Hex;
  rewardBase: string;
  displayReward: number;
  maxCompletions: number;
  missionBudgetBase: string;
}

export interface V2SetupPreview {
  ok: boolean;
  errors: string[];
  publicCampaignId: string;
  campaignIdHash: Hex | null;
  missionPlanDigest: Hex | null;
  totalBudgetBase: string;
  chainId: number;
  token: string | null;
  founder: string | null;
  operator: string | null;
  guardian: string | null;
  vault: string | null;
  factory: string | null;
  missions: V2MissionPreview[];
}

const MAX_MISSIONS_SETUP = 3;

function addrOrNull(a: string): string | null {
  try {
    return isAddress(a) ? getAddress(a) : null;
  } catch {
    return null;
  }
}

/**
 * PURE preview: validate the whole setup and compute every hash + budget the founder
 * reviews before anything is persisted. No chain, no db. `ok` is true only when the
 * plan + every mission specification is valid; otherwise `errors` lists what's wrong.
 */
export function computeV2SetupPreview(input: V2SetupInput): V2SetupPreview {
  const errors: string[] = [];

  let publicId = "";
  try {
    publicId = normalizePublicId(input.publicCampaignId);
  } catch {
    errors.push("campaign_id_empty");
  }
  if (input.missions.length === 0) errors.push("no_missions");
  if (input.missions.length > MAX_MISSIONS_SETUP) errors.push("too_many_missions");

  for (const field of ["expectedToken", "founderAddress", "operatorAddress", "vaultAddress", "factoryAddress"] as const) {
    if (!addrOrNull(input[field])) errors.push(`bad_${field}`);
  }
  // guardian may be the zero address (no guardian) but must be a valid address form.
  if (!addrOrNull(input.guardian) && input.guardian !== "0x0000000000000000000000000000000000000000") {
    errors.push("bad_guardian");
  }
  if (addrOrNull(input.founderAddress) && isSameWallet(input.founderAddress, input.operatorAddress)) {
    errors.push("owner_equals_operator");
  }

  const missionInputs: MissionInput[] = input.missions.map((m) => ({
    missionKey: m.missionKey,
    rewardBase: m.rewardBase,
    maxCompletions: m.maxCompletions,
  }));
  const planErr = validateMissionPlan(missionInputs);
  if (planErr) errors.push(`plan_${planErr}`);

  // Per-mission spec validation (prose). Needs the campaign id to hash mission ids.
  const missionPreviews: V2MissionPreview[] = [];
  let campaignIdHash: Hex | null = null;
  let missionPlanDigest: Hex | null = null;
  let totalBudget = BigInt(0);

  if (publicId && !planErr) {
    const plan = computeCampaignPlan(publicId, missionInputs);
    campaignIdHash = plan.campaignIdHash;
    missionPlanDigest = plan.missionPlanDigest;
    totalBudget = plan.budgetBase;
    for (const m of input.missions) {
      const mid = computeMissionIdHash(publicId, m.missionKey);
      const specErr = validateMissionSpec({
        campaignIdHash: plan.campaignIdHash,
        missionIdHash: mid,
        title: m.title,
        objective: m.objective,
        instructions: m.instructions,
        targetSurface: m.targetSurface,
        criteria: m.criteria,
        evidenceRequirements: m.evidenceRequirements,
        rewardBase: m.rewardBase,
        maxCompletions: m.maxCompletions,
      });
      if (specErr) errors.push(`mission_${m.missionKey}_${specErr}`);
      missionPreviews.push({
        missionKey: m.missionKey,
        missionIdHash: mid,
        specDigest: specErr
          ? (`0x${"0".repeat(64)}` as Hex)
          : missionSpecDigest({
              campaignIdHash: plan.campaignIdHash,
              missionIdHash: mid,
              title: m.title,
              objective: m.objective,
              instructions: m.instructions,
              targetSurface: m.targetSurface,
              criteria: m.criteria,
              evidenceRequirements: m.evidenceRequirements,
              rewardBase: m.rewardBase,
              maxCompletions: m.maxCompletions,
            }),
        rewardBase: m.rewardBase.toString(),
        displayReward: Number(m.rewardBase) / 1_000_000,
        maxCompletions: Number(m.maxCompletions),
        missionBudgetBase: (m.rewardBase * m.maxCompletions).toString(),
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    publicCampaignId: publicId,
    campaignIdHash,
    missionPlanDigest,
    totalBudgetBase: totalBudget.toString(),
    chainId: input.chainId,
    token: addrOrNull(input.expectedToken),
    founder: addrOrNull(input.founderAddress),
    operator: addrOrNull(input.operatorAddress),
    guardian: addrOrNull(input.guardian) ?? input.guardian,
    vault: addrOrNull(input.vaultAddress),
    factory: addrOrNull(input.factoryAddress),
    missions: missionPreviews,
  };
}

/* ─────────────────────────────────────────── authorization (fail closed) ── */

/**
 * Whether the setup mutation is permitted. Fail closed in production: it runs ONLY
 * when the caller is authenticated (via SIWE) as the founder/owner. In an explicitly
 * non-production (dev/staging) environment it is permitted for the controlled
 * exercise. An unprotected query param or client button is never authorization.
 */
export function setupAllowed(
  sessionWallet: string | null,
  founderAddress: string,
): { allowed: boolean; reason: string } {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return { allowed: true, reason: "dev/staging" };
  if (!sessionWallet) return { allowed: false, reason: "authentication required" };
  if (!isSameWallet(sessionWallet, founderAddress)) {
    return { allowed: false, reason: "only the founder/owner may configure this campaign" };
  }
  return { allowed: true, reason: "founder authenticated" };
}

/* ─────────────────────────────────────────── verify + atomic persist ────── */

export interface V2SetupDeps {
  adapter?: CampaignVaultAdapter;
  operatorAddress?: (chainId: number) => Address;
}

export type V2SetupResult =
  | { ok: true; campaignId: string; campaignIdHash: string; missionPlanDigest: string }
  | { ok: false; stage: "validation" | "agreement" | "persist"; errors: string[] };

/** A synthetic (unpersisted) Campaign for the agreement check — never written as-is. */
function syntheticCampaign(input: V2SetupInput, preview: V2SetupPreview): Campaign {
  return {
    id: preview.publicCampaignId,
    posterWallet: getAddress(input.founderAddress),
    chainId: input.chainId,
    vaultKind: "campaign_v2",
    campaignIdHash: preview.campaignIdHash,
    missionPlanDigest: preview.missionPlanDigest,
    settlementToken: getAddress(input.expectedToken),
    vaultAddress: getAddress(input.vaultAddress),
  } as unknown as Campaign;
}

function syntheticMissions(input: V2SetupInput, preview: V2SetupPreview): Mission[] {
  return input.missions.map(
    (m, i) =>
      ({
        missionIdHash: preview.missions[i].missionIdHash,
        rewardAmount: Number(m.rewardBase),
        maxCompletions: Number(m.maxCompletions),
      }) as unknown as Mission,
  );
}

/**
 * Verify a DEPLOYED CampaignVault against the founder's plan and, ONLY when the DB↔chain
 * agreement passes, persist the campaign + its locked missions ATOMICALLY (a
 * transaction — a failure leaves NO active campaign and NO partial mission rows). Uses
 * the SAME `evaluateCampaignAgreement` the settlement pipeline uses; there is no weaker
 * parallel validator. Never deploys, funds, or touches a key.
 */
export async function attachV2Campaign(
  input: V2SetupInput,
  deps: V2SetupDeps = {},
): Promise<V2SetupResult> {
  const preview = computeV2SetupPreview(input);
  if (!preview.ok || !preview.campaignIdHash || !preview.missionPlanDigest) {
    return { ok: false, stage: "validation", errors: preview.errors };
  }

  const adapter = deps.adapter ?? realCampaignVaultAdapter;
  const operatorFor = deps.operatorAddress ?? realOperatorAddress;

  const missionIds = preview.missions.map((m) => m.missionIdHash);
  let snapshot;
  try {
    snapshot = await adapter.readSnapshot(getAddress(input.vaultAddress), input.chainId, missionIds);
  } catch {
    return { ok: false, stage: "agreement", errors: ["vault_unreadable"] };
  }

  const agreement = evaluateCampaignAgreement(
    syntheticCampaign(input, preview),
    syntheticMissions(input, preview),
    snapshot,
    operatorFor,
  );
  if (!agreement.ok) {
    return { ok: false, stage: "agreement", errors: agreement.mismatches.map((m) => m.field) };
  }

  // Atomic persist: campaign + all missions (locked/active) or nothing.
  try {
    const now = nowSeconds();
    db.transaction((tx) => {
      tx.insert(campaigns)
        .values({
          id: preview.publicCampaignId,
          title: input.title,
          descriptionMd: input.productUrl,
          rewardAmount: Number(input.missions[0].rewardBase),
          vaultAddress: getAddress(input.vaultAddress),
          chainId: input.chainId,
          posterWallet: getAddress(input.founderAddress),
          ownerIsSage: false,
          status: "live",
          autonomy: "manual",
          vaultKind: "campaign_v2",
          campaignIdHash: preview.campaignIdHash as string,
          missionPlanDigest: preview.missionPlanDigest as string,
          settlementToken: getAddress(input.expectedToken),
          commitmentVersion: 2,
          createdAt: now,
        })
        .run();
      input.missions.forEach((m, i) => {
        tx.insert(missionsTable)
          .values({
            id: `${preview.publicCampaignId}:${m.missionKey}`,
            campaignId: preview.publicCampaignId,
            missionKey: m.missionKey,
            missionIdHash: preview.missions[i].missionIdHash,
            title: m.title,
            objective: m.objective,
            instructions: m.instructions,
            targetSurface: m.targetSurface,
            criteria: m.criteria,
            evidenceList: m.evidenceRequirements,
            rewardAmount: Number(m.rewardBase),
            maxCompletions: Number(m.maxCompletions),
            status: "active",
            displayOrder: i,
            specDigest: preview.missions[i].specDigest,
            lockedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      });
    });
  } catch (err) {
    return {
      ok: false,
      stage: "persist",
      errors: [err instanceof Error ? err.message.slice(0, 200) : "persist_failed"],
    };
  }

  recordEvent({
    campaignId: preview.publicCampaignId,
    kind: "campaign_created",
    detail: input.title,
  });

  return {
    ok: true,
    campaignId: preview.publicCampaignId,
    campaignIdHash: preview.campaignIdHash,
    missionPlanDigest: preview.missionPlanDigest,
  };
}
