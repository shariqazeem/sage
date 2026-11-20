import "server-only";

import { getAddress, parseAbi, type Address, type Hex } from "viem";

import { publicClient } from "@/lib/deputy/chain";
import { getInspectionJob } from "@/lib/db/inspection";
import { getCurrentRevision } from "@/lib/db/plan-revisions";
import { getCampaign } from "@/lib/db/campaigns";
import { roundForJob } from "@/lib/programmes/store";
import { autoApprove } from "@/lib/telegram/agent-wallet-tools";
import { launchAllowed } from "@/lib/plans/founder-plan";
import { verifyPlanForApproval } from "@/lib/launch/approve";
import { deserializePlan } from "@/lib/launch/serde";
import { MISSION_PROMPT_VERSION } from "@/lib/launch/mission-prompt";
import { buildDeployBundle } from "@/lib/launch/deploy-plan";
import { buildSettings, defaultDailyCap, DEFAULT_DURATION_SECONDS, launchClosedReason, loadApprovedPlan } from "@/lib/launch/deployment-service";
import { computeV2SetupPreview } from "@/lib/campaigns/v2-setup";
import { campaignSetupInput, recordDeployedVault } from "@/lib/privy/deploy-runner";
import { OWN_WALLET_CHAIN_ID, VAULT_STATES, type ExpectedVault, type VaultFacts, type VaultStateName } from "./plan";
import { prepareOwnWalletLaunch, recordOwnWalletLaunch, type OwnWalletDeps } from "./flow";

/**
 * The own-wallet door, wired to the real things: the same plan loader, settings, bundle builder, plan
 * limits and campaign recorder the account launch uses (`launchFromTreasury` → `deployCampaignViaPrivy`).
 * The one difference is who signs: `owner` and `guardian` are the session's own wallet, not a wallet Sage
 * signs for. Nothing here holds or uses a key.
 */

const FACTORY_ABI = parseAbi([
  "function getVaultOwner(address vault) view returns (address)",
  "function getVaultByCampaign(address owner, bytes32 campaignIdHash) view returns (address)",
]);
const VAULT_ABI = parseAbi([
  "function getState() view returns (uint8)",
  "function getOwner() view returns (address)",
  "function getOperator() view returns (address)",
  "function getGuardian() view returns (address)",
  "function getToken() view returns (address)",
  "function getCampaignIdHash() view returns (bytes32)",
  "function getBudgetCeiling() view returns (uint256)",
  "function getDailyVelocityCap() view returns (uint256)",
  "function getActivationTime() view returns (uint256)",
  "function getExpiryTime() view returns (uint256)",
  "function getSpendStats() view returns (uint256 totalSpent, uint256 budgetRemaining, uint256 payoutCount)",
  "function getMissionCount() view returns (uint256)",
  "function getMission(bytes32 missionId) view returns ((bool exists, uint256 rewardAmount, uint256 maxCompletions, uint256 paidCompletions))",
]);
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** The three reads this needs, so a fork's client and production's are the same thing to it. */
export interface VaultReader {
  getChainId(): Promise<number>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
}

const stateName = (raw: number): VaultStateName => VAULT_STATES[raw] ?? "revoked";

/**
 * READ THE VAULT FROM THE CHAIN, with the server's own node. Every field the judgment needs comes from a
 * contract call made here: the factory's registry (who created it, and for which campaign), the vault's
 * own immutables and lifecycle, each planned mission, and the token's balance for the vault. A vault with
 * no code answers `hasCode: false` and nothing else is asked of it.
 */
