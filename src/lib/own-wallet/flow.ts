import { sameFounder } from "@/lib/auth/founder";
import { sameChainAddress } from "@/lib/campaigns/chain-address";
import type { DeploymentReadyPlan } from "@/lib/launch/approve";
import type { DeployPlanBundle, DeploymentSettings } from "@/lib/launch/deploy-plan";
import type { LoadedPlan, SettingsResult } from "@/lib/launch/deployment-service";
import type { PlanId } from "@/lib/plans/catalog";
import {
  OWN_WALLET_CHAIN_ID,
  OWN_WALLET_STEPS,
  vaultRefusal,
  verifyOwnWalletVault,
  type ExpectedVault,
  type OwnWalletParams,
  type VaultFacts,
  type VaultMismatch,
  type VaultStateName,
} from "./plan";

/**
 * THE OWN-WALLET DOOR'S TWO DECISIONS, with everything they touch passed in (`OwnWalletDeps`), so the
 * order of the checks is testable without a database, a chain or a key. `server.ts` wires the real ones.
 *
 * - `prepareOwnWalletLaunch`: may this session launch this plan from its own wallet, and with which calls?
 *   The checks are the account launch's (`launchFromTreasury`), in its order: the network is open, the
 *   plan is the session's, it is approved, and the plan's limits allow it BEFORE a call is handed over.
 * - `recordOwnWalletLaunch`: is the vault on chain the one this plan compiles to, created and funded by
 *   this session's wallet? Only then is the job recorded live, through the account launch's own recorder.
 *
 * The browser supplies a job id and nothing else that matters: not the vault, not the budget, not the
 * operator. Every one of those is recomputed here from the approved plan and the server's own settings.
 */

export type LaunchCheckResult = { ok: true } | { ok: false; message: string; upgradeTo?: PlanId | null };

export interface OwnWalletDeps {
  /** why nothing new may start on a chain (paused, closed, not a launch network, not configured), or null */
  closedReason(chainId: number): string | null;
  job(jobId: string): { founderWallet: string } | null;
  /** the job is a round of a weekly programme (Sage opens each next round itself, from the account) */
  isWeeklyRound(jobId: string): boolean;
  currentRevision(jobId: string): number | null;
  /** approve the current revision as this founder (the account launch's `autoApprove`) */
  approve(jobId: string, founder: string): boolean;
  approvedPlan(jobId: string): LoadedPlan | null;
  /** the current revision compiled but NOT approved: for the budget and the vault address only */
  draftPlan(jobId: string, founder: string): DeploymentReadyPlan | null;
  launchAllowed(founder: string, budgetBase: bigint): LaunchCheckResult;
  /** the product safety screen's door (src/lib/safety/): a refused product never launches */
  launchSafety(jobId: string): { ok: true } | { ok: false; message: string };
  /** the account launch's settings (default daily cap and duration), owned and guarded by this wallet, on Metis */
  settings(plan: DeploymentReadyPlan, owner: `0x${string}`): SettingsResult;
  bundle(plan: DeploymentReadyPlan, settings: DeploymentSettings): DeployPlanBundle;
  /** why this plan could not be recorded as a campaign (checked before money moves), or none */
  recordErrors(owner: `0x${string}`, loaded: LoadedPlan, jobId: string, settings: DeploymentSettings, vault: `0x${string}`): string[];
  liveCampaign(publicCampaignId: string): { id: string; vaultAddress: string; posterWallet: string } | null;
  /** the vault's lifecycle on chain, or null when nothing is deployed there */
  vaultState(chainId: number, vault: `0x${string}`): Promise<VaultStateName | null>;
  facts(expected: ExpectedVault): Promise<VaultFacts>;
  /** the account launch's recorder: re-reads the vault, checks it against the plan, persists atomically */
  record(owner: `0x${string}`, loaded: LoadedPlan, jobId: string, settings: DeploymentSettings, vault: `0x${string}`): Promise<string>;
}

export type OwnWalletRefusalReason =
  | "network_paused"
  | "not_evm"
  | "not_yours"
  | "weekly_round"
  | "plan_changed"
  | "not_ready"
  | "plan_limit"
  | "invalid"
  | "wrong_vault"
  | "taken"
  | "unreadable"
  | "mismatch"
  | "failed";

export interface OwnWalletRefusal {
  ok: false;
  reason: OwnWalletRefusalReason;
  message: string;
  upgradeTo?: PlanId | null;
  mismatches?: VaultMismatch[];
}

export type OwnWalletPrepared =
  /** already recorded: nothing to sign */
  | { ok: true; stage: "live"; campaignId: string }
  /** not approved yet: the budget and the vault address, and NO calls */
  | { ok: true; stage: "preview"; params: OwnWalletParams }
  /** approved: the calls to sign, in order */
  | { ok: true; stage: "ready"; params: OwnWalletParams };

export type OwnWalletRecorded = { ok: true; campaignId: string; vault: `0x${string}` };

