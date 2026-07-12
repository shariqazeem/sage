import "server-only";

import { createHash } from "node:crypto";
import { getInspectionJob, updateInspectionJob } from "@/lib/db/inspection";
import { inspectAndPlan, type LaunchResult } from "./pipeline";
import type { FounderLaunchInput } from "./schemas";
import type { InspectionJob, InspectionStatus } from "@/lib/db/schema";

/** JSON-safe serialization (bigint → string) for the durable `result` column + APIs. */
export function serializeResult(r: LaunchResult): unknown {
  return JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/**
 * Run one inspection job to completion, persisting REAL stage transitions as the
 * pipeline enters them (never a timer). Loads the job, runs the vertical slice, stores
 * the map digest + provenance + the whole result. Never throws — a failure is recorded
 * as a `failed` status with a sanitized reason so the founder sees an honest state.
 */
export async function runInspectionJob(jobId: string): Promise<void> {
  const job = getInspectionJob(jobId);
  if (!job || (job.status !== "queued" && job.status !== "needs_input")) return;

  const input: FounderLaunchInput = {
    productUrl: job.productUrl,
    repoUrl: job.repoUrl,
    goal: job.goal,
    targetUsers: job.targetUsers,
    totalBudgetBase: BigInt(job.totalBudgetBase),
    tokenDecimals: job.tokenDecimals,
  };

  try {
    const result = await inspectAndPlan(input, job.publicCampaignId, (stage) => {
      // persist each REAL stage as the pipeline enters it.
      updateInspectionJob(jobId, stage as InspectionStatus, {});
    });

    const serialized = serializeResult(result);
    const outputDigest = createHash("sha256").update(JSON.stringify(serialized)).digest("hex");
    updateInspectionJob(jobId, result.stage as InspectionStatus, {
      result: serialized,
      productMapDigest: result.map?.digest ?? null,
      pagesInspected: result.map?.pagesInspected ?? 0,
      repoFilesInspected: result.map?.repoFilesInspected ?? 0,
      model: result.brain?.model || null,
      provider: result.brain?.provider || null,
      promptVersion: result.brain?.promptVersion || null,
      revision: result.plan?.revision ?? 0,
      failureReason: result.stage === "failed" ? (result.reason ?? "inspection failed") : null,
      outputDigest,
    });
  } catch (err) {
    updateInspectionJob(jobId, "failed", {
      failureReason: (err instanceof Error ? err.message : "inspection error").slice(0, 200),
    });
  }
}

/* ─────────────────────────────────────────── client-safe view ───────────── */

export interface JobView {
  id: string;
  status: InspectionStatus;
  productUrl: string;
  goal: string;
  totalBudgetBase: string;
  tokenDecimals: number;
  pagesInspected: number;
  repoFilesInspected: number;
  model: string | null;
  provider: string | null;
  failureReason: string | null;
  /** the serialized LaunchResult (bigints already stringified), or null. */
  result: unknown;
  createdAt: number;
  updatedAt: number;
}

export function jobToView(job: InspectionJob): JobView {
  return {
    id: job.id,
    status: job.status,
    productUrl: job.productUrl,
    goal: job.goal,
    totalBudgetBase: String(job.totalBudgetBase),
    tokenDecimals: job.tokenDecimals,
    pagesInspected: job.pagesInspected,
    repoFilesInspected: job.repoFilesInspected,
    model: job.model,
    provider: job.provider,
    failureReason: job.failureReason,
    result: job.result ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
