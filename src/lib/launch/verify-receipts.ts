import "server-only";

/**
 * Server-side receipt + chain-state verification for each deployment step. The server
 * NEVER trusts a client "success": after the founder's wallet broadcasts a step, the
 * server independently reads the receipt and the resulting on-chain state and only then
 * advances the durable machine. Any mismatch — wrong chain, wrong factory, a deployed
 * vault whose owner/operator/token/hashes/rewards/caps/budget disagree with the approved
 * plan, an allowance/balance that doesn't cover the budget, a vault that isn't active —
 * routes the deployment to `recovery_required` and NEVER to `live`.
 *
 * Chain access is behind a {@link ChainVerifier} seam: the real verifier uses the V2
 * adapter + a viem public client; a deterministic fake (SAGE_E2E only) derives the state
 * from the durable deployment row so the browser E2E can drive the real routes + real
 * verification logic without broadcasting to a chain.
 */

import { erc20Abi, getAddress, parseEventLogs, type Address, type Hex } from "viem";

import { publicClient } from "@/lib/deputy/chain";
import { realCampaignVaultAdapter, campaignVaultFactoryAbi, type CampaignVaultAdapter } from "@/lib/deputy/campaign-vault";
import type { ChainCampaignSnapshot } from "@/lib/campaigns/vault-agreement";
import type { Deployment } from "@/lib/db/schema";
import type { DeploymentReadyPlan } from "./approve";
import { deriveDeploymentInputs, type DeploymentSettings } from "./deploy-plan";

export interface CreateReceiptRead {
  ok: boolean;
  reason?: string;
  emittedVault?: Address;
}

/** The chain reads receipt-verification needs, injectable for the E2E fake. */
export interface ChainVerifier {
  /** Read a create receipt: success, sent to the factory, and the emitted vault address. */
  readCreatedVault(txHash: Hex, chainId: number, factory: Address): Promise<CreateReceiptRead>;
  /** The full agreement snapshot for a vault. */
  readSnapshot(vault: Address, chainId: number, missionIds: Hex[]): Promise<ChainCampaignSnapshot>;
  /** owner→spender ERC-20 allowance (base units). */
  readAllowance(token: Address, owner: Address, spender: Address, chainId: number): Promise<bigint>;
  /** ERC-20 balance of an address (base units). */
  readBalance(token: Address, holder: Address, chainId: number): Promise<bigint>;
  /** Whether a plain receipt succeeded (used for approve/fund, which have no vault event). */
  receiptSucceeded(txHash: Hex, chainId: number): Promise<boolean>;
}

/* ─────────────────────────────────────────────── the real verifier ──────── */

export function realChainVerifier(adapter: CampaignVaultAdapter = realCampaignVaultAdapter): ChainVerifier {
  return {
    async readCreatedVault(txHash, chainId, factory) {
      const client = publicClient(chainId);
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") return { ok: false, reason: "create_reverted" };
      if (receipt.to && getAddress(receipt.to) !== getAddress(factory)) return { ok: false, reason: "create_not_sent_to_factory" };
      const ours = receipt.logs.filter((l) => getAddress(l.address) === getAddress(factory));
      const events = parseEventLogs({ abi: campaignVaultFactoryAbi, logs: ours, eventName: "CampaignVaultCreated" });
      const ev = events[0] as { args?: { vault?: Address } } | undefined;
      if (!ev?.args?.vault) return { ok: false, reason: "no_vault_created_event" };
      return { ok: true, emittedVault: getAddress(ev.args.vault) };
    },
    readSnapshot: (vault, chainId, missionIds) => adapter.readSnapshot(vault, chainId, missionIds),
    async readAllowance(token, owner, spender, chainId) {
      return publicClient(chainId).readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }) as Promise<bigint>;
    },
    async readBalance(token, holder, chainId) {
      return publicClient(chainId).readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] }) as Promise<bigint>;
    },
    async receiptSucceeded(txHash, chainId) {
      const r = await publicClient(chainId).waitForTransactionReceipt({ hash: txHash });
      return r.status === "success";
    },
  };
}

/* ───────────────────────────────── the deterministic E2E fake verifier ──── */

/**
 * A deterministic chain the browser E2E can drive without broadcasting. It derives every
 * read from the durable deployment row: a create yields the row's predicted vault with a
 * plan-consistent snapshot; an approve grants exactly the budget allowance; a fund gives
 * the vault exactly the budget balance; an activate flips the state to active. Presence of
 * each write-once tx hash on the row is the source of truth. ONLY used when SAGE_E2E === 1.
 */
