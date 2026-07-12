import "server-only";

import { createHash } from "node:crypto";
import { getInspectionJob, updateInspectionJob } from "@/lib/db/inspection";
import { createRevision, getApprovedRevision, getCurrentRevision } from "@/lib/db/plan-revisions";
import { inspectAndPlan, type LaunchResult } from "./pipeline";
import type { ValidationScope } from "./validate-mission";
import type { FounderLaunchInput, MissionPlanV1, ProductMapV1 } from "./schemas";
import type { InspectionJob, InspectionStatus } from "@/lib/db/schema";

/** JSON-safe serialization (bigint → string) for durable JSON columns + APIs. */
export function serialize<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}

/**
 * Run one inspection job to completion, persisting REAL stage transitions as the
 * pipeline enters them. On success it stores the result AND creates revision 1 of the
 * durable plan. Never throws — a failure is a `failed` status with a sanitized reason.
 */
export async function runInspectionJob(jobId: string): Promise<void> {
  const job = getInspectionJob(jobId);
  if (!job || (job.status !== "queued" && job.status !== "needs_input" && job.status !== "failed")) return;

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
      updateInspectionJob(jobId, stage as InspectionStatus, {});
    });

    const serialized = serialize(result);
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

    // durable revision 1 — the generated plan (only when none exists yet).
    if (result.stage === "ready" && result.plan && !getCurrentRevision(jobId)) {
      createRevision({
        jobId,
        authorWallet: job.founderWallet,
        reason: "generated",
        plan: result.plan,
        budgetBase: result.plan.totalBudgetBase,
        validationOk: true,
        model: result.brain?.model,
        provider: result.brain?.provider,
      });
    }
  } catch (err) {
    updateInspectionJob(jobId, "failed", { failureReason: (err instanceof Error ? err.message : "inspection error").slice(0, 200) });
  }
}

/* ─────────────────────────────────────────── validation scope ───────────── */

/** Reconstruct the inspected scope (URLs + hosts) from a job's stored product map. */
export function scopeForJob(job: InspectionJob): ValidationScope {
  const knownUrls = new Set<string>();
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(job.productUrl).host.toLowerCase());
    knownUrls.add(new URL(job.productUrl).origin + "/");
  } catch { /* skip */ }
  const map = (job.result as { map?: ProductMapV1 } | null)?.map;
  if (map) {
    const findings = [...map.routes, ...map.browserConfirmed, ...map.interactiveSurfaces, ...map.trustSurfaces];
    for (const f of findings) {
      for (const s of f.sources ?? []) {
        if (s.kind === "page" && s.ref) {
          knownUrls.add(s.ref);
          try { hosts.add(new URL(s.ref).host.toLowerCase()); } catch { /* skip */ }
        }
      }
    }
  }
  return { knownUrls, hosts, repoPaths: new Set() };
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
  /** inspection output: the product map + questions (bigints stringified). */
  result: { map: unknown; questions: string[]; reason: string | null } | null;
  /** the CURRENT revision's plan snapshot (serialized), or null. */
  plan: unknown;
  revision: number;
  /** durable approval, when the current revision is approved. */
  approval: { approvedAt: number; revision: number; campaignIdHash: string; missionPlanDigest: string } | null;
  createdAt: number;
  updatedAt: number;
}

export function jobToView(job: InspectionJob): JobView {
  const current = getCurrentRevision(job.id);
  const approvedRow = getApprovedRevision(job.id);
  const res = job.result as { map?: unknown; questions?: string[]; reason?: string | null } | null;
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
    result: res ? { map: res.map ?? null, questions: res.questions ?? [], reason: res.reason ?? null } : null,
    plan: current ? current.planJson : ((res as { plan?: unknown } | null)?.plan ?? null),
    revision: current?.revisionNumber ?? 0,
    approval:
      approvedRow && approvedRow.approvedAt != null
        ? { approvedAt: approvedRow.approvedAt, revision: approvedRow.revisionNumber, campaignIdHash: approvedRow.campaignIdHash, missionPlanDigest: approvedRow.missionPlanDigest }
        : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export type { MissionPlanV1 };
