import "server-only";

import { and, desc, eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { nowSeconds } from "./keys";
import { deployments, type Deployment } from "./schema";
import {
  transition,
  guardStepBroadcast,
  hasOnChainVault,
  STEP_OF_STATE,
  type DeploymentState,
  type DeployStep,
} from "@/lib/launch/deployment-machine";

/**
 * Durable deployment accessors — the refresh-safe wrapper over the pure deployment
 * machine. Every state change is an ATOMIC compare-and-set on the row's current state, so
 * two concurrent callers cannot both advance it. Per-step tx hashes are WRITE-ONCE
 * (a step that already recorded a hash is never re-broadcast), and once a vault exists
 * on-chain the row can only reach `recovery_required` or `live`, never a second deploy.
 * The server stores tx hashes + the founder's EIP-712 claim signature — never a key.
 */

const TX_COLUMN: Record<DeployStep, "createTx" | "approveTx" | "fundTx" | "activateTx"> = {
  create: "createTx",
  approve: "approveTx",
  fund: "fundTx",
  activate: "activateTx",
};

/** The state a step is broadcast FROM (its precondition). */
const PRECONDITION_OF_STEP: Record<DeployStep, DeploymentState> = {
  create: "preflight_ready",
  approve: "deployed",
  fund: "approved",
  activate: "funded",
};

export function getDeployment(id: string): Deployment | null {
  return db.select().from(deployments).where(eq(deployments.id, id)).get() ?? null;
}

/** The single active (non-terminal) deployment for a plan revision, if any. */
export function getActiveDeploymentForRevision(revisionId: string): Deployment | null {
  return (
    db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.revisionId, revisionId),
          // non-terminal: neither live nor failed.
          or(isNull(deployments.attachedCampaignId), eq(deployments.state, "recovery_required")),
        ),
      )
      .all()
      .find((d) => d.state !== "live" && d.state !== "failed") ?? null
  );
}

export function listDeploymentsForJob(jobId: string): Deployment[] {
  return db.select().from(deployments).where(eq(deployments.jobId, jobId)).orderBy(desc(deployments.createdAt)).all();
}

export interface CreateDeploymentInput {
  jobId: string;
  revisionId: string;
  revisionNumber: number;
  founderWallet: string;
  chainId: number;
  settings: unknown;
  campaignIdHash: string;
  missionPlanDigest: string;
  calldataDigest: string;
  totalBudgetBase: bigint;
  predictedVault: string;
}

/**
 * Create a deployment in `prepared`, OR return the existing active one for this revision
 * (idempotent — exactly one active deployment per plan revision). The row binds the
 * canonical identity + calldata digest so a resume can fail-closed if the approved plan
 * ever diverges from what this deployment was built for.
 */
