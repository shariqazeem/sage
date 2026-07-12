import { NextResponse, type NextRequest } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { validateRewardUsd } from "@/lib/campaigns/validate";
import { getInspectionJob } from "@/lib/db/inspection";
import { createRevision, getCurrentRevision } from "@/lib/db/plan-revisions";
import { jobToView, scopeForJob } from "@/lib/launch/job";
import { deserializePlan } from "@/lib/launch/serde";
import { revisePlan, type MissionEdit } from "@/lib/launch/revise";
import { MISSION_PROMPT_VERSION } from "@/lib/launch/mission-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/launch/<id>/revise — apply founder edits, re-validate + re-allocate + re-
 * compile into a NEW durable revision. Optimistic concurrency: a stale `expectedRevision`
 * is rejected. Never approves; an unsafe/out-of-scope edit returns per-mission issues.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const job = getInspectionJob(id);
  if (!job) return NextResponse.json({ ok: false, error: "Inspection not found." }, { status: 404 });

  const session = await getSessionAddress();
  const founder = session ?? "anonymous";
  if (job.founderWallet !== founder.toLowerCase() && job.founderWallet !== "anonymous") {
    return NextResponse.json({ ok: false, error: "Not your inspection." }, { status: 403 });
  }

  const current = getCurrentRevision(id);
  if (!current) return NextResponse.json({ ok: false, error: "No plan to edit yet." }, { status: 409 });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 }); }

  if (typeof body.expectedRevision === "number" && body.expectedRevision !== current.revisionNumber) {
    return NextResponse.json({ ok: false, error: "This plan changed in another tab — reload to see the latest.", currentRevision: current.revisionNumber }, { status: 409 });
  }

  const edits = (Array.isArray(body.edits) ? body.edits : []) as MissionEdit[];
  let newBudgetBase: bigint | undefined;
  if (body.newBudgetUsd != null) {
    const b = validateRewardUsd(body.newBudgetUsd);
    if (!b.ok) return NextResponse.json({ ok: false, error: `Budget: ${b.error}` }, { status: 400 });
    newBudgetBase = BigInt(b.value);
  }

  const result = revisePlan(deserializePlan(current.planJson), edits, {
    scope: scopeForJob(job),
    productMapDigest: (current.productMapDigest ?? `0x${"0".repeat(64)}`) as `0x${string}`,
    model: current.model,
    provider: current.provider,
    promptVersion: MISSION_PROMPT_VERSION,
    revision: current.revisionNumber + 1,
    newBudgetBase,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Some edits could not be saved.", issues: result.issues }, { status: 400 });
  }

  createRevision({
    jobId: id,
    authorWallet: founder,
    reason: newBudgetBase ? "rebalance" : "edit",
    plan: result.plan,
    budgetBase: result.plan.totalBudgetBase,
    validationOk: true,
    model: current.model,
    provider: current.provider,
  });

  return NextResponse.json({ ok: true, job: jobToView(getInspectionJob(id)!) });
}
