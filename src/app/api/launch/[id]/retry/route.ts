import { NextResponse, after, type NextRequest } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { getInspectionJob, resetInspectionForRetry } from "@/lib/db/inspection";
import { jobToView, runInspectionJob } from "@/lib/launch/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/launch/<id>/retry — re-run a failed/needs-input inspection. Idempotent by
 * design: the reset happens ONLY from a terminal state, so a duplicate retry click while
 * a run is already in flight is a no-op (never a duplicate concurrent model run).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const job = getInspectionJob(id);
  if (!job) return NextResponse.json({ ok: false, error: "Inspection not found." }, { status: 404 });

  const session = await getSessionAddress();
  const founder = session ?? "anonymous";
  if (job.founderWallet !== founder.toLowerCase() && job.founderWallet !== "anonymous") {
    return NextResponse.json({ ok: false, error: "Not your inspection." }, { status: 403 });
  }

  const didReset = resetInspectionForRetry(id);
  if (didReset) after(() => runInspectionJob(id));

  return NextResponse.json({ ok: true, job: jobToView(getInspectionJob(id)!), retried: didReset });
}
