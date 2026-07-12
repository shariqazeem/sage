import "server-only";

/**
 * The deployment orchestration service — the server-owned glue between an APPROVED plan
 * and the durable deployment machine. It:
 *   - loads the approved DeploymentReadyPlan by RECOMPUTING it (trust nothing stored);
 *   - owns the on-chain parameters the client may NEVER supply (factory, token, operator);
 *   - validates the founder-chosen limits and builds the plan-bound deploy bundle;
 *   - selects the chain verifier (real adapter, or a deterministic fake under SAGE_E2E).
 *
 * The client supplies only its wallet (owner), a guardian, a daily cap, and a duration —
 * every economic array + address that controls money comes from the approved plan or from
 * server chain configuration here.
 */

import { getAddress, type Address } from "viem";

import { getInspectionJob } from "@/lib/db/inspection";
import { getApprovedRevision } from "@/lib/db/plan-revisions";
import { deserializePlan } from "./serde";
import { verifyPlanForApproval, type DeploymentReadyPlan } from "./approve";
import { MISSION_PROMPT_VERSION } from "./mission-prompt";
import { buildDeployBundle, deriveDeploymentInputs, type DeployPlanBundle, type DeploymentSettings } from "./deploy-plan";
import { chainConfig } from "@/lib/deputy/networks";
import type { Deployment } from "@/lib/db/schema";

/** Only Metis Sepolia may deploy this pass. Mainnet stays disabled unless explicitly armed. */
export const LAUNCH_CHAIN_ID = 59902;

export interface LaunchChainConfig {
  chainId: number;
  factory: Address | null;
  token: Address | null;
  operator: Address | null;
  configured: boolean;
  missing: string[];
}

/** The V2 factory address for a chain (server env), or null when unconfigured. */
function factoryAddress(chainId: number): Address | null {
  const raw =
    (chainId === 2345 ? process.env.GOAT_CAMPAIGN_FACTORY_ADDRESS : process.env.METIS_CAMPAIGN_FACTORY_ADDRESS) ??
    process.env.CAMPAIGN_VAULT_FACTORY_ADDRESS;
  return raw ? safeAddr(raw) : null;
}

/** The Sage operator address the vault is configured with (PUBLIC address — no key needed). */
function operatorConfiguredAddress(chainId: number): Address | null {
  // Prefer the public operator address (no key required to preview/configure). The attach-
  // time agreement check independently confirms the on-chain operator equals Sage's real
  // signer, so a wrong value here fails closed at attachment.
  const raw = chainId === 2345 ? process.env.GOAT_OPERATOR_ADDRESS : process.env.NEXT_PUBLIC_OPERATOR_ADDRESS;
  return raw ? safeAddr(raw) : null;
}

function tokenAddress(chainId: number): Address | null {
  const cfg = chainConfig(chainId);
  return cfg.usdcAddress ? safeAddr(cfg.usdcAddress) : null;
}

function safeAddr(a: string): Address | null {
  try {
    return getAddress(a);
  } catch {
    return null;
  }
}

/** The server-owned chain configuration the client may never override. */
export function launchChainConfig(chainId: number = LAUNCH_CHAIN_ID): LaunchChainConfig {
  const factory = factoryAddress(chainId);
  const token = tokenAddress(chainId);
  const operator = operatorConfiguredAddress(chainId);
  const missing: string[] = [];
  if (!factory) missing.push("factory");
  if (!token) missing.push("token");
  if (!operator) missing.push("operator");
  return { chainId, factory, token, operator, configured: missing.length === 0, missing };
}

export interface LoadedPlan {
  plan: DeploymentReadyPlan;
  revisionId: string;
  revisionNumber: number;
  model: string | null;
  provider: string | null;
}

/**
 * Load the APPROVED plan for an inspection, recomputing every canonical hash + exact
 * budget from the plan's own missions (never trusting the stored snapshot). Returns null
 * if there is no current approved revision or the recomputation fails.
 */
export function loadApprovedPlan(jobId: string): LoadedPlan | null {
  const job = getInspectionJob(jobId);
  if (!job) return null;
  const approved = getApprovedRevision(jobId);
  if (!approved) return null;
  const verified = verifyPlanForApproval(deserializePlan(approved.planJson), {
    approver: approved.approverWallet ?? "anonymous",
    model: approved.model,
    provider: approved.provider,
    promptVersion: MISSION_PROMPT_VERSION,
  });
  if (!verified.ok) return null;
  return {
    plan: verified.deploymentReadyPlan,
    revisionId: approved.id,
    revisionNumber: approved.revisionNumber,
    model: approved.model,
    provider: approved.provider,
  };
}

