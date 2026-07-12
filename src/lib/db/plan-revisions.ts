import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { nowSeconds } from "./keys";
import { planRevisions, type PlanRevision } from "./schema";
import type { MissionPlanV1 } from "@/lib/launch/schemas";

/**
 * Durable plan-revision accessors. Revision 1 is the generated plan; every edit /
 * rebalance / regeneration is a new revision (prior ones stay readable). Approval sets
 * an immutable flag on a snapshot, and only ONE revision is the active approved one.
 * Optimistic concurrency is enforced by the caller passing the expected revision number.
 */

function planToJson(plan: MissionPlanV1): unknown {
  return JSON.parse(JSON.stringify(plan, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export function getCurrentRevision(jobId: string): PlanRevision | null {
  return (
    db.select().from(planRevisions).where(eq(planRevisions.jobId, jobId)).orderBy(desc(planRevisions.revisionNumber)).get() ?? null
  );
}

export function getRevisionByNumber(jobId: string, n: number): PlanRevision | null {
  return db.select().from(planRevisions).where(and(eq(planRevisions.jobId, jobId), eq(planRevisions.revisionNumber, n))).get() ?? null;
}

export function getApprovedRevision(jobId: string): PlanRevision | null {
  return (
    db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.jobId, jobId), isNull(planRevisions.supersededAt)))
      .orderBy(desc(planRevisions.revisionNumber))
      .all()
      .find((r) => r.approvedAt != null) ?? null
  );
}

export function listRevisions(jobId: string): PlanRevision[] {
  return db.select().from(planRevisions).where(eq(planRevisions.jobId, jobId)).orderBy(desc(planRevisions.revisionNumber)).all();
}

export interface CreateRevisionInput {
  jobId: string;
  authorWallet: string;
  reason: string;
  plan: MissionPlanV1;
  budgetBase: bigint;
  validationOk: boolean;
  model?: string | null;
  provider?: string | null;
}

/**
 * Create the next revision. Supersedes the previous CURRENT revision (so exactly one is
 * active), and returns the new row. The plan snapshot already carries every canonical
 * hash + exact economics, so this is the durable source of truth for the plan.
 */
export function createRevision(input: CreateRevisionInput): PlanRevision {
  const now = nowSeconds();
  const prev = getCurrentRevision(input.jobId);
  const revisionNumber = (prev?.revisionNumber ?? 0) + 1;
  const id = nanoid(14);
  db.transaction((t) => {
    if (prev && prev.supersededAt == null) {
      t.update(planRevisions).set({ supersededAt: now }).where(eq(planRevisions.id, prev.id)).run();
    }
    t.insert(planRevisions)
      .values({
        id,
        jobId: input.jobId,
        revisionNumber,
        parentRevisionId: prev?.id ?? null,
        authorWallet: input.authorWallet.toLowerCase(),
        reason: input.reason,
        productMapDigest: input.plan.productMapDigest,
        planJson: planToJson(input.plan),
        budgetBase: Number(input.budgetBase),
        validationOk: input.validationOk,
        campaignIdHash: input.plan.campaignIdHash,
        missionPlanDigest: input.plan.missionPlanDigest,
        model: input.model ?? null,
        provider: input.provider ?? null,
        createdAt: now,
      })
      .run();
  });
  return getRevisionByNumber(input.jobId, revisionNumber) as PlanRevision;
}

/**
 * Approve a revision transactionally. Fails (returns false) if it is stale (not the
 * current revision), already superseded, or not the latest — the caller has already
 * recomputed + verified the hashes. Supersedes any other active approval so only one
 * approved revision is ever active.
 */
export function approveRevision(
  jobId: string,
  revisionNumber: number,
  approverWallet: string,
  approvalRecord: unknown,
): { ok: boolean; reason?: string; revision?: PlanRevision } {
  const current = getCurrentRevision(jobId);
  if (!current) return { ok: false, reason: "no revision to approve" };
  if (current.revisionNumber !== revisionNumber) return { ok: false, reason: "stale revision — reload and try again" };
  if (current.approvedAt != null) return { ok: true, revision: current }; // idempotent
  const now = nowSeconds();
  db.transaction((t) => {
    // supersede any prior active approval (only one active approved allowed).
    for (const r of listRevisions(jobId)) {
      if (r.id !== current.id && r.approvedAt != null && r.supersededAt == null) {
        t.update(planRevisions).set({ supersededAt: now }).where(eq(planRevisions.id, r.id)).run();
      }
    }
    t.update(planRevisions)
      .set({ approvedAt: now, approverWallet: approverWallet.toLowerCase(), approvalRecord })
      .where(and(eq(planRevisions.id, current.id), isNull(planRevisions.approvedAt)))
      .run();
  });
  return { ok: true, revision: getRevisionByNumber(jobId, revisionNumber) as PlanRevision };
}
