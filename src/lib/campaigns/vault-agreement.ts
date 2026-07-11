/**
 * DB ↔ on-chain agreement for a campaign_v2 campaign. Before a V2 campaign is ever
 * presented as live or settled from, the application-derived plan (what the
 * founder configured + what mission-plan.ts hashed) MUST equal what the deployed
 * CampaignVault actually enforces. This is a PURE comparator: the caller fetches
 * the chain snapshot (via the V2 adapter) and builds the DB plan; this reports
 * every field-specific mismatch. It NEVER "repairs" the DB from chain values —
 * disagreement is surfaced, never silently reconciled.
 */

import type { VaultKind } from "@/lib/db/schema";

const ZERO = "0x0000000000000000000000000000000000000000";

/** The application-derived plan (DB + mission-plan.ts). */
export interface DbCampaignPlan {
  chainId: number;
  vaultKind: VaultKind;
  /** the authenticated founder wallet that must own the vault. */
  ownerFounder: string;
  /** the Sage operator configured for this chain. */
  operatorConfigured: string;
  token: string;
  campaignIdHash: string;
  missionPlanDigest: string;
  budgetBase: bigint;
  missions: { missionIdHash: string; rewardBase: bigint; maxCompletions: bigint }[];
}

/** What the deployed CampaignVault + factory report on-chain. */
export interface ChainCampaignSnapshot {
  factoryRecognizes: boolean;
  owner: string;
  operator: string;
  guardian: string;
  token: string;
  campaignIdHash: string;
  missionPlanDigest: string;
  budgetCeiling: bigint;
  chainId: number;
  state: "created" | "funded" | "active" | "paused" | "revoked";
  replaySupport: "supported" | "legacy" | "unreadable";
  /** keyed by missionIdHash (lowercased): the on-chain mission. */
  missions: Record<string, { exists: boolean; rewardBase: bigint; maxCompletions: bigint }>;
}

export type AgreementField =
  | "vault_kind"
  | "provenance"
  | "owner_not_founder"
  | "operator_mismatch"
  | "owner_equals_operator"
  | "guardian_equals_operator"
  | "campaign_id_hash"
  | "mission_plan_digest"
  | "token"
  | "budget"
  | "chain_id"
  | "replay_support"
  | "lifecycle"
  | "mission_missing"
  | "mission_reward"
  | "mission_max_completions";

export interface AgreementMismatch {
  field: AgreementField;
  detail: string;
}
export interface AgreementResult {
  ok: boolean;
  mismatches: AgreementMismatch[];
}

const eqAddr = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const eqHex = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Compare the DB plan against the on-chain snapshot. Returns `ok: true` only when
 * EVERY field agrees. Pure — unit-testable without a chain.
 */
export function checkVaultAgreement(
  db: DbCampaignPlan,
  chain: ChainCampaignSnapshot,
): AgreementResult {
  const m: AgreementMismatch[] = [];
  const push = (field: AgreementField, detail: string) => m.push({ field, detail });

  if (db.vaultKind !== "campaign_v2") push("vault_kind", `db vaultKind is ${db.vaultKind}, not campaign_v2`);
  if (!chain.factoryRecognizes) push("provenance", "vault is not from the CampaignVaultFactory");
  if (!eqAddr(chain.owner, db.ownerFounder)) push("owner_not_founder", `on-chain owner ${chain.owner} != founder ${db.ownerFounder}`);
  if (!eqAddr(chain.operator, db.operatorConfigured)) push("operator_mismatch", `on-chain operator ${chain.operator} != configured ${db.operatorConfigured}`);
  if (eqAddr(chain.owner, chain.operator)) push("owner_equals_operator", "owner and operator are the same address");
  if (!eqAddr(chain.guardian, ZERO) && eqAddr(chain.guardian, chain.operator)) push("guardian_equals_operator", "guardian is the operator");
  if (!eqHex(chain.campaignIdHash, db.campaignIdHash)) push("campaign_id_hash", `on-chain ${chain.campaignIdHash} != derived ${db.campaignIdHash}`);
  if (!eqHex(chain.missionPlanDigest, db.missionPlanDigest)) push("mission_plan_digest", `on-chain ${chain.missionPlanDigest} != derived ${db.missionPlanDigest}`);
  if (!eqAddr(chain.token, db.token)) push("token", `on-chain token ${chain.token} != ${db.token}`);
  if (chain.budgetCeiling !== db.budgetBase) push("budget", `on-chain budget ${chain.budgetCeiling} != plan max ${db.budgetBase}`);
  if (chain.chainId !== db.chainId) push("chain_id", `on-chain ${chain.chainId} != campaign row ${db.chainId}`);
  if (chain.replaySupport !== "supported") push("replay_support", `replay protection is ${chain.replaySupport}`);
  // Lifecycle: a live V2 campaign must be fundable/active, never revoked.
  if (chain.state === "revoked") push("lifecycle", "vault is revoked");

  for (const dm of db.missions) {
    const cm = chain.missions[dm.missionIdHash.toLowerCase()];
    if (!cm || !cm.exists) {
      push("mission_missing", `mission ${dm.missionIdHash} does not exist on-chain`);
      continue;
    }
    if (cm.rewardBase !== dm.rewardBase) push("mission_reward", `mission ${dm.missionIdHash} reward on-chain ${cm.rewardBase} != db ${dm.rewardBase}`);
    if (cm.maxCompletions !== dm.maxCompletions) push("mission_max_completions", `mission ${dm.missionIdHash} maxCompletions on-chain ${cm.maxCompletions} != db ${dm.maxCompletions}`);
  }

  return { ok: m.length === 0, mismatches: m };
}
