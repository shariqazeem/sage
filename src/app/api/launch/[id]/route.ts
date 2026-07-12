import { NextResponse } from "next/server";

import { getInspectionJob } from "@/lib/db/inspection";
import { jobToView } from "@/lib/launch/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/launch/<id> — the durable job's current status + (when ready) the plan. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const job = getInspectionJob(id);
  if (!job) return NextResponse.json({ ok: false, error: "Inspection not found." }, { status: 404 });
  return NextResponse.json({ ok: true, job: jobToView(job) });
}
