import "server-only";
import { db } from "@/lib/db";
import { campaigns, type Campaign, type Workspace } from "@/lib/db/schema";
import { listInspectionJobs } from "@/lib/db/inspection";
import { memberRole, walletMemberKey, workspaceOwnedBy, workspacesForMember } from "@/lib/db/workspaces";
import { declaredLinksOf } from "@/lib/campaigns/wallet-links";
import { founderStorageKey, sameFounder } from "@/lib/auth/founder";
import { isMainnetChain } from "@/lib/deputy/networks";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { PERIOD_SECONDS, PLAN_ORDER, planInForce, type PlanId } from "./catalog";
import { checkLaunch, type LaunchCheck, type Usage } from "./limits";

/**
 * WHICH PLAN A FOUNDER IS ON, AND WHAT THEY ALREADY HAVE LIVE.
 *
 * A plan belongs to a workspace, and a workspace follows the PERSON: one they own, one owned by a
 * wallet they declared as theirs (`declaredLinksOf`, never a discovered link, which is the farm
 * watch's finding), or one where they are an admin. The best plan among those is the one in force.
 * A founder with no workspace is on Free: Free is a real plan, not an error.
 */

const nowSec = () => Math.floor(Date.now() / 1000);

/** The founder and every wallet they declared as theirs: one person. */
function identities(founder: string): string[] {
  return [founder, ...declaredLinksOf(founder)];
}

export interface FounderPlan {
  plan: PlanId;
  /** Unix seconds the paid plan runs until; null on Free. */
  until: number | null;
  /** The workspace the plan lives on (the one billing extends). */
  workspace: Workspace | null;
}

export { planInForce };

export function founderPlan(founder: string, now = nowSec()): FounderPlan {
  const candidates: Workspace[] = [];
  for (const id of identities(founder)) {
    const owned = workspaceOwnedBy(founderStorageKey(id));
    if (owned) candidates.push(owned);
    for (const ws of workspacesForMember(walletMemberKey(id))) {
      if (memberRole(ws.id, walletMemberKey(id)) === "admin") candidates.push(ws);
    }
  }
  // The owned workspace comes first, so a tie (two Free workspaces) bills the founder's own.
  let best: FounderPlan = { plan: "free", until: null, workspace: candidates[0] ?? null };
  for (const ws of candidates) {
    const p = planInForce(ws, now);
    if (PLAN_ORDER.indexOf(p) > PLAN_ORDER.indexOf(best.plan)) best = { plan: p, until: ws.planUntil ?? null, workspace: ws };
  }
  return best;
}

/** What a job put up, in USDC base units (every real-money rail Sage settles on is 6-decimal USDC). */
function budgetOf(c: Campaign): bigint {
  const e = v2Economics(c);
  const base = e.isV2 ? e.totalFundedBase : c.rewardAmount * Math.max(1, c.maxRecipients);
  return BigInt(Math.max(0, Math.round(base)));
}

/** Real-money jobs only: a sandbox or a testnet job is never counted against anyone. */
function counts(c: Pick<Campaign, "sandbox" | "chainId">): boolean {
  return !c.sandbox && isMainnetChain(c.chainId);
}

/**
 * Every job that is the founder's, on any network and in any state: its plan was theirs (every launch
 * door starts from one) or, for the older direct campaigns, they posted it. Usage, exports and the
 * fraud report all read this one list.
 */
export function founderCampaigns(founder: string): Campaign[] {
  const ids = identities(founder);
  const fromPlans = new Set<string>();
  for (const id of ids) for (const j of listInspectionJobs(id)) fromPlans.add(j.publicCampaignId);
  return db
    .select()
    .from(campaigns)
    .all()
    .filter((c) => fromPlans.has(c.id) || ids.some((a) => sameFounder(c.posterWallet, a)));
}

/** Jobs live now, and the budget launched in the last 30 days, across every network. */
export function founderUsage(founder: string, now = nowSec()): Usage {
  const since = now - PERIOD_SECONDS;
  let liveJobs = 0;
  let launchedBase = BigInt(0);
  for (const c of founderCampaigns(founder)) {
    if (!counts(c)) continue;
    if (c.status === "live") liveJobs += 1;
    if (c.createdAt >= since) launchedBase += budgetOf(c);
  }
  return { liveJobs, launchedBase };
}

/** Plan limits are on unless an operator switches them off for an emergency (`SAGE_PLAN_LIMITS=off`). */
export function planLimitsEnforced(): boolean {
  return (process.env.SAGE_PLAN_LIMITS ?? "").trim().toLowerCase() !== "off";
}

/**
 * The plan every FEATURE gate reads (Autopilot, invites, admins, exports). With limits switched off
 * for an emergency, everything is open, exactly as it was before Sage had plans.
 */
export function effectivePlan(founder: string, now = nowSec()): PlanId {
  return planLimitsEnforced() ? founderPlan(founder, now).plan : "programs";
}

/** The same rule for a workspace row read directly (the invite and members doors). */
export function effectiveWorkspacePlan(ws: Pick<Workspace, "plan" | "planUntil">, now = nowSec()): PlanId {
  return planLimitsEnforced() ? planInForce(ws, now) : "programs";
}

/**
 * May this founder start one more job of `budgetBase` (USD base units)? Asked at every launch door
 * BEFORE money moves. Never asked after: a job already live keeps paying its workers.
 */
export function launchAllowed(founder: string, budgetBase: bigint, now = nowSec()): LaunchCheck {
  if (!planLimitsEnforced()) return { ok: true };
  return checkLaunch(founderPlan(founder, now).plan, founderUsage(founder, now), budgetBase);
}