export async function readVaultFacts(client: VaultReader, expected: ExpectedVault): Promise<VaultFacts> {
  // These addresses are the server's own, compiled from the plan for an EVM chain, so checksumming is safe.
  const vault = getAddress(expected.vault);
  const factory = getAddress(expected.factory);
  const [chainId, code, factoryOwner, factoryCampaignVault] = await Promise.all([
    client.getChainId(),
    client.getCode({ address: vault }),
    client.readContract({ address: factory, abi: FACTORY_ABI, functionName: "getVaultOwner", args: [vault] }) as Promise<Address>,
    client.readContract({ address: factory, abi: FACTORY_ABI, functionName: "getVaultByCampaign", args: [getAddress(expected.owner), expected.campaignIdHash] }) as Promise<Address>,
  ]);
  if (!code || code === "0x") {
    return {
      chainId, hasCode: false, factoryOwner, factoryCampaignVault, owner: "", operator: "", guardian: "", token: "", campaignIdHash: "",
      budgetCeiling: BigInt(0), dailyVelocityCap: BigInt(0), durationSeconds: null, state: "created", balanceBase: BigInt(0), totalSpentBase: BigInt(0), missionCount: 0, missions: {},
    };
  }
  const v = <T,>(functionName: string, args?: readonly unknown[]): Promise<T> => client.readContract({ address: vault, abi: VAULT_ABI, functionName, args }) as Promise<T>;
  const [state, owner, operator, guardian, token, campaignIdHash, budgetCeiling, dailyVelocityCap, activation, expiry, spend, missionCount, missionViews, balanceBase] = await Promise.all([
    v<number>("getState"),
    v<Address>("getOwner"),
    v<Address>("getOperator"),
    v<Address>("getGuardian"),
    v<Address>("getToken"),
    v<Hex>("getCampaignIdHash"),
    v<bigint>("getBudgetCeiling"),
    v<bigint>("getDailyVelocityCap"),
    v<bigint>("getActivationTime"),
    v<bigint>("getExpiryTime"),
    v<readonly [bigint, bigint, bigint]>("getSpendStats"),
    v<bigint>("getMissionCount"),
    Promise.all(expected.missions.map((m) => v<{ exists: boolean; rewardAmount: bigint; maxCompletions: bigint }>("getMission", [m.missionIdHash]).then((mv) => [m.missionIdHash.toLowerCase(), mv] as const))),
    // the balance is asked of the token the PLAN names: a vault built on another token holds none of it
    client.readContract({ address: getAddress(expected.token), abi: ERC20_ABI, functionName: "balanceOf", args: [vault] }) as Promise<bigint>,
  ]);
  const missions: VaultFacts["missions"] = {};
  for (const [id, mv] of missionViews) missions[id] = { exists: mv.exists, rewardBase: mv.rewardAmount, maxCompletions: mv.maxCompletions };
  return {
    chainId,
    hasCode: true,
    factoryOwner,
    factoryCampaignVault,
    owner,
    operator,
    guardian,
    token,
    campaignIdHash,
    budgetCeiling,
    dailyVelocityCap,
    durationSeconds: activation > BigInt(0) ? expiry - activation : null,
    state: stateName(Number(state)),
    balanceBase,
    totalSpentBase: spend[0],
    missionCount: Number(missionCount),
    missions,
  };
}

/** The vault's lifecycle, or null when nothing is deployed at the address. */
export async function readVaultState(client: VaultReader, vault: Address): Promise<VaultStateName | null> {
  const code = await client.getCode({ address: vault });
  if (!code || code === "0x") return null;
  return stateName(Number(await client.readContract({ address: vault, abi: VAULT_ABI, functionName: "getState" })));
}

const reader = (chainId: number): VaultReader => publicClient(chainId) as unknown as VaultReader;

export const realOwnWalletDeps: OwnWalletDeps = {
  closedReason: launchClosedReason,
  job: (jobId) => getInspectionJob(jobId),
  isWeeklyRound: (jobId) => roundForJob(jobId) !== null,
  currentRevision: (jobId) => getCurrentRevision(jobId)?.revisionNumber ?? null,
  approve: (jobId, founder) => autoApprove(jobId, getAddress(founder)),
  approvedPlan: loadApprovedPlan,
  draftPlan: (jobId, founder) => {
    const job = getInspectionJob(jobId);
    const current = getCurrentRevision(jobId);
    if (!job || job.status !== "ready" || !current) return null;
    const verified = verifyPlanForApproval(deserializePlan(current.planJson), { approver: founder, model: current.model, provider: current.provider, promptVersion: MISSION_PROMPT_VERSION });
    return verified.ok ? verified.deploymentReadyPlan : null;
  },
  launchAllowed: (founder, budgetBase) => {
    const r = launchAllowed(founder, budgetBase);
    return r.ok ? { ok: true } : { ok: false, message: r.message, upgradeTo: r.upgradeTo };
  },
  // The account launch's settings exactly (deploy-runner `settingsFor`): the whole budget as the daily
  // cap, 14 days. The wallet that signs owns the vault and is its guardian.
  settings: (plan, owner) =>
    buildSettings(plan, { owner: getAddress(owner), guardian: getAddress(owner), dailyVelocityCapBase: defaultDailyCap(plan), durationSeconds: DEFAULT_DURATION_SECONDS }, OWN_WALLET_CHAIN_ID),
  bundle: buildDeployBundle,
  recordErrors: (owner, loaded, jobId, settings, vault) => {
    const preview = computeV2SetupPreview(campaignSetupInput(getAddress(owner), loaded, jobId, settings, getAddress(vault)));
    return preview.ok ? [] : preview.errors;
  },
  liveCampaign: (publicCampaignId) => {
    const c = getCampaign(publicCampaignId);
    return c ? { id: c.id, vaultAddress: c.vaultAddress, posterWallet: c.posterWallet } : null;
  },
  vaultState: (chainId, vault) => readVaultState(reader(chainId), vault),
  facts: (expected) => readVaultFacts(reader(expected.chainId), expected),
  record: (owner, loaded, jobId, settings, vault) =>
    recordDeployedVault(campaignSetupInput(getAddress(owner), loaded, jobId, settings, getAddress(vault)), jobId, getAddress(vault), settings.chainId),
};

export const prepareOwnWallet = (founder: string, jobId: string, opts: Parameters<typeof prepareOwnWalletLaunch>[2]) => prepareOwnWalletLaunch(founder, jobId, opts, realOwnWalletDeps);
export const recordOwnWallet = (founder: string, jobId: string, opts: Parameters<typeof recordOwnWalletLaunch>[2]) => recordOwnWalletLaunch(founder, jobId, opts, realOwnWalletDeps);
