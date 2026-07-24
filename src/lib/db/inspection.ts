import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
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
  queued: 0, fetching: 1, field_test: 1.5, analyzing: 2, mapping: 3, generating_missions: 4, reviewing: 5,
  ready: 6, needs_input: 6, failed: 6, superseded: 7,
};

/**
 * The founder's GOAL digest — the exact campaign intent, canonicalized (NFC + collapsed whitespace +
 * lowercased) so trivial reformatting is stable but a genuinely different goal changes it. This binds
 * the founder's request to a specific plan: a plan produced for goal A can never be reused/approved as
 * the answer to goal B. Immutable per request.
 */
export function founderGoalDigest(goal: unknown): string {
  const canon = (typeof goal === "string" ? goal : "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(`founder-goal-v1|${canon}`).digest("hex");
}

/**
 * The idempotency key that de-dupes repeated create requests. It MUST include the goal digest — a new
 * founder instruction (different goal) is a NEW campaign-planning request and must NEVER reuse a prior
 * job. (Incident 2026-07-24: a goal-blind key returned a stale `ready` job created for a different goal
 * on the same URL + budget, presenting an old plan as current + fundable.)
 */
export function idempotencyKey(founderWallet: string, productUrl: string, budgetBase: bigint, goalDigest: string, repoUrl?: string | null): string {
  return createHash("sha256")
    .update(`${founderWallet.toLowerCase()}|${productUrl.trim().toLowerCase()}|${budgetBase.toString()}|${goalDigest}|${(repoUrl ?? "").trim().toLowerCase()}`)
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
  const key = idempotencyKey(input.founderWallet, input.productUrl, input.totalBudgetBase, founderGoalDigest(input.goal), input.repoUrl);
  const existing = getInspectionJobByIdem(key);
  if (existing) {
    // A prior run that FAILED (or stalled on needs_input) + a fresh request → retry it from scratch,
    // so the founder isn't handed the same stale failure ("Try again" that never re-runs). The reset
    // is atomic + terminal-only, so a duplicate submit while a run is in flight is a no-op (returns
    // the in-progress job). created:true makes every caller (web, agent API, concierge) reschedule
    // runInspectionJob. (Re-inspecting a READY url for a second campaign is a separate feature — it
    // needs a fresh campaign slug — so a ready job is still returned as-is here.)
    if (
      (existing.status === "failed" || existing.status === "needs_input") &&
      resetInspectionForRetry(existing.id)
    ) {
      return { job: getInspectionJob(existing.id) as InspectionJob, created: true };
    }
    return { job: existing, created: false };
  }

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

/**
 * Reset a TERMINAL (failed/needs_input) job back to queued for a retry, atomically and
 * ONLY from a terminal state — so a duplicate retry click while a run is already in
 * flight is a no-op. Returns true only when THIS call performed the reset (the caller
 * then schedules the run); false means another run already owns it.
 */
export function resetInspectionForRetry(id: string): boolean {
  const now = nowSeconds();
  const res = db
    .update(inspectionJobs)
    .set({ status: "queued", failureReason: null, updatedAt: now })
    .where(and(eq(inspectionJobs.id, id), inArray(inspectionJobs.status, ["failed", "needs_input"])))
    .run();
  if ((res.changes ?? 0) === 0) return false;
  const cur = getInspectionJob(id);
  if (cur) db.update(inspectionJobs).set({ retryCount: cur.retryCount + 1 }).where(eq(inspectionJobs.id, id)).run();
  return true;
}

/**
 * Fold a founder's ANSWER to a needs_input question into the goal, then reset the job for a re-plan.
 * The clarification becomes trusted architect context (the missing intent Sage asked for), so the
 * re-run designs against it. Atomic + terminal-only (needs_input/failed), like a retry: a duplicate
 * answer while a run is in flight is a no-op. Returns true only when THIS call performed the reset.
 */
export function clarifyInspectionForRetry(id: string, answer: string): boolean {
  const cur = getInspectionJob(id);
  if (!cur) return false;
  const clean = answer.replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!clean) return false;
  const clarified = `${cur.goal}\n\nFounder clarification (answering Sage's question): ${clean}`.slice(0, 4000);
  const res = db
    .update(inspectionJobs)
    .set({ status: "queued", goal: clarified, failureReason: null, updatedAt: nowSeconds() })
    .where(and(eq(inspectionJobs.id, id), inArray(inspectionJobs.status, ["failed", "needs_input"])))
    .run();
  if ((res.changes ?? 0) === 0) return false;
  db.update(inspectionJobs).set({ retryCount: cur.retryCount + 1 }).where(eq(inspectionJobs.id, id)).run();
  return true;
}

/**
 * Transfer an anonymous inspection's ownership to a founder wallet (the plan-claim). Only
 * succeeds when the job is currently owned by "anonymous" OR already by this exact wallet
 * (idempotent resume). If it belongs to a DIFFERENT wallet, it is refused — an anonymous
 * browser can never claim a plan another wallet already owns. Atomic (CAS on the current
 * owner), so two concurrent claims cannot both win.
 */
export function claimInspectionJob(id: string, wallet: string): { ok: boolean; reason?: string } {
  const w = wallet.toLowerCase();
  const cur = getInspectionJob(id);
  if (!cur) return { ok: false, reason: "no_such_job" };
  if (cur.founderWallet === w) return { ok: true }; // already owned by this wallet
  if (cur.founderWallet !== "anonymous") return { ok: false, reason: "already_claimed_by_another_wallet" };
  const res = db
    .update(inspectionJobs)
    .set({ founderWallet: w, updatedAt: nowSeconds() })
    .where(and(eq(inspectionJobs.id, id), eq(inspectionJobs.founderWallet, "anonymous")))
    .run();
  if ((res.changes ?? 0) === 0) return { ok: false, reason: "claim_race_lost" };
  return { ok: true };
}