export function fakeChainVerifier(deployment: Deployment, plan: DeploymentReadyPlan, settings: DeploymentSettings): ChainVerifier {
  const inputs = deriveDeploymentInputs(plan);
  const budget = inputs.totalBudgetBase;
  const predicted = getAddress(deployment.predictedVault);
  function snapshotState(): ChainCampaignSnapshot["state"] {
    if (deployment.activateTx) return "active";
    if (deployment.fundTx) return "funded";
    return "created";
  }
  const missions: ChainCampaignSnapshot["missions"] = {};
  inputs.missionIds.forEach((m, i) => {
    missions[m.toLowerCase()] = { exists: true, rewardBase: inputs.rewards[i], maxCompletions: inputs.maxCompletions[i] };
  });
  return {
    async readCreatedVault(txHash) {
      return txHash && txHash.length > 2 ? { ok: true, emittedVault: predicted } : { ok: false, reason: "no_tx" };
    },
    async readSnapshot() {
      return {
        factoryRecognizes: true,
        owner: getAddress(settings.owner),
        operator: getAddress(settings.operator),
        guardian: getAddress(settings.guardian),
        token: getAddress(settings.token),
        campaignIdHash: plan.campaignIdHash,
        missionPlanDigest: plan.missionPlanDigest,
        budgetCeiling: budget,
        chainId: settings.chainId,
        state: snapshotState(),
        replaySupport: "supported",
        missions,
      };
    },
    async readAllowance() {
      return deployment.approveTx ? budget : BigInt(0);
    },
    async readBalance() {
      return deployment.fundTx ? budget : BigInt(0);
    },
    async receiptSucceeded() {
      return true;
    },
  };
}

/** Select the verifier: the deterministic fake under SAGE_E2E, else the real one. */
export function deploymentChainVerifier(deployment: Deployment, plan: DeploymentReadyPlan, settings: DeploymentSettings): ChainVerifier {
  if (process.env.SAGE_E2E === "1") return fakeChainVerifier(deployment, plan, settings);
  return realChainVerifier();
}

/* ─────────────────────────────── attach chain seam (E2E only) ────────────── */

/**
 * A CampaignVaultAdapter that only implements `readSnapshot` (the sole method the atomic
 * attach uses), returning the plan-consistent snapshot. Used ONLY under SAGE_E2E so the
 * real attach path (agreement + public-identity + atomic persist) runs end-to-end without
 * a chain. Every other adapter method throws — attach never calls them.
 */
export function fakeAttachAdapter(deployment: Deployment, plan: DeploymentReadyPlan, settings: DeploymentSettings): CampaignVaultAdapter {
  const verifier = fakeChainVerifier(deployment, plan, settings);
  const notUsed = () => {
    throw new Error("fake adapter: only readSnapshot is used by attach");
  };
  return {
    readSnapshot: (vault, chainId, missionIds) => verifier.readSnapshot(vault, chainId, missionIds),
    requestPayout: notUsed as CampaignVaultAdapter["requestPayout"],
    awaitOutcome: notUsed as CampaignVaultAdapter["awaitOutcome"],
    readMissionReadiness: notUsed as CampaignVaultAdapter["readMissionReadiness"],
    isIntentUsed: notUsed as CampaignVaultAdapter["isIntentUsed"],
    findAllOutcomesByIntent: notUsed as CampaignVaultAdapter["findAllOutcomesByIntent"],
    getSenderNonce: notUsed as CampaignVaultAdapter["getSenderNonce"],
  };
}

/** V2 attach deps: real adapter + real operator normally; the fake adapter under SAGE_E2E. */
export function deploymentAttachDeps(deployment: Deployment, plan: DeploymentReadyPlan, settings: DeploymentSettings) {
  if (process.env.SAGE_E2E === "1") {
    return { adapter: fakeAttachAdapter(deployment, plan, settings), operatorAddress: () => getAddress(settings.operator) };
  }
  return {};
}

/* ───────────────────────────────────────────── per-step verification ────── */

export type StepVerdict = { ok: true; deployedVault?: Address } | { ok: false; reason: string };

/**
 * Verify a create receipt + the deployed vault against the approved plan. Confirms the
 * emitted vault equals the CREATE2 prediction AND the on-chain snapshot's identity, owner,
 * operator, token, per-mission rewards/caps, and budget all match the plan. Any mismatch
 * fails (the caller routes to recovery_required).
 */
