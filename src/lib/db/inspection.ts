import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";

import { db } from "./index";
import { nowSeconds } from "./keys";
import { inspectionJobs, type InspectionJob, type InspectionStatus, type NewInspectionJob } from "./schema";

/**
 * Durable inspection-job accessors + a state machine. The status reflects REAL work
 * (the pipeline updates it as it enters each stage). `createInspectionJob` is
 * idempotent: a repeated request with the same idempotency key returns the existing
 * job instead of spawning a duplicate model run. Provider secrets are never stored.
 */

/** Legal forward transitions — a job never moves backwards except into a terminal state. */
const ORDER: Record<InspectionStatus, number> = {
  queued: 0, fetching: 1, analyzing: 2, mapping: 3, generating_missions: 4, reviewing: 5,
  ready: 6, needs_input: 6, failed: 6, superseded: 7,
};

export function idempotencyKey(founderWallet: string, productUrl: string, budgetBase: bigint, repoUrl?: string | null): string {
  return createHash("sha256")
    .update(`${founderWallet.toLowerCase()}|${productUrl.trim().toLowerCase()}|${budgetBase.toString()}|${(repoUrl ?? "").trim().toLowerCase()}`)
    .digest("hex");
}

export function getInspectionJob(id: string): InspectionJob | null {
  return db.select().from(inspectionJobs).where(eq(inspectionJobs.id, id)).get() ?? null;
}

export function getInspectionJobByIdem(key: string): InspectionJob | null {
  return db.select().from(inspectionJobs).where(eq(inspectionJobs.idempotencyKey, key)).get() ?? null;
}

export function listInspectionJobs(founderWallet: string): InspectionJob[] {
  return db
    .select()
    .from(inspectionJobs)
    .where(eq(inspectionJobs.founderWallet, founderWallet.toLowerCase()))
    .orderBy(desc(inspectionJobs.createdAt))
    .all();
}

export interface CreateInspectionInput {
  founderWallet: string;
  publicCampaignId: string;
  productUrl: string;
  repoUrl?: string | null;
  goal: string;
  targetUsers: string;
  totalBudgetBase: bigint;
  tokenDecimals: number;
}

/** Create (or return the existing idempotent) job. Returns {job, created}. */
export function createInspectionJob(input: CreateInspectionInput): { job: InspectionJob; created: boolean } {
  const key = idempotencyKey(input.founderWallet, input.productUrl, input.totalBudgetBase, input.repoUrl);
  const existing = getInspectionJobByIdem(key);
  if (existing) return { job: existing, created: false };

  const id = nanoid(12);
  const now = nowSeconds();
  const inputDigest = createHash("sha256")
    .update(JSON.stringify({ u: input.productUrl, r: input.repoUrl ?? "", g: input.goal, t: input.targetUsers, b: input.totalBudgetBase.toString() }))
    .digest("hex");
  const row: NewInspectionJob = {
    id,
    founderWallet: input.founderWallet.toLowerCase(),
    idempotencyKey: key,
    status: "queued",
    publicCampaignId: input.publicCampaignId,
    productUrl: input.productUrl,
    repoUrl: input.repoUrl ?? null,
    goal: input.goal,
    targetUsers: input.targetUsers,
    totalBudgetBase: Number(input.totalBudgetBase),
    tokenDecimals: input.tokenDecimals,
    inputDigest,
    createdAt: now,
    updatedAt: now,
  };
  try {
    db.insert(inspectionJobs).values(row).run();
    return { job: getInspectionJob(id) as InspectionJob, created: true };
  } catch {
    // lost an idempotency race — return the row the other request created.
    const raced = getInspectionJobByIdem(key);
    if (raced) return { job: raced, created: false };
    throw new Error("failed to create inspection job");
  }
}

export interface JobPatch {
  productMapDigest?: string | null;
  pagesInspected?: number;
  repoFilesInspected?: number;
  model?: string | null;
  provider?: string | null;
  promptVersion?: string | null;
  revision?: number;
  result?: unknown;
  failureReason?: string | null;
  outputDigest?: string | null;
}

/** Advance a job's status (monotonic, never backwards) + patch fields. */
export function updateInspectionJob(id: string, status: InspectionStatus | null, patch: JobPatch = {}): void {
  const cur = getInspectionJob(id);
  if (!cur) return;
  const next = status && ORDER[status] >= ORDER[cur.status] ? status : cur.status;
  db.update(inspectionJobs)
    .set({ ...patch, status: next, updatedAt: nowSeconds() })
    .where(eq(inspectionJobs.id, id))
    .run();
}

/** Mark a prior job for the same idempotency scope superseded (a fresh regeneration). */
export function supersedeJob(id: string): void {
  db.update(inspectionJobs).set({ status: "superseded", updatedAt: nowSeconds() }).where(and(eq(inspectionJobs.id, id))).run();
}
