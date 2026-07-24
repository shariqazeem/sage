import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";

import { db } from "./index";
import { nowSeconds } from "./keys";
import { MISSION_PROMPT_VERSION } from "@/lib/launch/mission-prompt";
import { inspectionJobs, type InspectionJob, type InspectionStatus, type NewInspectionJob } from "./schema";

/** The versioned request-identity schema tag baked into every commitment. */
export const REQUEST_IDENTITY_VERSION = "req-id-v1" as const;

/** Thrown when a request id is reused with a DIFFERENT payload — the request commitment no
 *  longer matches. Fails closed: the caller never gets a plan or a fundable link. */
export class RequestIdentityMismatchError extends Error {
  readonly code = "request_identity_mismatch" as const;
  constructor() {
    super("request_identity_mismatch");
    this.name = "RequestIdentityMismatchError";
  }
}

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
 * The founder's GOAL digest — an EXACT integrity commitment over the stored goal. Only
 * storage-safe normalization is applied: Unicode NFC, CRLF→LF, and boundary trim (the stored
 * goal is itself trimmed by `validateText`, so the trim is consistent). It is deliberately NOT
 * lowercased and NOT whitespace-collapsed — case and internal whitespace are load-bearing for
 * an integrity guarantee: `/Room/A` ≠ `/room/a`, `YaraDev` ≠ `yaradev`, and code/structured
 * text with meaningful whitespace stays distinct. This binds the founder's request to a
 * specific plan: a plan produced for goal A can never be reused/approved as the answer to goal B.
 */
export function founderGoalDigest(goal: unknown): string {
  const canon = (typeof goal === "string" ? goal : "").normalize("NFC").replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(`founder-goal-v2|${canon}`).digest("hex");
}

/**
 * A versioned, canonical, STRUCTURED digest binding every trusted field of a planning request
 * (schema version, surface, actor, planningRequestId, url, repo, goalDigest, budget, token
 * decimals). Reusing a `planningRequestId` with any different field yields a different commitment
 * → the create path fails closed as `request_identity_mismatch`. Structured JSON with a fixed key
 * order (not delimiter concatenation) so no field can be smuggled across a boundary.
 */
export function requestCommitment(input: {
  surface: string;
  actor: string;
  planningRequestId: string;
  productUrl: string;
  repoUrl: string | null;
  goalDigest: string;
  budgetBase: bigint;
  tokenDecimals: number;
}): string {
  const canonical = {
    v: REQUEST_IDENTITY_VERSION,
    surface: input.surface,
    actor: input.actor.toLowerCase(),
    prid: input.planningRequestId,
    url: input.productUrl,
    repo: input.repoUrl ?? "",
    goalDigest: input.goalDigest,
    budgetBase: input.budgetBase.toString(),
    tokenDecimals: input.tokenDecimals,
  };
  return createHash("sha256").update(`req-commit|${JSON.stringify(canonical)}`).digest("hex");
}

/**
 * A DIAGNOSTIC-ONLY content fingerprint (founder + normalized url + budget + exact goal digest).
 * This used to be the idempotency authority; it no longer is — idempotency is request-scoped
 * (see {@link createInspectionJob}). Kept so "same content submitted in a different turn"
 * occurrences remain observable in the row. (Incident 2026-07-24: a goal-blind content key
 * returned a stale `ready` job created for a different goal, presenting an old plan as fundable.)
 */
export function contentFingerprint(founderWallet: string, productUrl: string, budgetBase: bigint, goalDigest: string, repoUrl?: string | null): string {
  return createHash("sha256")
    .update(`${founderWallet.toLowerCase()}|${productUrl.trim().toLowerCase()}|${budgetBase.toString()}|${goalDigest}|${(repoUrl ?? "").trim().toLowerCase()}`)
    .digest("hex");
}

export function getInspectionJob(id: string): InspectionJob | null {
  return db.select().from(inspectionJobs).where(eq(inspectionJobs.id, id)).get() ?? null;
}

/** Look up the one job for a request-scoped id (stored in the unique `idempotency_key` column). */
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
  /** The server-minted, never-LLM-authored request id. THE idempotency authority: one founder
   *  turn → one job. A new turn (new id) with identical content still gets a fresh job. */
  planningRequestId: string;
  /** Trusted surface + actor identity, folded into the request commitment. Default to the
   *  founder namespace when a distinct actor isn't available. */
  surface?: string;
  actor?: string;
}

/**
 * Create (or return the existing idempotent) job — REQUEST-SCOPED. The idempotency authority
 * is `planningRequestId`, not the content: a new founder turn (new id) never reuses a prior
 * job, even when url+goal+budget are byte-for-byte identical. Reusing an id with a DIFFERENT
 * payload fails closed (`RequestIdentityMismatchError`). Returns {job, created}.
 */
export function createInspectionJob(input: CreateInspectionInput): { job: InspectionJob; created: boolean } {
  const key = input.planningRequestId;
  const goalDigest = founderGoalDigest(input.goal);
  const surface = input.surface ?? "unknown";
  const actor = input.actor ?? input.founderWallet;
  const commitment = requestCommitment({
    surface,
    actor,
    planningRequestId: key,
    productUrl: input.productUrl,
    repoUrl: input.repoUrl ?? null,
    goalDigest,
    budgetBase: input.totalBudgetBase,
    tokenDecimals: input.tokenDecimals,
  });

  const existing = getInspectionJobByIdem(key);
  if (existing) {
    // Same request id retried. Verify the payload commitment is unchanged — a reused id with a
    // different payload (forged/mismatched) fails CLOSED, never silently answering the wrong ask.
    if (existing.requestCommitment && existing.requestCommitment !== commitment) {
      throw new RequestIdentityMismatchError();
    }
    // A prior attempt of THIS SAME request that FAILED / stalled on needs_input → retry it from
    // scratch so a same-turn retry isn't handed a stale failure. Atomic + terminal-only, so a
    // duplicate in-flight retry is a no-op (returns the in-progress job). A queued/running/ready
    // job for the same request id is returned as-is (idempotent — no duplicate model run).
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
    planningRequestId: key,
    requestCommitment: commitment,
    founderGoalDigest: goalDigest,
    plannerVersion: MISSION_PROMPT_VERSION,
    contentFingerprint: contentFingerprint(input.founderWallet, input.productUrl, input.totalBudgetBase, goalDigest, input.repoUrl),
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
    // lost an idempotency race — return the row the other request created (same request id).
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