const refuse = (reason: OwnWalletRefusalReason, message: string, extra: Partial<OwnWalletRefusal> = {}): OwnWalletRefusal => ({ ok: false, reason, message, ...extra });
const isEvmAddress = (a: string): a is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(a);
const METIS_ONLY = "Paying from your own wallet runs on Metis only.";

function budgetOf(plan: DeploymentReadyPlan): bigint {
  return plan.missions.reduce((a, m) => a + BigInt(m.rewardBase) * BigInt(m.maxCompletions), BigInt(0));
}

/** The gates both decisions share, in the account launch's order: the network, the wallet, the owner. */
function gate(founder: string, jobId: string, chainId: number | undefined, deps: OwnWalletDeps): OwnWalletRefusal | null {
  // Metis only. Another chain gets that chain's own sentence when it is paused or closed, never a door.
  if (chainId != null && chainId !== OWN_WALLET_CHAIN_ID) return refuse("network_paused", deps.closedReason(chainId) ?? METIS_ONLY);
  const closed = deps.closedReason(OWN_WALLET_CHAIN_ID);
  if (closed) return refuse("network_paused", closed);
  if (!isEvmAddress(founder)) return refuse("not_evm", "Sign in with an email or MetaMask to pay from your own wallet on Metis.");
  const job = deps.job(jobId);
  if (!job || !sameFounder(job.founderWallet, founder)) return refuse("not_yours", "That plan isn't yours.");
  return null;
}

function compile(plan: DeploymentReadyPlan, owner: `0x${string}`, deps: OwnWalletDeps): { ok: true; settings: DeploymentSettings; bundle: DeployPlanBundle; budget: bigint } | OwnWalletRefusal {
  const budget = budgetOf(plan);
  // THE INVARIANT: Σ(reward × places) is the approved budget, exactly, or nothing is built.
  if (budget <= BigInt(0) || budget !== BigInt(plan.totalBudgetBase)) return refuse("invalid", "This plan's rewards don't add up to its budget, so it can't launch. Plan it again.");
  const s = deps.settings(plan, owner);
  if (!s.ok) return refuse(s.errors.some((e) => e.startsWith("chain_")) ? "network_paused" : "invalid", `This plan can't launch from your wallet (${s.errors.join(", ")}).`);
  if (s.settings.chainId !== OWN_WALLET_CHAIN_ID) return refuse("network_paused", METIS_ONLY);
  let bundle: DeployPlanBundle;
  try {
    bundle = deps.bundle(plan, s.settings);
  } catch (e) {
    return refuse("invalid", e instanceof Error ? e.message : "This plan can't be built into a launch.");
  }
  // exactly the account launch's four calls, in its order; anything else is not this door's to send
  if (bundle.calls.length !== OWN_WALLET_STEPS.length || bundle.calls.some((c, i) => c.step !== OWN_WALLET_STEPS[i])) {
    return refuse("invalid", "This plan's launch isn't the four steps Sage sends, so nothing was handed over.");
  }
  return { ok: true, settings: s.settings, bundle, budget };
}

export async function prepareOwnWalletLaunch(
  founder: string,
  jobId: string,
  opts: { approve?: boolean; expectedRevision?: number; chainId?: number },
  deps: OwnWalletDeps,
): Promise<OwnWalletPrepared | OwnWalletRefusal> {
  const gated = gate(founder, jobId, opts.chainId, deps);
  if (gated) return gated;
  const owner = founder as `0x${string}`;
  if (deps.isWeeklyRound(jobId)) {
    return refuse("weekly_round", "A weekly test launches from your Sage account, because Sage opens each next round itself. Launch this one from your account.");
  }

  let loaded = deps.approvedPlan(jobId);
  if (loaded) {
    const live = deps.liveCampaign(loaded.plan.publicCampaignId);
    if (live) {
      return sameFounder(live.posterWallet, founder)
        ? { ok: true, stage: "live", campaignId: live.id }
        : refuse("taken", "This plan is already live from another wallet.");
    }
  }
  if (opts.approve) {
    // Launching approves the revision on screen, and only that one (the account door's rule).
    if (opts.expectedRevision != null && deps.currentRevision(jobId) !== opts.expectedRevision) {
      return refuse("plan_changed", "This plan changed since you opened it. Reload before paying.");
    }
    if (!deps.approve(jobId, founder)) return refuse("not_ready", "This plan isn't ready to launch. It may have changed since it was planned; plan it again.");
    loaded = deps.approvedPlan(jobId);
    if (!loaded) return refuse("not_ready", "Couldn't load the approved plan.");
  }
  const plan = loaded?.plan ?? deps.draftPlan(jobId, founder);
  if (!plan) return refuse("not_ready", "This plan isn't ready to launch yet.");

  const built = compile(plan, owner, deps);
  if (!built.ok) return built;
  const { settings, bundle, budget } = built;

  /**
   * THE PLAN'S LIMITS, BEFORE A CENT MOVES, and never after. A vault that already holds this wallet's
   * money (a launch resumed after the funding) is past the door: refusing it now would strand the money
   * one signature short of live. A vault that is only created has moved nothing, so it is still checked.
   */
  const onChain = await deps.vaultState(OWN_WALLET_CHAIN_ID, bundle.predictedVault).catch(() => null);
  const moneyIn = onChain !== null && onChain !== "created";
  if (!moneyIn) {
    const allowed = deps.launchAllowed(founder, budget);
    if (!allowed.ok) return refuse("plan_limit", allowed.message, { upgradeTo: allowed.upgradeTo ?? null });
    // the product itself, at the same moment and under the same rule: before money, never after
    const safe = deps.launchSafety(jobId);
    if (!safe.ok) return refuse("not_ready", safe.message);
  }

  // THE RECORD IS CHECKED BEFORE THE MONEY MOVES (deploy-runner's rule): a plan that could not be
  // recorded as a campaign is refused here, with nothing signed.
  if (loaded) {
    const errors = deps.recordErrors(owner, loaded, jobId, settings, bundle.predictedVault);
    if (errors.length) return refuse("invalid", `This plan can't be recorded as a job (${errors.join(", ")}). Nothing was sent.`);
  }

  const params: OwnWalletParams = {
    chainId: OWN_WALLET_CHAIN_ID,
    owner,
    vault: bundle.predictedVault,
    factory: settings.factory,
    token: settings.token,
    operator: settings.operator,
    budgetBase: budget.toString(),
    tokenSymbol: "m.USDC",
    tokenDecimals: plan.tokenDecimals,
    // an unapproved plan hands over no calls: there is nothing a wallet could sign before the approval
    calls: loaded ? bundle.calls.map((c, i) => ({ step: OWN_WALLET_STEPS[i], to: c.to, data: c.data, label: c.label })) : [],
  };
  return { ok: true, stage: loaded ? "ready" : "preview", params };
}

