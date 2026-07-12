import "server-only";

/**
 * Deterministic deployment construction. Given an approved DeploymentReadyPlan + the
 * founder's chosen limits, this predicts the CREATE2 vault address and builds the EXACT
 * transaction call set (create → approve → fund → activate). There is NO caller-
 * controlled divergence between the approved plan and the calldata: every array is
 * derived from the plan in its canonical order, the amounts are exactly the approved
 * budget, and the token approval is EXACT (never unlimited). The founder's wallet signs
 * these; the server never holds a key. Pure derivation (no chain writes).
 */

import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";

// Runtime-imported Foundry artifacts (same pattern the V2 adapter uses).
import campaignVaultArtifact from "../../../contracts/out/CampaignVault.sol/CampaignVault.json";
import campaignVaultFactoryArtifact from "../../../contracts/out/CampaignVaultFactory.sol/CampaignVaultFactory.json";
import type { DeploymentReadyPlan } from "./approve";

const factoryAbi = campaignVaultFactoryArtifact.abi as unknown as Abi;
const vaultAbi = campaignVaultArtifact.abi as unknown as Abi;
const VAULT_BYTECODE = ((): Hex => {
  const o = (campaignVaultArtifact as { bytecode: { object: string } }).bytecode.object;
  return (o.startsWith("0x") ? o : `0x${o}`) as Hex;
})();

const ERC20_APPROVE_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/** The founder-chosen campaign limits (validated by the caller). */
export interface DeploymentSettings {
  chainId: number;
  factory: Address;
  owner: Address; // the founder's wallet (msg.sender / vault owner)
  operator: Address;
  guardian: Address;
  token: Address;
  /** the 24h velocity cap in base units (≥ the largest single mission reward). */
  dailyVelocityCap: bigint;
  /** the campaign duration in seconds. */
  durationSeconds: bigint;
}

/** The exact economic inputs derived from the plan (canonical order — never re-sorted). */
export interface DeploymentInputs {
  campaignIdHash: Hex;
  missionIds: Hex[];
  rewards: bigint[];
  maxCompletions: bigint[];
  totalBudgetBase: bigint;
  largestRewardBase: bigint;
}

/** Derive the on-chain arrays from the approved plan, in the plan's canonical order. */
export function deriveDeploymentInputs(plan: DeploymentReadyPlan): DeploymentInputs {
  const rewards = plan.missions.map((m) => BigInt(m.rewardBase));
  const maxCompletions = plan.missions.map((m) => BigInt(m.maxCompletions));
  const totalBudgetBase = rewards.reduce((s, r, i) => s + r * maxCompletions[i], BigInt(0));
  return {
    campaignIdHash: plan.campaignIdHash,
    missionIds: plan.missions.map((m) => m.missionIdHash),
    rewards,
    maxCompletions,
    totalBudgetBase,
    largestRewardBase: rewards.reduce((mx, r) => (r > mx ? r : mx), BigInt(0)),
  };
}

const CTOR_ABI = [
  { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" },
  { type: "bytes32[]" }, { type: "uint256[]" }, { type: "uint256[]" }, { type: "uint256" }, { type: "uint256" },
] as const;

/**
 * Predict the CREATE2 vault address the factory will deploy. Salt =
 * keccak256(abi.encode(owner, campaignIdHash)); initcode = vault creation bytecode +
 * abi.encode(constructor args). Matches the deployed factory exactly (golden-tested).
 */
export function predictVaultAddress(inputs: DeploymentInputs, s: DeploymentSettings): Address {
  const owner = getAddress(s.owner);
  const salt = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, inputs.campaignIdHash]));
  const ctorArgs = encodeAbiParameters(CTOR_ABI, [
    owner, getAddress(s.operator), getAddress(s.guardian), getAddress(s.token), inputs.campaignIdHash,
    inputs.missionIds, inputs.rewards, inputs.maxCompletions, s.dailyVelocityCap, s.durationSeconds,
  ]);
  const bytecodeHash = keccak256(concatHex([VAULT_BYTECODE, ctorArgs]));
  return getContractAddress({ from: getAddress(s.factory), opcode: "CREATE2", salt, bytecodeHash });
}

export interface DeployCall {
  /** a stable step id for the durable state machine + UI. */
  step: "create" | "approve" | "fund" | "activate";
  to: Address;
  data: Hex;
  value: string; // "0" — no native value moves
  label: string;
}

export interface DeployPlanBundle {
  settings: DeploymentSettings;
  inputs: DeploymentInputs;
  predictedVault: Address;
  calls: DeployCall[];
  /** a digest of the whole plan-bound bundle, so client + server can compare cheaply. */
  calldataDigest: Hex;
}

/**
 * Build the exact ordered call set from the approved plan. Because the vault address is
 * a deterministic CREATE2 prediction, the token approval + funding target the predicted
 * address (verified against the emitted address after creation). The approval is EXACT
 * (never unlimited). Throws if the plan's economics are internally inconsistent.
 */
export function buildDeployBundle(plan: DeploymentReadyPlan, s: DeploymentSettings): DeployPlanBundle {
  const inputs = deriveDeploymentInputs(plan);
  if (inputs.totalBudgetBase !== BigInt(plan.totalBudgetBase)) {
    throw new Error("plan economics do not sum to the approved budget");
  }
  if (s.dailyVelocityCap < inputs.largestRewardBase) {
    throw new Error("daily limit is below the largest single mission reward");
  }
  const predictedVault = predictVaultAddress(inputs, s);

  const createData = encodeFunctionData({
    abi: factoryAbi, functionName: "createCampaignVault",
    args: [getAddress(s.operator), getAddress(s.guardian), getAddress(s.token), inputs.campaignIdHash, inputs.missionIds, inputs.rewards, inputs.maxCompletions, s.dailyVelocityCap, s.durationSeconds],
  });
  const approveData = encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [predictedVault, inputs.totalBudgetBase] });
  const fundData = encodeFunctionData({ abi: vaultAbi, functionName: "fund", args: [inputs.totalBudgetBase] });
  const activateData = encodeFunctionData({ abi: vaultAbi, functionName: "activate", args: [] });

  const calls: DeployCall[] = [
    { step: "create", to: getAddress(s.factory), data: createData, value: "0", label: "Create your campaign vault" },
    { step: "approve", to: getAddress(s.token), data: approveData, value: "0", label: "Approve the exact campaign budget" },
    { step: "fund", to: predictedVault, data: fundData, value: "0", label: "Fund the vault" },
    { step: "activate", to: predictedVault, data: activateData, value: "0", label: "Activate Sage as the operator" },
  ];
  const calldataDigest = keccak256(concatHex(calls.map((c) => c.data)));
  return { settings: s, inputs, predictedVault, calls, calldataDigest };
}

/**
 * Re-derive the bundle from the plan + settings and confirm it matches a client- or
 * previously-computed bundle byte-for-byte. THE no-divergence guarantee: signed calldata
 * must equal what the approved plan produces.
 */
export function assertBundleMatchesPlan(bundle: DeployPlanBundle, plan: DeploymentReadyPlan): { ok: boolean; reason?: string } {
  const rebuilt = buildDeployBundle(plan, bundle.settings);
  if (rebuilt.predictedVault !== bundle.predictedVault) return { ok: false, reason: "predicted_vault" };
  if (rebuilt.calldataDigest !== bundle.calldataDigest) return { ok: false, reason: "calldata" };
  if (rebuilt.inputs.totalBudgetBase !== bundle.inputs.totalBudgetBase) return { ok: false, reason: "budget" };
  return { ok: true };
}
