import { NextResponse } from "next/server";
import { after } from "next/server";

import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { getInspectionJob } from "@/lib/db/inspection";
import { jobToView, reapStalledJob, runInspectionJob } from "@/lib/launch/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/launch/<id> — the durable job's current status + (when ready) the plan. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const job = getInspectionJob(id);
  if (!job) return NextResponse.json({ ok: false, error: "Inspection not found." }, { status: 404 });
  // A runner killed mid-flight (deploy restart) leaves the job showing its last stage forever while
  // the founder watches "Sage is working". The status poll is the heartbeat that always fires, so it
  // reaps: an honestly-failed job with retries left resumes (prior observations are carried), one
  // without shows a real failure the retry button can act on.
  const reaped = reapStalledJob(job);
  if (reaped === "retrying") after(() => runInspectionJob(id));
  const fresh = reaped ? (getInspectionJob(id) ?? job) : job;

  /**
   * Whose job this is, RELATIVE TO THE CALLER — never the owner's address.
   *
   * The plan itself stays readable by anyone holding the link, which is deliberate: a founder is
   * told it is a permanent link they can come back to and share. This only answers "is this mine",
   * so a browser can stop listing a job that belongs to somebody else's wallet under the heading
   * "Your inspections". It says nothing a caller could not already infer by trying to act on it.
   */
  const caller = await getFounderAddress();
  const ownership: "yours" | "anonymous" | "other" =
    fresh.founderWallet === "anonymous"
      ? "anonymous"
      : caller && sameFounder(fresh.founderWallet, caller)
        ? "yours"
        : "other";

  return NextResponse.json({ ok: true, job: jobToView(fresh), ownership });
}
