import "server-only";

/**
 * Shared server access for the deployment routes: load a deployment with its approved
 * plan + settings, enforce founder ownership on every route, and project the durable row
 * into a stable client view (+ the single "next action" the UI should take). All routes
 * go through this so ownership + the refresh-safe view are consistent and never duplicated.
 */

import { getDeployment } from "@/lib/db/deployments";
import { isSameWallet } from "@/lib/auth/session";
import { bundleForDeployment, loadApprovedPlan, type LoadedPlan } from "./deployment-service";
import { deriveDeploymentInputs, type DeploymentSettings, type DeployPlanBundle } from "./deploy-plan";
import { formatBase } from "./preview-core";
import { isTerminal, type DeployStep, type DeploymentState } from "./deployment-machine";
import type { Deployment } from "@/lib/db/schema";

export type DeploymentPhase = "claim" | "limits" | "execute" | "attach" | "live" | "recovery" | "failed";

export interface NextAction {
  phase: DeploymentPhase;
  step?: DeployStep;
  mode?: "broadcast" | "confirm";
}

/** Map the durable state to the single next thing the founder UI should do. */
export function deploymentNextAction(state: DeploymentState): NextAction {
  switch (state) {
    case "prepared": return { phase: "claim" };
    case "claimed": return { phase: "limits" };
    case "preflight_ready": return { phase: "execute", step: "create", mode: "broadcast" };
    case "deploying": return { phase: "execute", step: "create", mode: "confirm" };
    case "deployed": return { phase: "execute", step: "approve", mode: "broadcast" };
    case "approving": return { phase: "execute", step: "approve", mode: "confirm" };
    case "approved": return { phase: "execute", step: "fund", mode: "broadcast" };
    case "funding": return { phase: "execute", step: "fund", mode: "confirm" };
    case "funded": return { phase: "execute", step: "activate", mode: "broadcast" };
    case "activating": return { phase: "execute", step: "activate", mode: "confirm" };
    case "active": return { phase: "attach" };
    case "attaching": return { phase: "attach" };
    case "live": return { phase: "live" };
    case "recovery_required": return { phase: "recovery" };
    case "failed": return { phase: "failed" };
    default: return { phase: "recovery" };
  }
}

export interface DeploymentStepView {
  step: DeployStep;
  txHash: string | null;
  done: boolean;
}

export interface DeploymentView {
  id: string;
  jobId: string;
  state: DeploymentState;
  terminal: boolean;
  chainId: number;
  founder: string;
  predictedVault: string;
  deployedVault: string | null;
  attachedCampaignId: string | null;
  totalBudgetHuman: string;
  tokenDecimals: number;
  next: NextAction;
  steps: DeploymentStepView[];
  failureReason: string | null;
}

const STEP_ORDER: DeployStep[] = ["create", "approve", "fund", "activate"];
const STATE_RANK: DeploymentState[] = [
  "prepared", "claimed", "preflight_ready", "deploying", "deployed", "approving", "approved",
  "funding", "funded", "activating", "active", "attaching", "live",
];

/** Project a deployment row into the durable client view. */
export function deploymentView(deployment: Deployment, tokenDecimals: number): DeploymentView {
  const state = deployment.state as DeploymentState;
  const rank = STATE_RANK.indexOf(state);
  const doneThrough: Record<DeployStep, DeploymentState> = { create: "deployed", approve: "approved", fund: "funded", activate: "active" };
  const txOf: Record<DeployStep, string | null> = {
    create: deployment.createTx, approve: deployment.approveTx, fund: deployment.fundTx, activate: deployment.activateTx,
  };
  return {
    id: deployment.id,
    jobId: deployment.jobId,
    state,
    terminal: isTerminal(state),
    chainId: deployment.chainId,
    founder: deployment.founderWallet,
    predictedVault: deployment.predictedVault,
    deployedVault: deployment.deployedVault,
    attachedCampaignId: deployment.attachedCampaignId,
    totalBudgetHuman: formatBase(BigInt(deployment.totalBudgetBase), tokenDecimals),
    tokenDecimals,
    next: deploymentNextAction(state),
    steps: STEP_ORDER.map((step) => ({
      step,
      txHash: txOf[step],
      // a step is "done" once the state has advanced to at least its confirmed state,
      // OR (for live) everything is done.
      done: state === "live" || (rank >= 0 && rank >= STATE_RANK.indexOf(doneThrough[step])),
    })),
    failureReason: deployment.failureReason,
  };
}

export interface DeploymentContext {
  deployment: Deployment;
  loaded: LoadedPlan;
  settings: DeploymentSettings;
  bundle: DeployPlanBundle;
  tokenDecimals: number;
}

/** The exact server-built calldata per step — the wallet SENDS this (never client-built). */
export interface StepCall {
  step: DeployStep;
  to: string;
  data: string;
  value: string;
  label: string;
}

export function deploymentCalls(ctx: DeploymentContext): StepCall[] {
  return ctx.bundle.calls.map((c) => ({ step: c.step, to: c.to, data: c.data, value: c.value, label: c.label }));
}

export type AccessResult =
  | { ok: true; ctx: DeploymentContext }
  | { ok: false; status: number; error: string };

/**
 * Load a deployment for a session, enforcing founder ownership, and rehydrate its approved
 * plan + settings. Returns a 403 unless the session wallet is the deployment's founder.
 */
export function loadDeploymentForSession(deploymentId: string, sessionWallet: string | null): AccessResult {
  const deployment = getDeployment(deploymentId);
  if (!deployment) return { ok: false, status: 404, error: "Deployment not found." };
  if (!sessionWallet || !isSameWallet(sessionWallet, deployment.founderWallet)) {
    return { ok: false, status: 403, error: "This deployment belongs to another wallet." };
  }
  const loaded = loadApprovedPlan(deployment.jobId);
  if (!loaded) return { ok: false, status: 409, error: "The approved plan is no longer available. Reload." };
  const bundle = bundleForDeployment(deployment, loaded.plan);
  if (!bundle.ok) return { ok: false, status: 409, error: `Plan changed since preparation (${bundle.reason}).` };
  return {
    ok: true,
    ctx: {
      deployment,
      loaded,
      settings: bundle.bundle.settings,
      bundle: bundle.bundle,
      tokenDecimals: loaded.plan.tokenDecimals,
    },
  };
}

/** The exact base-unit budget for a plan (helper for routes). */
export function budgetBaseOf(loaded: LoadedPlan): bigint {
  return deriveDeploymentInputs(loaded.plan).totalBudgetBase;
}
