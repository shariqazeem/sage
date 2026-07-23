import { NextResponse, type NextRequest } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { getInspectionJob } from "@/lib/db/inspection";
import { approveRevision, getCurrentRevision } from "@/lib/db/plan-revisions";
import { jobToView } from "@/lib/launch/job";
import { deserializePlan } from "@/lib/launch/serde";
import { verifyPlanForApproval } from "@/lib/launch/approve";
import { verificationPolicyDigest } from "@/lib/launch/mission-probe";
import { MISSION_PROMPT_VERSION } from "@/lib/launch/mission-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/launch/<id>/approve — durable founder approval. The server RECOMPUTES every
 * canonical hash + exact budget from the plan's own missions and only records approval
 * if they reproduce and the revision is current (not stale). Returns the canonical
 * DeploymentReadyPlan, exactly compatible with the CampaignVaultV2 setup. No deploy.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const job = getInspectionJob(id);
  if (!job) return NextResponse.json({ ok: false, error: "Inspection not found." }, { status: 404 });
  if (job.status !== "ready") return NextResponse.json({ ok: false, error: "This inspection has no approvable plan." }, { status: 409 });

  const session = await getSessionAddress();
  const founder = session ?? "anonymous";
  if (job.founderWallet !== founder.toLowerCase() && job.founderWallet !== "anonymous") {
    return NextResponse.json({ ok: false, error: "Not your inspection." }, { status: 403 });
  }

  const current = getCurrentRevision(id);
  if (!current) return NextResponse.json({ ok: false, error: "No plan to approve." }, { status: 409 });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* body optional */ }
  if (typeof body.expectedRevision === "number" && body.expectedRevision !== current.revisionNumber) {
    return NextResponse.json({ ok: false, error: "This plan changed — reload before approving.", currentRevision: current.revisionNumber }, { status: 409 });
  }

  // recompute + verify every hash + exact budget — trust nothing stored.
  const verified = verifyPlanForApproval(deserializePlan(current.planJson), {
    approver: founder, model: current.model, provider: current.provider, promptVersion: MISSION_PROMPT_VERSION,
  });
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.error, mismatches: verified.mismatches }, { status: 409 });
  }

  // Phase 3 — if the selected (grounded) plan carries a VerificationPolicyV1, RECOMPUTE + VERIFY its digest as
  // part of approval, and bind it into the immutable approval record. A tampered policy fails closed here.
  let approvalRecord: unknown = verified.approvalRecord;
  const policy = (job.result as { canary?: { verificationPolicy?: { policyDigest?: string } | null } } | null)?.canary?.verificationPolicy ?? null;
  if (policy && typeof policy === "object") {
    const recomputed = verificationPolicyDigest(policy as Parameters<typeof verificationPolicyDigest>[0]);
    if (recomputed !== policy.policyDigest) {
      return NextResponse.json({ ok: false, error: "verification policy digest mismatch — refusing approval." }, { status: 409 });
    }
    approvalRecord = { ...(verified.approvalRecord as Record<string, unknown>), verificationPolicyDigest: recomputed, verificationPolicy: policy };
  }

  const approved = approveRevision(id, current.revisionNumber, founder, approvalRecord);
  if (!approved.ok) return NextResponse.json({ ok: false, error: approved.reason }, { status: 409 });

  return NextResponse.json({ ok: true, job: jobToView(getInspectionJob(id)!), deploymentReadyPlan: verified.deploymentReadyPlan });
}
