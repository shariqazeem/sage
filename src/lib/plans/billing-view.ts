import "server-only";
import { listPlanPayments, memberRole, walletMemberKey, getRenewal } from "@/lib/db/workspaces";
import type { PlanPaymentMethod, Workspace } from "@/lib/db/schema";
import { canManage } from "@/lib/workspaces/context";
import { getWebTreasuryOn } from "@/lib/treasury/web";
import { accountBalanceBase } from "@/lib/treasury/activity";
import { launchClosedReason } from "@/lib/launch/deployment-service";
import { chainConfig, explorerTxUrl } from "@/lib/deputy/networks";
import { PLANS, isPlanId, type PlanId } from "./catalog";
import { billingAddress, billingChains } from "./billing";
import { founderPlan, founderUsage } from "./founder-plan";
import { REMIND_AHEAD_SECONDS, renewalNotice } from "./renewal";
import { promoRedemptionsOf } from "./promo";

/**
 * EVERYTHING A FOUNDER SEES ABOUT PAYING FOR SAGE, FROM ONE PLACE: the plan in force, whether it renews
 * and from where, the Sage balance it renews from, what to say about the next renewal, and every
 * payment with its receipt. Settings, the checkout, Home and the billing API all read this, so no two
 * of them can describe the same account differently.
 */
export interface PaymentView {
  txHash: string;
  /** the receipt's number: the date it was paid and the start of its transaction. */
  number: string;
  plan: PlanId;
  planName: string;
  amountUsd: number;
  network: string;
  paidAt: number;
  periodStart: number;
  planUntil: number;
  method: PlanPaymentMethod | null;
  receiptUrl: string;
  explorerUrl: string;
}

export interface BillingView {
  plan: PlanId;
  until: number | null;
  workspaceId: string | null;
  workspaceName: string | null;
  autoRenew: boolean;
  /** whether this founder may change the plan or its renewal (the owner, or an admin). */
  canManage: boolean;
  /** where plans are paid; null when billing isn't configured on this deployment. */
  billing: { chainId: number; network: string; token: string; to: string } | null;
  /** the Sage balance on the billing network, when the founder has one. */
  balance: { address: string; usd: number | null } | null;
  /** why a Sage balance can't be opened on the billing network yet (Metis before it is live), or null. */
  balanceClosed: string | null;
  notice: { tone: "info" | "warn"; text: string } | null;
  payments: PaymentView[];
  /** free days from promo codes, beside the payments in the history. */
  freeDays: { code: string; planName: string; days: number; redeemedAt: number; planUntil: number | null }[];
  usage: { liveJobs: number; launchedUsd: number };
}

export function receiptNumber(txHash: string, paidAt: number): string {
  const d = new Date(paidAt * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  return `SAGE-${d}-${txHash.slice(2, 8).toUpperCase()}`;
}

export function paymentViews(workspaceId: string): PaymentView[] {
  return listPlanPayments(workspaceId)
    .map((p) => {
      const plan: PlanId = isPlanId(p.plan) ? p.plan : "pro";
      return {
        txHash: p.txHash,
        number: receiptNumber(p.txHash, p.paidAt),
        plan,
        planName: PLANS[plan].name,
        amountUsd: p.amountBase / 1e6,
        network: chainConfig(p.chainId).name,
        paidAt: p.paidAt,
        periodStart: p.periodStart ?? p.paidAt,
        planUntil: p.planUntil,
        method: p.method ?? null,
        receiptUrl: `/billing/receipt/${p.txHash}`,
        explorerUrl: explorerTxUrl(p.chainId, p.txHash),
      };
    })
    .reverse();
}

/**
 * The billing view for a founder. `readBalance` controls the one network call (the balance): Home
 * passes "when-relevant", so a page load only reads the chain when a renewal is close or has failed.
 */
export async function billingView(founder: string, opts: { readBalance?: "always" | "when-relevant" } = {}): Promise<BillingView> {
  const now = Math.floor(Date.now() / 1000);
  const fp = founderPlan(founder, now);
  const ws: Workspace | null = fp.workspace;
  const chainId = billingChains()[0] ?? null;
  const to = billingAddress();
  const token = chainId != null ? chainConfig(chainId).usdcAddress : null;
  const t = chainId != null ? getWebTreasuryOn(founder, chainId) : null;
  const attempt = ws ? getRenewal(ws.id, ws.planUntil) : null;
  const relevant = fp.plan !== "free" && fp.until != null && (fp.until - now <= REMIND_AHEAD_SECONDS || attempt?.status === "failed");
  let usd: number | null = null;
  if (t && chainId != null && (opts.readBalance === "always" || relevant)) {
    usd = await accountBalanceBase(t.privyWalletAddress, chainId).then((b) => Number(b) / 1e6).catch(() => null);
  }
  const usage = founderUsage(founder);
  return {
    plan: fp.plan,
    until: fp.until,
    workspaceId: ws?.id ?? null,
    workspaceName: ws?.name ?? null,
    autoRenew: ws?.autoRenew ?? true,
    canManage: ws ? canManage(memberRole(ws.id, walletMemberKey(founder))) : true,
    billing: chainId != null && to && token ? { chainId, network: chainConfig(chainId).name, token, to } : null,
    balance: t ? { address: t.privyWalletAddress, usd } : null,
    balanceClosed: chainId != null && !t ? launchClosedReason(chainId) : null,
    notice: ws ? renewalNotice({ plan: ws.plan, planUntil: ws.planUntil, autoRenew: ws.autoRenew, hasBalance: !!t, attempt, balanceUsd: usd, now }) : null,
    payments: ws ? paymentViews(ws.id) : [],
    freeDays: ws
      ? promoRedemptionsOf(ws.id)
          .filter((r) => r.kind === "days")
          .map((r) => ({ code: r.code, planName: isPlanId(r.plan) ? PLANS[r.plan].name : "Pro", days: r.daysGranted ?? 0, redeemedAt: r.redeemedAt, planUntil: r.planUntil ?? null }))
      : [],
    usage: { liveJobs: usage.liveJobs, launchedUsd: Number(usage.launchedBase) / 1e6 },
  };
}
