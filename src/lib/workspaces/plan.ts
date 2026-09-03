import type { Workspace, WorkspacePlan } from "@/lib/db/schema";

/**
 * WHAT A PLAN UNLOCKS. Pure: the page, the API and the Telegram bot all ask this one file.
 *
 * Free is a real workspace, not a demo: an owner and two more people, public receipts, every
 * verification lane. Pro removes the member cap and opens the parts that move money privately or
 * ahead of time — private payouts on Starknet and working-capital advances for members.
 */
/** No seat cap. Sage earns on settlement, not on seats — the constant stays for the invite door's arithmetic. */
export const FREE_MEMBER_CAP = Number.POSITIVE_INFINITY;
export const DEFAULT_PRO_PRICE_USD = 29;

export interface PlanLimits {
  members: number;
  privateRail: boolean;
  advances: boolean;
  label: string;
}

export const PLANS: Record<WorkspacePlan, PlanLimits> = {
  free: { members: FREE_MEMBER_CAP, privateRail: true, advances: true, label: "Sage" },
  pro: { members: Number.POSITIVE_INFINITY, privateRail: true, advances: true, label: "Pro" },
};

/** The plan in force NOW: a paid plan that has lapsed is Free again, not an error. */
export function planOf(ws: Pick<Workspace, "plan" | "planUntil">, nowSec = Math.floor(Date.now() / 1000)): WorkspacePlan {
  if (ws.plan === "pro" && (ws.planUntil ?? 0) > nowSec) return "pro";
  return "free";
}

export function limitsOf(ws: Pick<Workspace, "plan" | "planUntil">, nowSec?: number): PlanLimits {
  return PLANS[planOf(ws, nowSec)];
}

export function canAddMember(ws: Pick<Workspace, "plan" | "planUntil">, memberCount: number, nowSec?: number): boolean {
  return memberCount < limitsOf(ws, nowSec).members;
}

export function proPriceUsd(): number {
  const raw = process.env.SAGE_PRO_PRICE_USD?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PRO_PRICE_USD;
}

export const PRO_PERIOD_SECONDS = 30 * 24 * 3600;