export function createDeployment(input: CreateDeploymentInput): Deployment {
  const existing = getActiveDeploymentForRevision(input.revisionId);
  if (existing) return existing;
  const now = nowSeconds();
  const id = nanoid(16);
  db.insert(deployments)
    .values({
      id,
      jobId: input.jobId,
      revisionId: input.revisionId,
      revisionNumber: input.revisionNumber,
      founderWallet: input.founderWallet.toLowerCase(),
      chainId: input.chainId,
      state: "prepared",
      settings: input.settings,
      campaignIdHash: input.campaignIdHash,
      missionPlanDigest: input.missionPlanDigest,
      calldataDigest: input.calldataDigest,
      totalBudgetBase: Number(input.totalBudgetBase),
      predictedVault: input.predictedVault,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getDeployment(id) as Deployment;
}

/**
 * Atomically move a deployment from an EXPECTED current state to `to`, applying the pure
 * machine's rules (illegal edges + the no-`failed`-after-vault guard). The compare-and-set
 * on `state = expectedFrom` is the concurrency guard: a stale caller gets `ok:false`.
 * Optional `patch` sets columns in the same atomic write.
 */
function advance(
  id: string,
  to: DeploymentState,
  patch: Partial<Deployment> = {},
): { ok: boolean; reason?: string; deployment?: Deployment } {
  const current = getDeployment(id);
  if (!current) return { ok: false, reason: "no such deployment" };
  const from = current.state as DeploymentState;
  const t = transition(from, to);
  if (!t.ok) return { ok: false, reason: t.reason };
  if (from === to && Object.keys(patch).length === 0) return { ok: true, deployment: current }; // no-op
  const now = nowSeconds();
  const res = db
    .update(deployments)
    .set({ ...patch, state: to, updatedAt: now })
    .where(and(eq(deployments.id, id), eq(deployments.state, from))) // CAS: only if unchanged
    .run();
  if (res.changes === 0) return { ok: false, reason: "state changed concurrently — reload" };
  return { ok: true, deployment: getDeployment(id) as Deployment };
}

/**
 * Record the founder's verified EIP-712 claim (nonce single-use across ALL deployments)
 * and move prepared→claimed. The signature verification happens in the route BEFORE this;
 * here we enforce the nonce has never been used, then bind it durably.
 */
export function recordClaim(
  id: string,
  claim: { nonce: string; signature: string; founderWallet: string },
): { ok: boolean; reason?: string; deployment?: Deployment } {
  const nonceUsed = db.select({ id: deployments.id }).from(deployments).where(eq(deployments.claimNonce, claim.nonce)).get();
  if (nonceUsed && nonceUsed.id !== id) return { ok: false, reason: "claim nonce already used" };
  const dep = getDeployment(id);
  if (!dep) return { ok: false, reason: "no such deployment" };
  if (dep.founderWallet.toLowerCase() !== claim.founderWallet.toLowerCase()) {
    return { ok: false, reason: "claim wallet does not match this deployment's founder" };
  }
  return advance(id, "claimed", { claimNonce: claim.nonce, claimSignature: claim.signature });
}

export function markPreflightReady(id: string): { ok: boolean; reason?: string; deployment?: Deployment } {
  return advance(id, "preflight_ready");
}

/**
 * Record a step's broadcast tx hash WRITE-ONCE, moving the row into the step's `-ing`
 * state atomically. If the step already has a recorded hash, this NEVER overwrites it —
 * it returns `broadcast:false` with the existing hash so the caller polls instead of
 * resending. This is the structural no-blind-resend guarantee at the durable layer.
 */
export function recordStepBroadcast(
  id: string,
  step: DeployStep,
  txHash: string,
): { ok: boolean; broadcast: boolean; reason?: string; txHash?: string; deployment?: Deployment } {
  const dep = getDeployment(id);
  if (!dep) return { ok: false, broadcast: false, reason: "no such deployment" };
  const col = TX_COLUMN[step];
  const existing = dep[col] as string | null;

  // Already broadcast → return the recorded hash; do NOT send again.
  if (existing && existing.length > 0) {
    return { ok: true, broadcast: false, txHash: existing, deployment: dep };
  }
  // Must be at the step's precondition state, and the pure guard must permit it.
  const ingState = Object.entries(STEP_OF_STATE).find(([, s]) => s === step)?.[0] as DeploymentState | undefined;
  if (!ingState) return { ok: false, broadcast: false, reason: `unknown step ${step}` };
  const g = guardStepBroadcast(ingState, step, existing);
  if (!g.broadcast) return { ok: false, broadcast: false, reason: g.reason };
  if ((dep.state as DeploymentState) !== PRECONDITION_OF_STEP[step]) {
    return { ok: false, broadcast: false, reason: `cannot broadcast ${step} from state ${dep.state}` };
  }
  const moved = advance(id, ingState, { [col]: txHash } as Partial<Deployment>);
  if (!moved.ok) return { ok: false, broadcast: false, reason: moved.reason };
  return { ok: true, broadcast: true, txHash, deployment: moved.deployment };
}

/**
 * Confirm a step's receipt, advancing `-ing → -ed`. For `create` the caller passes the
 * REAL emitted vault address, which MUST equal the CREATE2 prediction — otherwise the
 * deployment goes to recovery_required (a mismatched vault must never become live).
 */
export function confirmStep(
  id: string,
  step: DeployStep,
  opts: { deployedVault?: string } = {},
): { ok: boolean; reason?: string; deployment?: Deployment } {
  const confirmTo: Record<DeployStep, DeploymentState> = {
    create: "deployed",
    approve: "approved",
    fund: "funded",
    activate: "active",
  };
  if (step === "create") {
    const dep = getDeployment(id);
    if (!dep) return { ok: false, reason: "no such deployment" };
    if (!opts.deployedVault) return { ok: false, reason: "create confirmation requires the emitted vault address" };
    if (opts.deployedVault.toLowerCase() !== dep.predictedVault.toLowerCase()) {
      // the deployed vault is not the predicted one — bind the anomaly + require recovery.
      markRecoveryRequired(id, "deployed vault does not match the CREATE2 prediction");
      return { ok: false, reason: "deployed vault ≠ predicted — routed to recovery_required" };
    }
    return advance(id, "deployed", { deployedVault: opts.deployedVault });
  }
  return advance(id, confirmTo[step]);
}

/** Begin the atomic attach (active→attaching). */
export function beginAttach(id: string): { ok: boolean; reason?: string; deployment?: Deployment } {
  return advance(id, "attaching");
}

/** Complete the attach (attaching→live) once the campaign row exists + is verified. */
export function markLive(id: string, campaignId: string): { ok: boolean; reason?: string; deployment?: Deployment } {
  return advance(id, "live", { attachedCampaignId: campaignId });
}

/**
 * Route to recovery_required from any post-vault state. Idempotent. This is the ONLY
 * destination for a stalled deployment that already created/funded a vault — the machine
 * makes redeploying from here structurally impossible.
 */
export function markRecoveryRequired(id: string, reason: string): { ok: boolean; reason?: string; deployment?: Deployment } {
  const dep = getDeployment(id);
  if (!dep) return { ok: false, reason: "no such deployment" };
  if (dep.state === "recovery_required") return { ok: true, deployment: dep };
  return advance(id, "recovery_required", { failureReason: reason.slice(0, 300) });
}

/**
 * Fail a deployment. Refused (routed to recovery_required instead) if a vault already
 * exists on-chain — a funded vault must be recovered, never abandoned as "failed".
 */
export function markFailed(id: string, reason: string): { ok: boolean; reason?: string; deployment?: Deployment } {
  const dep = getDeployment(id);
  if (!dep) return { ok: false, reason: "no such deployment" };
  if (hasOnChainVault(dep.state as DeploymentState)) {
    return markRecoveryRequired(id, reason);
  }
  return advance(id, "failed", { failureReason: reason.slice(0, 300) });
}