export async function verifyCreate(
  deployment: Deployment,
  plan: DeploymentReadyPlan,
  settings: DeploymentSettings,
  verifier: ChainVerifier,
): Promise<StepVerdict> {
  const txHash = deployment.createTx as Hex | null;
  if (!txHash) return { ok: false, reason: "no_create_tx" };
  const created = await verifier.readCreatedVault(txHash, settings.chainId, settings.factory);
  if (!created.ok || !created.emittedVault) return { ok: false, reason: created.reason ?? "create_unverified" };
  if (created.emittedVault.toLowerCase() !== deployment.predictedVault.toLowerCase()) {
    return { ok: false, reason: "emitted_vault_ne_predicted" };
  }

  const inputs = deriveDeploymentInputs(plan);
  let snap: ChainCampaignSnapshot;
  try {
    snap = await verifier.readSnapshot(created.emittedVault, settings.chainId, inputs.missionIds);
  } catch {
    return { ok: false, reason: "vault_unreadable" };
  }
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (snap.chainId !== settings.chainId) return { ok: false, reason: "wrong_chain" };
  if (!snap.factoryRecognizes) return { ok: false, reason: "factory_does_not_recognize_vault" };
  if (!eq(snap.owner, settings.owner)) return { ok: false, reason: "owner_mismatch" };
  if (!eq(snap.operator, settings.operator)) return { ok: false, reason: "operator_mismatch" };
  if (!eq(snap.guardian, settings.guardian)) return { ok: false, reason: "guardian_mismatch" };
  if (!eq(snap.token, settings.token)) return { ok: false, reason: "token_mismatch" };
  if (!eq(snap.campaignIdHash, plan.campaignIdHash)) return { ok: false, reason: "campaign_id_hash_mismatch" };
  if (!eq(snap.missionPlanDigest, plan.missionPlanDigest)) return { ok: false, reason: "mission_plan_digest_mismatch" };
  if (snap.budgetCeiling !== inputs.totalBudgetBase) return { ok: false, reason: "budget_ceiling_mismatch" };
  for (let i = 0; i < inputs.missionIds.length; i++) {
    const m = snap.missions[inputs.missionIds[i].toLowerCase()];
    if (!m || !m.exists) return { ok: false, reason: `mission_missing:${inputs.missionIds[i].slice(0, 10)}` };
    if (m.rewardBase !== inputs.rewards[i]) return { ok: false, reason: "mission_reward_mismatch" };
    if (m.maxCompletions !== inputs.maxCompletions[i]) return { ok: false, reason: "mission_cap_mismatch" };
  }
  return { ok: true, deployedVault: created.emittedVault };
}

/**
 * Wait for a step's broadcast tx to mine + succeed before reading the resulting chain
 * state. Without this, a confirm can read stale state (e.g. allowance still 0) because the
 * tx is still in the mempool — the exact real-chain failure the fake E2E chain masked.
 * A thrown error here is TRANSIENT (still settling), surfaced distinctly from a revert.
 */
async function awaitStepReceipt(txHash: string | null, chainId: number, verifier: ChainVerifier): Promise<{ mined: true; ok: boolean } | { mined: false }> {
  if (!txHash) return { mined: true, ok: true }; // nothing broadcast yet — nothing to wait on
  const ok = await verifier.receiptSucceeded(txHash as Hex, chainId);
  return { mined: true, ok };
}

/** Verify the exact-budget approval: the vault's allowance from the owner covers the budget. */
export async function verifyApprove(
  deployment: Deployment,
  plan: DeploymentReadyPlan,
  settings: DeploymentSettings,
  verifier: ChainVerifier,
): Promise<StepVerdict> {
  const r = await awaitStepReceipt(deployment.approveTx, settings.chainId, verifier);
  if (r.mined && !r.ok) return { ok: false, reason: "approve_reverted" };
  const vault = getAddress((deployment.deployedVault ?? deployment.predictedVault) as string);
  const budget = deriveDeploymentInputs(plan).totalBudgetBase;
  const allowance = await verifier.readAllowance(settings.token, getAddress(settings.owner), vault, settings.chainId);
  if (allowance < budget) return { ok: false, reason: "allowance_below_budget" };
  return { ok: true };
}

/** Verify funding: the vault's token balance covers the exact budget. */
export async function verifyFund(
  deployment: Deployment,
  plan: DeploymentReadyPlan,
  settings: DeploymentSettings,
  verifier: ChainVerifier,
): Promise<StepVerdict> {
  const r = await awaitStepReceipt(deployment.fundTx, settings.chainId, verifier);
  if (r.mined && !r.ok) return { ok: false, reason: "fund_reverted" };
  const vault = getAddress((deployment.deployedVault ?? deployment.predictedVault) as string);
  const budget = deriveDeploymentInputs(plan).totalBudgetBase;
  const balance = await verifier.readBalance(settings.token, vault, settings.chainId);
  if (balance < budget) return { ok: false, reason: "vault_balance_below_budget" };
  return { ok: true };
}

/** Verify activation: the vault reads `active` on-chain. */
export async function verifyActivate(
  deployment: Deployment,
  plan: DeploymentReadyPlan,
  settings: DeploymentSettings,
  verifier: ChainVerifier,
): Promise<StepVerdict> {
  const r = await awaitStepReceipt(deployment.activateTx, settings.chainId, verifier);
  if (r.mined && !r.ok) return { ok: false, reason: "activate_reverted" };
  const vault = getAddress((deployment.deployedVault ?? deployment.predictedVault) as string);
  const snap = await verifier.readSnapshot(vault, settings.chainId, deriveDeploymentInputs(plan).missionIds);
  if (snap.state !== "active") return { ok: false, reason: `vault_not_active:${snap.state}` };
  return { ok: true };
}
