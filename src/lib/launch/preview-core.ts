/**
 * Pure deployment-preview assembly + the testnet faucet policy. Given the plan-bound
 * deploy bundle and the chain reads (founder balance, predicted-vault code size, current
 * allowance), this computes the founder-facing preview the UI shows BEFORE any signature:
 * exactly what will be deployed, whether the wallet can fund it, whether the vault already
 * exists (so a resume attaches instead of redeploying), and whether an approval is needed.
 *
 * Pure (no RPC, no DB) so every derived safety flag is unit-tested. The faucet policy is
 * here too, so "the testnet faucet is unreachable on mainnet" is a tested invariant, not a
 * UI accident.
 */

import type { Address, Hex } from "viem";
import type { DeployPlanBundle } from "./deploy-plan";

/** Format integer base units to a human decimal string without floating-point error. */
export function formatBase(base: bigint, decimals: number): string {
  const neg = base < BigInt(0);
  const v = neg ? -base : base;
  const d = BigInt(10) ** BigInt(decimals);
  const whole = v / d;
  const frac = v % d;
  if (frac === BigInt(0)) return `${neg ? "-" : ""}${whole.toString()}`;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}.${fracStr}`;
}

export interface PreviewChainReads {
  /** the founder wallet's settlement-token balance (base units). */
  founderBalanceBase: bigint;
  /** the bytecode size at the predicted vault address (>0 ⇒ it already exists). */
  predictedVaultCodeSize: number;
  /** the founder→predicted-vault token allowance already granted (base units). */
  currentAllowanceBase: bigint;
}

export interface DeploymentStepView {
  step: "create" | "approve" | "fund" | "activate";
  to: Address;
  label: string;
}

export interface DeploymentPreview {
  chainId: number;
  predictedVault: Address;
  token: Address;
  tokenDecimals: number;
  totalBudgetBase: string;
  totalBudgetHuman: string;
  missions: { title: string; rewardHuman: string; maxCompletions: string }[];
  steps: DeploymentStepView[];
  calldataDigest: Hex;
  campaignIdHash: Hex;
  missionPlanDigest: Hex;
  // chain-derived safety signals:
  founderBalanceHuman: string;
  sufficientBalance: boolean;
  shortfallHuman: string;
  vaultAlreadyExists: boolean;
  needsApproval: boolean;
  /** always true — the approve call encodes exactly the budget, never unlimited. */
  approvalIsExact: boolean;
}

/**
 * Assemble the founder-facing preview from the plan-bound bundle + injected chain reads.
 * The `missions`/`steps`/hashes come straight from the approved bundle (no divergence);
 * the safety flags are derived from the chain reads.
 */
export function assemblePreview(
  bundle: DeployPlanBundle,
  reads: PreviewChainReads,
  meta: { tokenDecimals: number; missionPlanDigest: Hex; missionTitles: { title: string; maxCompletions: string }[] },
): DeploymentPreview {
  const budget = bundle.inputs.totalBudgetBase;
  const shortfall = reads.founderBalanceBase >= budget ? BigInt(0) : budget - reads.founderBalanceBase;
  const missions = bundle.inputs.rewards.map((r, i) => ({
    title: meta.missionTitles[i]?.title ?? `Mission ${i + 1}`,
    rewardHuman: formatBase(r, meta.tokenDecimals),
    maxCompletions: meta.missionTitles[i]?.maxCompletions ?? bundle.inputs.maxCompletions[i].toString(),
  }));
  return {
    chainId: bundle.settings.chainId,
    predictedVault: bundle.predictedVault,
    token: bundle.settings.token,
    tokenDecimals: meta.tokenDecimals,
    totalBudgetBase: budget.toString(),
    totalBudgetHuman: formatBase(budget, meta.tokenDecimals),
    missions,
    steps: bundle.calls.map((c) => ({ step: c.step, to: c.to, label: c.label })),
    calldataDigest: bundle.calldataDigest,
    campaignIdHash: bundle.inputs.campaignIdHash,
    missionPlanDigest: meta.missionPlanDigest,
    founderBalanceHuman: formatBase(reads.founderBalanceBase, meta.tokenDecimals),
    sufficientBalance: reads.founderBalanceBase >= budget,
    shortfallHuman: formatBase(shortfall, meta.tokenDecimals),
    vaultAlreadyExists: reads.predictedVaultCodeSize > 0,
    needsApproval: reads.currentAllowanceBase < budget,
    approvalIsExact: true,
  };
}

// ── Testnet faucet policy ─────────────────────────────────────────────────────

export const FAUCET_CHAIN_ID = 59902; // Metis Sepolia — the ONLY chain a faucet exists on.

export type FaucetPolicy =
  | { available: true; chainId: number; token: Address }
  | { available: false; reason: string };

/**
 * Whether the testnet MockUSDC faucet may be offered. Available ONLY on Metis Sepolia
 * (59902) AND only for the exact configured MockUSDC address. On any mainnet, or for any
 * other token, it is unavailable — so the UI hides it and the route refuses it. This makes
 * "a mainnet faucet is unreachable" a structural, tested property.
 */
export function faucetPolicy(chainId: number, tokenAddress: string, configuredMockUsdc: string | null): FaucetPolicy {
  if (chainId !== FAUCET_CHAIN_ID) return { available: false, reason: "faucet is testnet-only (Metis Sepolia 59902)" };
  if (!configuredMockUsdc) return { available: false, reason: "no testnet faucet token is configured" };
  if (tokenAddress.toLowerCase() !== configuredMockUsdc.toLowerCase()) {
    return { available: false, reason: "faucet only mints the configured testnet MockUSDC" };
  }
  return { available: true, chainId, token: configuredMockUsdc as Address };
}

/** Throw unless the faucet is allowed for this chain + token. Used server-side before any mint. */
export function assertFaucetAllowed(chainId: number, tokenAddress: string, configuredMockUsdc: string | null): Address {
  const p = faucetPolicy(chainId, tokenAddress, configuredMockUsdc);
  if (!p.available) throw new Error(`faucet refused: ${p.reason}`);
  return p.token;
}
