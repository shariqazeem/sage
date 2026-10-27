import "server-only";
import { and, eq, isNull, or, sql, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { promoCodes, promoRedemptions, workspaces, workspacePayments, type PromoCode, type Workspace } from "@/lib/db/schema";
import { createWorkspace } from "@/lib/db/workspaces";
import { personRole } from "@/lib/workspaces/person-role";
import { founderStorageKey } from "@/lib/auth/founder";
import { canManage } from "@/lib/workspaces/context";
import { isPlanId, PLAN_ORDER, PLANS, planInForce, SELF_SERVE, type PlanId } from "./catalog";
import { planPriceUsd } from "./billing-math";
import { founderPlan } from "./founder-plan";

/**
 * PROMO CODES (21 Oct 2026, the founder's ask: "we will give away some, it can be a strategy to gain
 * users"). Two kinds, both decided here and nowhere else:
 * - DAYS: free days of a plan. Nothing is paid; the plan runs for the days, and a workspace that never
 *   paid is not renewed afterwards unless its owner turns renewal on (a giveaway never becomes a
 *   surprise charge).
 * - PERCENT: a share off the FIRST payment. The server computes the discounted price from the code;
 *   a client never sends an amount, and a renewal is always the full price.
 * A workspace redeems a code once, ever. Codes are upper-case letters, digits and dashes.
 */
export type PromoCheck =
  | { ok: true; code: string; plan: PlanId; kind: "days"; days: number }
  | { ok: true; code: string; plan: PlanId; kind: "percent"; percentOff: number; priceUsd: number; discountedUsd: number }
  | { ok: false; error: string };

export type PercentPromo = Extract<PromoCheck, { kind: "percent" }>;

export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,31}$/.test(code) ? code : null;
}

/** A price after a percent off, in whole cents, never below one cent. Pure. */
export function discountedPriceUsd(priceUsd: number, percentOff: number): number {
  const cents = Math.round(priceUsd * 100);
  const off = Math.floor((cents * Math.min(99, Math.max(1, Math.round(percentOff)))) / 100);
  return Math.max(1, cents - off) / 100;
}

/** Pure: whether this code may be used for this plan by this workspace now, and what it gives. */
export function checkPromo(
  promo: PromoCode | null,
  ctx: { code: string; plan: PlanId; redeemed: boolean; everPaid: boolean; now: number; priceUsd: number | null },
): PromoCheck {
  const nope = "That code isn't valid.";
  if (!promo || promo.disabledAt) return { ok: false, error: nope };
  if (promo.expiresAt != null && promo.expiresAt <= ctx.now) return { ok: false, error: "That code has expired." };
  if (promo.maxUses != null && promo.uses >= promo.maxUses) return { ok: false, error: "That code has been used up." };
  if (!isPlanId(promo.plan)) return { ok: false, error: nope };
  if (promo.plan !== ctx.plan) return { ok: false, error: `That code is for ${PLANS[promo.plan].name}.` };
  if (ctx.redeemed) return { ok: false, error: "This workspace has already used that code." };
  if (promo.newOnly && ctx.everPaid) return { ok: false, error: "That code is for new customers." };
  if (promo.kind === "days") {
    if (!promo.days || promo.days <= 0) return { ok: false, error: nope };
    return { ok: true, code: ctx.code, plan: promo.plan, kind: "days", days: promo.days };
  }
  if (promo.kind === "percent") {
    if (!ctx.priceUsd || !promo.percentOff || promo.percentOff <= 0 || promo.percentOff >= 100) return { ok: false, error: nope };
    return { ok: true, code: ctx.code, plan: promo.plan, kind: "percent", percentOff: promo.percentOff, priceUsd: ctx.priceUsd, discountedUsd: discountedPriceUsd(ctx.priceUsd, promo.percentOff) };
  }
  return { ok: false, error: nope };
}

/**
 * Pure: the plan and end a DAYS code leaves a workspace with. The same plan running is extended; Free
 * (or a lapsed plan) starts now; a lower plan running is upgraded, its remaining days carried over at
 * their price, the way a paid upgrade is; a higher plan running is refused rather than downgraded.
 */
export function promoPeriod(input: { current: PlanId; currentUntil: number | null; next: PlanId; days: number; now: number; prices?: Partial<Record<PlanId, number | null>> }):
  | { ok: true; until: number }
  | { ok: false; reason: string } {
  const { current, next, now } = input;
  const span = Math.round(input.days * 86_400);
  const until = input.currentUntil ?? 0;
  const running = current !== "free" && until > now;
  if (!running) return { ok: true, until: now + span };
  if (current === next) return { ok: true, until: until + span };
  if (PLAN_ORDER.indexOf(next) < PLAN_ORDER.indexOf(current)) {
    const date = new Date(until * 1000).toISOString().slice(0, 10);
    return { ok: false, reason: `You're on ${PLANS[current].name} until ${date}, which already includes ${PLANS[next].name}. Keep the code for after it ends.` };
  }
  const price = (p: PlanId) => input.prices?.[p] ?? planPriceUsd(p);
  const curPrice = price(current) ?? 0;
  const nextPrice = price(next) ?? 0;
  const credit = nextPrice > 0 ? Math.floor(((until - now) * curPrice) / nextPrice) : 0;
  return { ok: true, until: now + span + Math.max(0, credit) };
}

