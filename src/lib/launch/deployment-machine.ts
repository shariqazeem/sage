/**
 * The founder-vault deployment state machine — pure, so every transition is exhaustively
 * testable without a chain or a DB. It exists to make three properties structural rather
 * than hopeful:
 *
 *  1. REFRESH-SAFE — the state is a durable enum; a reload resumes from the recorded state
 *     instead of restarting.
 *  2. NO BLIND RESEND — each on-chain step (create/approve/fund/activate) records its tx
 *     hash exactly once; a step with a recorded hash is polled, never re-broadcast.
 *  3. NO REDEPLOY AFTER A VAULT EXISTS — once a real vault has been created + funded,
 *     ANY failure routes to `recovery_required`, whose ONLY exits are re-attaching or
 *     giving up. It can never fall back to deploying/funding a second vault.
 *
 * The DB accessor (db/deployments.ts) is a thin durable wrapper over this.
 */

export type DeploymentState =
  | "prepared" // the plan-bound bundle is built; awaiting the founder's claim
  | "claimed" // the founder wallet has signed the EIP-712 plan-claim
  | "preflight_ready" // preview computed, balances + no-existing-vault checked on-chain
  | "deploying" // create tx broadcast (createTx recorded)
  | "deployed" // create receipt confirmed; the real vault address is known
  | "approving" // exact-budget approve tx broadcast (approveTx recorded)
  | "approved" // approve receipt confirmed
  | "funding" // fund tx broadcast (fundTx recorded)
  | "funded" // fund receipt confirmed
  | "activating" // activate tx broadcast (activateTx recorded)
  | "active" // activate receipt confirmed; the vault reads active on-chain
  | "attaching" // atomically attaching the verified vault to a campaign row
  | "live" // TERMINAL success — the campaign is attached + visible
  | "recovery_required" // a vault exists but the flow stalled — repair the ATTACH, never redeploy
  | "failed"; // TERMINAL failure — nothing on-chain to recover (failed before a vault existed)

export const DEPLOYMENT_STATES: DeploymentState[] = [
  "prepared", "claimed", "preflight_ready", "deploying", "deployed", "approving", "approved",
  "funding", "funded", "activating", "active", "attaching", "live", "recovery_required", "failed",
];

/**
 * Legal transitions. The happy path walks straight down. `recovery_required` is reachable
 * from any post-vault state, and its exits are DELIBERATELY narrow: only finishing the
 * attach (`attaching`/`live`) or declaring `failed`. There is NO edge from
 * recovery_required back to any deploying/funding state — that is the no-second-vault rule.
 */
const LEGAL: Record<DeploymentState, readonly DeploymentState[]> = {
  prepared: ["claimed", "failed"],
  claimed: ["preflight_ready", "failed"],
  // before a vault exists, a clean abort is `failed` (nothing on-chain).
  preflight_ready: ["deploying", "failed"],
  deploying: ["deployed", "failed", "recovery_required"],
  // from here on a real vault may exist → post-vault failures go to recovery_required.
  deployed: ["approving", "recovery_required"],
  approving: ["approved", "recovery_required"],
  approved: ["funding", "recovery_required"],
  funding: ["funded", "recovery_required"],
  funded: ["activating", "recovery_required"],
  activating: ["active", "recovery_required"],
  active: ["attaching", "recovery_required"],
  attaching: ["live", "recovery_required"],
  live: [],
  recovery_required: ["attaching", "live", "failed"],
  failed: [],
};

/** Which on-chain step (if any) a state is responsible for having broadcast. */
export const STEP_OF_STATE: Partial<Record<DeploymentState, "create" | "approve" | "fund" | "activate">> = {
  deploying: "create",
  approving: "approve",
  funding: "fund",
  activating: "activate",
};

/** The ordered on-chain steps. Presence of a recorded tx hash = "already sent". */
export const DEPLOY_STEPS = ["create", "approve", "fund", "activate"] as const;
export type DeployStep = (typeof DEPLOY_STEPS)[number];

export function isTerminal(state: DeploymentState): boolean {
  return state === "live" || state === "failed";
}

/** True once a real vault may exist on-chain (so failures must recover, not redeploy). */
export function hasOnChainVault(state: DeploymentState): boolean {
  const i = DEPLOYMENT_STATES.indexOf(state);
  return i >= DEPLOYMENT_STATES.indexOf("deployed") && state !== "failed";
}

export function canTransition(from: DeploymentState, to: DeploymentState): boolean {
  return LEGAL[from].includes(to);
}

export type TransitionResult =
  | { ok: true; next: DeploymentState }
  | { ok: false; reason: string };

/**
 * Compute the next state, enforcing the legal edges AND the no-redeploy rule. If a vault
 * already exists on-chain, the only failure target permitted is `recovery_required` (never
 * `failed`, which implies "nothing to clean up", and never a second deploy).
 */
export function transition(from: DeploymentState, to: DeploymentState): TransitionResult {
  if (from === to) return { ok: true, next: to }; // idempotent no-op
  if (!canTransition(from, to)) {
    return { ok: false, reason: `illegal transition ${from} → ${to}` };
  }
  if (to === "failed" && hasOnChainVault(from)) {
    return { ok: false, reason: "a vault exists on-chain — must go to recovery_required, not failed" };
  }
  return { ok: true, next: to };
}

/**
 * Guard a step broadcast: a step may be broadcast only from its own state and only if it
 * has NOT already been recorded (write-once). Returns whether to broadcast; the caller
 * that gets `alreadyBroadcast` polls the existing hash instead of sending a new tx.
 */
export function guardStepBroadcast(
  state: DeploymentState,
  step: DeployStep,
  existingTx: string | null,
): { broadcast: boolean; reason?: string } {
  if (STEP_OF_STATE[state] !== step) {
    return { broadcast: false, reason: `step ${step} is not broadcast from state ${state}` };
  }
  if (existingTx && existingTx.length > 0) {
    return { broadcast: false, reason: "already broadcast — poll the recorded tx, do not resend" };
  }
  return { broadcast: true };
}
