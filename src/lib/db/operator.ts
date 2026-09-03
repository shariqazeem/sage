import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { operatorLaunches, operatorMandates, type OperatorLaunch, type OperatorMandate } from "@/lib/db/schema";
import { founderStorageKey } from "@/lib/auth/founder";
import { DEFAULT_POLICY, type OperatorPolicy } from "@/lib/operator/policy";

/** One mandate per founder, keyed the same chain-agnostic way every other founder row is. */
export const mandateKey = (founderAddress: string) => founderStorageKey(founderAddress);

export function getMandate(founderAddress: string): OperatorMandate | null {
  return db.select().from(operatorMandates).where(eq(operatorMandates.founderKey, mandateKey(founderAddress))).get() ?? null;
}

export type MandateFields = Partial<
  Pick<
    OperatorMandate,
    | "enabled" | "productUrl" | "goal" | "weeklyCapBase" | "perCampaignCapBase" | "reserveFloorBase"
    | "probeBase" | "maxScale" | "maxConcurrent" | "maxExposureBps" | "minSpacingMinutes"
    | "stallAfterMinutes" | "minCampaignBase" | "vetoWindowMinutes"
  >
>;

export function upsertMandate(founderAddress: string, fields: MandateFields, now = Math.floor(Date.now() / 1000)): OperatorMandate {
  const key = mandateKey(founderAddress);
  const existing = getMandate(founderAddress);
  if (existing) {
    db.update(operatorMandates).set({ ...fields, updatedAt: now }).where(eq(operatorMandates.founderKey, key)).run();
    return getMandate(founderAddress) as OperatorMandate;
  }
  db.insert(operatorMandates)
    .values({
      founderKey: key,
      founderAddress: founderAddress.trim(),
      enabled: fields.enabled ?? 0,
      productUrl: fields.productUrl ?? null,
      goal: fields.goal ?? null,
      weeklyCapBase: fields.weeklyCapBase ?? DEFAULT_POLICY.weeklyCapBase,
      perCampaignCapBase: fields.perCampaignCapBase ?? DEFAULT_POLICY.perCampaignCapBase,
      reserveFloorBase: fields.reserveFloorBase ?? DEFAULT_POLICY.reserveFloorBase,
      probeBase: fields.probeBase ?? DEFAULT_POLICY.probeBase,
      maxScale: fields.maxScale ?? DEFAULT_POLICY.maxScale,
      maxConcurrent: fields.maxConcurrent ?? DEFAULT_POLICY.maxConcurrent,
      maxExposureBps: fields.maxExposureBps ?? Math.round(DEFAULT_POLICY.maxExposure * 10_000),
      minSpacingMinutes: fields.minSpacingMinutes ?? DEFAULT_POLICY.minSpacingMinutes,
      stallAfterMinutes: fields.stallAfterMinutes ?? DEFAULT_POLICY.stallAfterMinutes,
      minCampaignBase: fields.minCampaignBase ?? DEFAULT_POLICY.minCampaignBase,
      vetoWindowMinutes: fields.vetoWindowMinutes ?? 20,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getMandate(founderAddress) as OperatorMandate;
}

/** The stored row as the pure rules want it. The row is the only source of a ceiling. */
export function policyFrom(m: OperatorMandate): OperatorPolicy {
  return {
    enabled: m.enabled === 1,
    weeklyCapBase: m.weeklyCapBase,
    perCampaignCapBase: m.perCampaignCapBase,
    reserveFloorBase: m.reserveFloorBase,
    probeBase: m.probeBase,
    maxScale: m.maxScale,
    maxConcurrent: m.maxConcurrent,
    maxExposure: m.maxExposureBps / 10_000,
    minSpacingMinutes: m.minSpacingMinutes,
    stallAfterMinutes: m.stallAfterMinutes,
    minCampaignBase: m.minCampaignBase,
  };
}

const WEEK = 7 * 24 * 3600;

/**
 * Everything the agent committed in the trailing week. An intent that is still `planning` counts:
 * it was decided, and until it is deployed or abandoned the money is spoken for. Anything else
 * would let a stalled design silently free up the ceiling and double-commit the week.
 */
export function committedThisWeekBase(founderAddress: string, now = Math.floor(Date.now() / 1000)): number {
  const rows = db.select().from(operatorLaunches)
    .where(and(eq(operatorLaunches.founderKey, mandateKey(founderAddress)), gte(operatorLaunches.createdAt, now - WEEK)))
    .all();
  return rows.filter((r) => r.state !== "abandoned" && r.state !== "vetoed").reduce((n, r) => n + r.budgetBase, 0);
}

export function lastLaunchAt(founderAddress: string): number | null {
  const row = db.select().from(operatorLaunches)
    .where(eq(operatorLaunches.founderKey, mandateKey(founderAddress)))
    .orderBy(desc(operatorLaunches.createdAt)).limit(1).get();
  return row?.createdAt ?? null;
}

export function listLaunches(founderAddress: string, limit = 20): OperatorLaunch[] {
  return db.select().from(operatorLaunches)
    .where(eq(operatorLaunches.founderKey, mandateKey(founderAddress)))
    .orderBy(desc(operatorLaunches.createdAt)).limit(limit).all();
}

export function getLaunch(id: string): OperatorLaunch | null {
  return db.select().from(operatorLaunches).where(eq(operatorLaunches.id, id)).get() ?? null;
}

export function launchesInState(founderAddress: string, state: OperatorLaunch["state"]): OperatorLaunch[] {
  return db.select().from(operatorLaunches)
    .where(and(eq(operatorLaunches.founderKey, mandateKey(founderAddress)), eq(operatorLaunches.state, state)))
    .orderBy(desc(operatorLaunches.createdAt)).all();
}

/**
 * The reason is written BEFORE the money moves — that is the point of this row. A founder can read
 * what the agent intended and why, and veto it, while it is still an intention.
 */
export function recordIntent(input: { founderAddress: string; surface: string | null; kind: "testing" | "gig" | "grant"; goal: string; decidedBy: "llm" | "rules"; budgetBase: number; reason: string; commitAt: number; state?: "proposed" | "committed"; jobId?: string | null }, now = Math.floor(Date.now() / 1000)): OperatorLaunch {
  const id = `opl_${randomUUID().slice(0, 12)}`;
  db.insert(operatorLaunches).values({
    id,
    founderKey: mandateKey(input.founderAddress),
    jobId: input.jobId ?? null,
    campaignId: null,
    surface: input.surface,
    kind: input.kind,
    goal: input.goal,
    decidedBy: input.decidedBy,
    budgetBase: input.budgetBase,
    reason: input.reason,
    state: input.state ?? "proposed",
    commitAt: input.commitAt,
    createdAt: now,
    updatedAt: now,
  }).run();
  return getLaunch(id) as OperatorLaunch;
}

export function updateLaunch(id: string, fields: Partial<Pick<OperatorLaunch, "jobId" | "campaignId" | "state" | "reason" | "budgetBase" | "surface" | "commitAt" | "vetoReason">>, now = Math.floor(Date.now() / 1000)): void {
  db.update(operatorLaunches).set({ ...fields, updatedAt: now }).where(eq(operatorLaunches.id, id)).run();
}

/** Every founder with an armed mandate — the sweep's work list. */
export function armedMandates(): OperatorMandate[] {
  return db.select().from(operatorMandates).where(eq(operatorMandates.enabled, 1)).all();
}