export function getPromo(code: string): PromoCode | null {
  return db.select().from(promoCodes).where(eq(promoCodes.code, code)).get() ?? null;
}

function redeemed(code: string, workspaceId: string): boolean {
  return !!db.select({ c: promoRedemptions.code }).from(promoRedemptions).where(and(eq(promoRedemptions.code, code), eq(promoRedemptions.workspaceId, workspaceId))).get();
}

function everPaid(workspaceId: string): boolean {
  return !!db.select({ t: workspacePayments.txHash }).from(workspacePayments).where(eq(workspacePayments.workspaceId, workspaceId)).get();
}

/** Check a code for a founder and a plan, without changing anything. */
export function promoFor(founder: string, rawCode: unknown, plan: PlanId, now = Math.floor(Date.now() / 1000)): PromoCheck {
  const code = normalizePromoCode(rawCode);
  if (!code) return { ok: false, error: "That code isn't valid." };
  if (!SELF_SERVE.includes(plan)) return { ok: false, error: "That code isn't valid." };
  const ws = founderPlan(founder, now).workspace;
  return checkPromo(getPromo(code), { code, plan, redeemed: ws ? redeemed(code, ws.id) : false, everPaid: ws ? everPaid(ws.id) : false, now, priceUsd: planPriceUsd(plan) });
}

/**
 * REDEEM A DAYS CODE: the plan runs for the free days, nothing is paid. One transaction: the use is
 * counted only while the code still has uses left, the redemption row is written once per workspace,
 * and the workspace's plan moves with them, or none of it happens.
 */
export function redeemPromoDays(founder: string, rawCode: unknown, plan: PlanId, now = Math.floor(Date.now() / 1000)):
  | { ok: true; plan: PlanId; until: number; days: number }
  | { ok: false; status: number; error: string } {
  const check = promoFor(founder, rawCode, plan, now);
  if (!check.ok) return { ok: false, status: 400, error: check.error };
  if (check.kind !== "days") return { ok: false, status: 400, error: "That code takes money off a payment: use it at checkout." };
  const workspace: Workspace = founderPlan(founder, now).workspace ?? createWorkspace({ name: "My workspace", ownerKey: founderStorageKey(founder), ownerAddress: founder });
  if (!canManage(personRole(workspace, founder))) return { ok: false, status: 403, error: "Only the workspace owner or an admin can use a code." };
  const period = promoPeriod({ current: planInForce(workspace, now), currentUntil: workspace.planUntil, next: check.plan, days: check.days, now });
  if (!period.ok) return { ok: false, status: 409, error: period.reason };
  const neverPaid = !everPaid(workspace.id);
  const done = db.transaction((tx) => {
    const used = tx
      .update(promoCodes)
      .set({ uses: sql`${promoCodes.uses} + 1` })
      .where(
        and(
          eq(promoCodes.code, check.code),
          isNull(promoCodes.disabledAt),
          or(isNull(promoCodes.maxUses), sql`${promoCodes.uses} < ${promoCodes.maxUses}`),
          or(isNull(promoCodes.expiresAt), gt(promoCodes.expiresAt, now)),
        ),
      )
      .run();
    if (used.changes === 0) return "used_up" as const;
    const row = tx
      .insert(promoRedemptions)
      .values({ code: check.code, workspaceId: workspace.id, founder: founder.toLowerCase(), plan: check.plan, kind: "days", daysGranted: check.days, planUntil: period.until, redeemedAt: now })
      .onConflictDoNothing()
      .run();
    if (row.changes === 0) {
      tx.update(promoCodes).set({ uses: sql`${promoCodes.uses} - 1` }).where(eq(promoCodes.code, check.code)).run();
      return "already" as const;
    }
    // A giveaway never turns into a surprise charge: a workspace that never paid starts with renewal off.
    tx.update(workspaces)
      .set({ plan: check.plan, planUntil: period.until, ...(neverPaid ? { autoRenew: false } : {}), updatedAt: now })
      .where(eq(workspaces.id, workspace.id))
      .run();
    return "ok" as const;
  });
  if (done === "used_up") return { ok: false, status: 409, error: "That code has just been used up." };
  if (done === "already") return { ok: false, status: 409, error: "This workspace has already used that code." };
  return { ok: true, plan: check.plan, until: period.until, days: check.days };
}

/**
 * The percent code a PAYMENT carries: none when no code was given, the checked promo when it applies,
 * or the reason it doesn't. A days code is refused here: it is redeemed, never paid with.
 */
export function paymentPromo(founder: string, raw: unknown, plan: PlanId): { ok: true; promo: PercentPromo | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, promo: null };
  const check = promoFor(founder, raw, plan);
  if (!check.ok) return { ok: false, error: check.error };
  if (check.kind !== "percent") return { ok: false, error: "That code gives free days: redeem it instead of paying." };
  return { ok: true, promo: check };
}

/** The redemptions a workspace made, newest first: billing history shows the free days beside the payments. */
export function promoRedemptionsOf(workspaceId: string) {
  return db.select().from(promoRedemptions).where(eq(promoRedemptions.workspaceId, workspaceId)).all().sort((a, b) => b.redeemedAt - a.redeemedAt);
}

/** The redemption a payment carried, for its receipt. */
export function promoOnPayment(txHash: string) {
  return db.select().from(promoRedemptions).where(eq(promoRedemptions.txHash, txHash.toLowerCase())).get() ?? null;
}
