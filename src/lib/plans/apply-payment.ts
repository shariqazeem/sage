import "server-only";
import { createWorkspace, recordPlanPayment } from "@/lib/db/workspaces";
import { personRole } from "@/lib/workspaces/person-role";
import type { PlanPaymentMethod, Workspace } from "@/lib/db/schema";
import { founderStorageKey } from "@/lib/auth/founder";
import { canManage } from "@/lib/workspaces/context";
import { PLANS, type PlanId } from "./catalog";
import { nextPeriod, planPriceUsd, usdToBase } from "./billing-math";
import { founderPlan, planInForce } from "./founder-plan";
import type { PercentPromo } from "./promo";

/**
 * THE WORKSPACE A PAYMENT EXTENDS, AND WHAT IT WILL BUY. One function for every payment door (a
 * wallet's transaction, the balance's one-click transfer, the automatic renewal), so they can never
 * disagree about the price, the period or who may pay.
 */
export type Quote =
  | { ok: true; workspace: Workspace; plan: PlanId; priceUsd: number; priceBase: bigint; until: number; periodStart: number; promo: PercentPromo | null }
  | { ok: false; status: number; error: string };

/** What paying for `plan` on this workspace buys right now: the price and the period. No permission check. */
export function quoteWorkspacePlan(workspace: Workspace, plan: PlanId, now = Math.floor(Date.now() / 1000), promo: PercentPromo | null = null): Quote {
  const listUsd = planPriceUsd(plan);
  if (!listUsd) return { ok: false, status: 400, error: `${PLANS[plan].name} isn't bought here. Write to us and we'll set it up with you.` };
  // A percent code takes its share off this one payment, priced here from the code, never from a client.
  if (promo && promo.plan !== plan) return { ok: false, status: 400, error: `That code is for ${PLANS[promo.plan].name}.` };
  const priceUsd = promo ? promo.discountedUsd : listUsd;
  const current = planInForce(workspace, now);
  const period = nextPeriod({ current, currentUntil: workspace.planUntil, next: plan, now });
  if (!period.ok) return { ok: false, status: 409, error: period.reason };
  // A renewal continues from where the plan ends; anything else starts the moment it is paid.
  const running = current !== "free" && (workspace.planUntil ?? 0) > now;
  const periodStart = running && current === plan ? (workspace.planUntil as number) : now;
  return { ok: true, workspace, plan, priceUsd, priceBase: usdToBase(priceUsd), until: period.until, periodStart, promo };
}

export function quotePlan(founder: string, plan: PlanId, now = Math.floor(Date.now() / 1000), promo: PercentPromo | null = null): Quote {
  if (!planPriceUsd(plan)) return { ok: false, status: 400, error: `${PLANS[plan].name} isn't bought here. Write to us and we'll set it up with you.` };
  // A founder without a workspace gets one now: a plan has to live somewhere, and asking them to
  // set up a workspace before they can pay is a form between them and the thing they chose.
  const workspace = founderPlan(founder, now).workspace ?? createWorkspace({ name: "My workspace", ownerKey: founderStorageKey(founder), ownerAddress: founder });
  if (!canManage(personRole(workspace, founder))) {
    return { ok: false, status: 403, error: "Only the workspace owner or an admin can change the plan." };
  }
  return quoteWorkspacePlan(workspace, plan, now, promo);
}

/** Apply a verified payment once. A transaction already applied returns null and changes nothing. */
export function applyPlanPayment(
  q: Extract<Quote, { ok: true }>,
  input: { txHash: string; chainId: number; payer: string; amountBase: bigint; method: PlanPaymentMethod },
) {
  return recordPlanPayment({
    txHash: input.txHash,
    workspaceId: q.workspace.id,
    chainId: input.chainId,
    payer: input.payer,
    amountBase: input.amountBase,
    planUntil: q.until,
    plan: q.plan,
    periodStart: q.periodStart,
    method: input.method,
    promo: q.promo ? { code: q.promo.code, percentOff: q.promo.percentOff, founder: input.payer } : undefined,
  });
}