/** What the plan compiles to, as the vault must carry it. */
export function expectedVault(owner: `0x${string}`, settings: DeploymentSettings, bundle: DeployPlanBundle): ExpectedVault {
  return {
    chainId: settings.chainId,
    owner,
    vault: bundle.predictedVault,
    factory: settings.factory,
    operator: settings.operator,
    guardian: settings.guardian,
    token: settings.token,
    campaignIdHash: bundle.inputs.campaignIdHash,
    budgetBase: bundle.inputs.totalBudgetBase,
    dailyVelocityCap: settings.dailyVelocityCap,
    durationSeconds: settings.durationSeconds,
    missions: bundle.inputs.missionIds.map((id, i) => ({ missionIdHash: id, rewardBase: bundle.inputs.rewards[i], maxCompletions: bundle.inputs.maxCompletions[i] })),
  };
}

export async function recordOwnWalletLaunch(
  founder: string,
  jobId: string,
  opts: { vault?: string; chainId?: number },
  deps: OwnWalletDeps,
): Promise<OwnWalletRecorded | OwnWalletRefusal> {
  const gated = gate(founder, jobId, opts.chainId, deps);
  if (gated) return gated;
  const owner = founder as `0x${string}`;
  const loaded = deps.approvedPlan(jobId);
  if (!loaded) return refuse("not_ready", "This plan has no approved version to record.");
  const built = compile(loaded.plan, owner, deps);
  if (!built.ok) return built;
  const { settings, bundle } = built;
  const vault = bundle.predictedVault;
  // The vault is the SERVER's answer for this wallet and this plan. A client that names another is refused.
  if (opts.vault != null && !sameChainAddress(opts.vault, vault)) return refuse("wrong_vault", "That isn't this job's vault for your wallet.");

  const already = (): OwnWalletRecorded | OwnWalletRefusal | null => {
    const live = deps.liveCampaign(loaded.plan.publicCampaignId);
    if (!live) return null;
    return sameFounder(live.posterWallet, founder) && sameChainAddress(live.vaultAddress, vault)
      ? { ok: true, campaignId: live.id, vault }
      : refuse("taken", "This plan is already live from another wallet.");
  };
  const before = already();
  if (before) return before;

  // NO PLAN CHECK HERE, on purpose: the wallet's money may already be in the vault, and a plan gates
  // launches, never what is already funded. The chain decides.
  const expected = expectedVault(owner, settings, bundle);
  let facts: VaultFacts;
  try {
    facts = await deps.facts(expected);
  } catch {
    return refuse("unreadable", "Sage couldn't read the vault on Metis just now. Nothing was recorded; try again in a moment.");
  }
  const verdict = verifyOwnWalletVault(expected, facts);
  if (!verdict.ok) return refuse("mismatch", vaultRefusal(verdict.mismatches), { mismatches: verdict.mismatches });

  try {
    const campaignId = await deps.record(owner, loaded, jobId, settings, vault);
    return { ok: true, campaignId, vault };
  } catch (e) {
    // two tabs finishing at once: the other one recorded it
    const after = already();
    if (after) return after;
    return refuse("failed", e instanceof Error ? e.message.slice(0, 300) : "Recording the job failed. Your vault is funded and safe; try again.");
  }
}