/** The founder-chosen limits (validated). Addresses that control money are NOT here. */
export interface FounderLimits {
  owner: Address; // the founder wallet (claimed)
  guardian: Address;
  dailyVelocityCapBase: bigint;
  durationSeconds: bigint;
}

export const MIN_DURATION_SECONDS = BigInt(24 * 60 * 60); // 1 day
export const MAX_DURATION_SECONDS = BigInt(90 * 24 * 60 * 60); // 90 days
export const DEFAULT_DURATION_SECONDS = BigInt(14 * 24 * 60 * 60); // 14 days

export type SettingsResult =
  | { ok: true; settings: DeploymentSettings }
  | { ok: false; errors: string[] };

/**
 * Build + validate the full DeploymentSettings from the founder limits + the approved plan
 * + server chain config. Every guard the vault + machine assume is enforced here: owner ≠
 * operator, guardian ≠ operator, daily cap within [largest reward, budget], duration in
 * bounds. The factory/token/operator come from server config, never the client.
 */
export function buildSettings(plan: DeploymentReadyPlan, limits: FounderLimits, chainId: number = LAUNCH_CHAIN_ID): SettingsResult {
  const cfg = launchChainConfig(chainId);
  const errors: string[] = [];
  if (!cfg.configured) errors.push(`chain_not_configured:${cfg.missing.join(",")}`);

  const inputs = deriveDeploymentInputs(plan);
  const budget = inputs.totalBudgetBase;
  const largest = inputs.largestRewardBase;

  if (cfg.operator && limits.owner.toLowerCase() === cfg.operator.toLowerCase()) errors.push("owner_equals_operator");
  if (cfg.operator && limits.guardian.toLowerCase() === cfg.operator.toLowerCase()) errors.push("guardian_equals_operator");
  if (limits.dailyVelocityCapBase < largest) errors.push("daily_cap_below_largest_reward");
  if (limits.dailyVelocityCapBase > budget) errors.push("daily_cap_above_budget");
  if (limits.durationSeconds < MIN_DURATION_SECONDS) errors.push("duration_too_short");
  if (limits.durationSeconds > MAX_DURATION_SECONDS) errors.push("duration_too_long");

  if (errors.length || !cfg.factory || !cfg.token || !cfg.operator) return { ok: false, errors };

  return {
    ok: true,
    settings: {
      chainId,
      factory: cfg.factory,
      owner: getAddress(limits.owner),
      operator: cfg.operator,
      guardian: getAddress(limits.guardian),
      token: cfg.token,
      dailyVelocityCap: limits.dailyVelocityCapBase,
      durationSeconds: limits.durationSeconds,
    },
  };
}

/** A safe default daily cap: the whole budget (founder can lower it). */
export function defaultDailyCap(plan: DeploymentReadyPlan): bigint {
  return deriveDeploymentInputs(plan).totalBudgetBase;
}

/**
 * Rebuild the plan-bound bundle from a stored deployment's settings + the approved plan,
 * and assert it still matches (fail-closed if the approved plan diverged since prepare).
 */
export function bundleForDeployment(deployment: Deployment, plan: DeploymentReadyPlan): { ok: true; bundle: DeployPlanBundle } | { ok: false; reason: string } {
  const settings = deployment.settings as DeploymentSettings;
  // rehydrate bigints (JSON stored them as strings).
  const rehydrated: DeploymentSettings = {
    ...settings,
    dailyVelocityCap: BigInt(settings.dailyVelocityCap as unknown as string),
    durationSeconds: BigInt(settings.durationSeconds as unknown as string),
  };
  let bundle: DeployPlanBundle;
  try {
    bundle = buildDeployBundle(plan, rehydrated);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "bundle_build_failed" };
  }
  if (bundle.calldataDigest !== deployment.calldataDigest) return { ok: false, reason: "calldata_diverged_from_prepared" };
  if (bundle.predictedVault.toLowerCase() !== deployment.predictedVault.toLowerCase()) return { ok: false, reason: "predicted_vault_diverged" };
  return { ok: true, bundle };
}

/** Serialize DeploymentSettings for durable storage (bigints → strings). */
export function serializeSettings(s: DeploymentSettings): unknown {
  return { ...s, dailyVelocityCap: s.dailyVelocityCap.toString(), durationSeconds: s.durationSeconds.toString() };
}
