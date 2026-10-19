import type { Workspace, WorkspacePlan } from "@/lib/db/schema";
import { PERIOD_SECONDS, PLANS as CATALOG, planInForce } from "@/lib/plans/catalog";
import { planPriceUsd } from "@/lib/plans/billing-math";

/**
 * A WORKSPACE'S PLAN, read through the one catalog (`src/lib/plans/catalog.ts`). Kept for the
 * callers that ask about a workspace row directly (the invite door, the workspace page).
 *
 * Members are not capped by seat: a workspace's members are the people it pays, and a plan that
 * charged per person paid would tax the very thing Sage exists to do. What a plan gates is
 * members-only WORK (Pro and above), checked where that work is created.
 */
export const FREE_MEMBER_CAP = Number.POSITIVE_INFINITY;
export const DEFAULT_PRO_PRICE_USD = 29;

export interface PlanLimits {
  members: number;
  privateRail: boolean;
  advances: boolean;
  label: string;
}

export const PLANS: Record<WorkspacePlan, PlanLimits> = {
  free: { members: FREE_MEMBER_CAP, privateRail: true, advances: true, label: CATALOG.free.name },
  pro: { members: Number.POSITIVE_INFINITY, privateRail: true, advances: true, label: CATALOG.pro.name },
  team: { members: Number.POSITIVE_INFINITY, privateRail: true, advances: true, label: CATALOG.team.name },
  programs: { members: Number.POSITIVE_INFINITY, privateRail: true, advances: true, label: CATALOG.programs.name },
};

/** The plan in force NOW: a paid plan that has lapsed is Free again, not an error. */
export function planOf(ws: Pick<Workspace, "plan" | "planUntil">, nowSec = Math.floor(Date.now() / 1000)): WorkspacePlan {
  return planInForce(ws, nowSec);
}

export function limitsOf(ws: Pick<Workspace, "plan" | "planUntil">, nowSec?: number): PlanLimits {
  return PLANS[planOf(ws, nowSec)];
}

export function canAddMember(ws: Pick<Workspace, "plan" | "planUntil">, memberCount: number, nowSec?: number): boolean {
  return memberCount < limitsOf(ws, nowSec).members;
}

export function proPriceUsd(): number {
  return planPriceUsd("pro") ?? DEFAULT_PRO_PRICE_USD;
}

export const PRO_PERIOD_SECONDS = PERIOD_SECONDS;
