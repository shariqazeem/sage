import { NextResponse, after, type NextRequest } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { clarifyInspectionForRetry, getInspectionJob } from "@/lib/db/inspection";
import { jobToView, runInspectionJob } from "@/lib/launch/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/launch/<id>/clarify — the founder ANSWERS a needs_input question. Sage folds the answer
 * into the goal and re-plans. Idempotent by design: the reset happens ONLY from a terminal state, so
 * a duplicate answer while a run is already in flight is a no-op.
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

  let answer = "";
  try {
    answer = String(((await req.json()) as { answer?: unknown }).answer ?? "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!answer) return NextResponse.json({ ok: false, error: "An answer is required." }, { status: 400 });

  const didReset = clarifyInspectionForRetry(id, answer);
  if (didReset) after(() => runInspectionJob(id));

  return NextResponse.json({ ok: true, job: jobToView(getInspectionJob(id)!), replanned: didReset });
}
