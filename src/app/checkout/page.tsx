import "@/styles/checkout.css";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getFounderAddress } from "@/lib/auth/founder";
import { Checkout } from "@/components/billing/checkout";
import { isPlanId, PERIOD_DAYS, PERIOD_SECONDS, PLANS, SELF_SERVE, type PlanId } from "@/lib/plans/catalog";
import { planPriceUsd } from "@/lib/plans/billing-math";
import { billingView } from "@/lib/plans/billing-view";
import { quoteWorkspacePlan } from "@/lib/plans/apply-payment";
import { founderPlan } from "@/lib/plans/founder-plan";
import { normalizePromoCode } from "@/lib/plans/promo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

/**
 * BUYING A PLAN (21 Oct 2026). A focused page, no rail and no site header: what you are buying, how you
 * pay, one button, a receipt. Signed out, it goes through sign-in and comes back holding the plan (and
 * the promo code, when a shared link carried one).
 */
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ plan?: string; code?: string }> }) {
  const sp = await searchParams;
  const plan: PlanId = isPlanId(sp.plan) && SELF_SERVE.includes(sp.plan) ? sp.plan : "pro";
  const code = normalizePromoCode(sp.code);
  const founder = await getFounderAddress();
  if (!founder) {
    const back = `/checkout?plan=${plan}${code ? `&code=${code}` : ""}`;
    redirect(`/start?next=${encodeURIComponent(back)}`);
  }
  const now = Math.floor(Date.now() / 1000);
  const view = await billingView(founder, { readBalance: "always" });
  const priceUsd = planPriceUsd(plan) ?? 0;
  // The quote is read-only here: a founder with no workspace yet is quoted as new, and the workspace is
  // made only when they actually pay or redeem.
  const ws = founderPlan(founder, now).workspace;
  const q = ws ? quoteWorkspacePlan(ws, plan, now) : null;
  const until = q?.ok ? q.until : now + PERIOD_SECONDS;
  const renewing = !!q?.ok && q.periodStart > now;
  const creditDays = q?.ok && !renewing ? Math.max(0, Math.floor((until - now - PERIOD_SECONDS) / 86_400)) : 0;
  return (
    <Checkout
      plan={{ id: plan, name: PLANS[plan].name, blurb: PLANS[plan].blurb, priceUsd, highlights: PLANS[plan].highlights }}
      current={{ name: PLANS[view.plan].name, isFree: view.plan === "free" }}
      quote={q && !q.ok ? { ok: false, error: q.error } : { ok: true, until, creditDays, renewing }}
      billing={view.billing}
      balance={view.balance}
      balanceClosed={view.balanceClosed}
      autoRenew={view.autoRenew}
      canManage={view.canManage}
      periodDays={PERIOD_DAYS}
      initialCode={code}
    />
  );
}
