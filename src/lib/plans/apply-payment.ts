import "server-only";
import { createWorkspace, memberRole, recordPlanPayment, walletMemberKey } from "@/lib/db/workspaces";
import type { Workspace } from "@/lib/db/schema";
import { founderStorageKey } from "@/lib/auth/founder";
import { canManage } from "@/lib/workspaces/context";
import { PLANS, type PlanId } from "./catalog";
import { nextPeriod, planPriceUsd, usdToBase } from "./billing-math";
import { founderPlan, planInForce } from "./founder-plan";

/**
 * THE WORKSPACE A PAYMENT EXTENDS, AND WHAT IT WILL BUY. One function for both payment doors (a
 * wallet's transaction, or the account's one-click transfer), so they can never disagree about the
 * price, the period or who may pay.
 */
export type Quote =
  | { ok: true; workspace: Workspace; plan: PlanId; priceUsd: number; priceBase: bigint; until: number }
  | { ok: false; status: number; error: string };

export function quotePlan(founder: string, plan: PlanId, now = Math.floor(Date.now() / 1000)): Quote {
  const priceUsd = planPriceUsd(plan);
  if (!priceUsd) return { ok: false, status: 400, error: `${PLANS[plan].name} isn't bought here. Write to us and we'll set it up with you.` };
  // A founder without a workspace gets one now: a plan has to live somewhere, and asking them to
  // set up a workspace before they can pay is a form between them and the thing they chose.
  const workspace = founderPlan(founder, now).workspace ?? createWorkspace({ name: "My workspace", ownerKey: founderStorageKey(founder), ownerAddress: founder });
  if (!canManage(memberRole(workspace.id, walletMemberKey(founder)))) {
    return { ok: false, status: 403, error: "Only the workspace owner or an admin can change the plan." };
  }
  const period = nextPeriod({ current: planInForce(workspace, now), currentUntil: workspace.planUntil, next: plan, now });
  if (!period.ok) return { ok: false, status: 409, error: period.reason };
  return { ok: true, workspace, plan, priceUsd, priceBase: usdToBase(priceUsd), until: period.until };
}

/** Apply a verified payment once. A transaction already applied returns null and changes nothing. */
export function applyPlanPayment(q: Extract<Quote, { ok: true }>, input: { txHash: string; chainId: number; payer: string; amountBase: bigint }) {
  return recordPlanPayment({ txHash: input.txHash, workspaceId: q.workspace.id, chainId: input.chainId, payer: input.payer, amountBase: input.amountBase, planUntil: q.until, plan: q.plan });
}
