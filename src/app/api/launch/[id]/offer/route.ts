import { NextResponse, type NextRequest } from "next/server";

import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { getInspectionJob } from "@/lib/db/inspection";
import { jobToView } from "@/lib/launch/job";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { applyOffer } from "@/lib/test-page/offer-apply";
import { usdToBase } from "@/lib/test-page/offer-shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/launch/<id>/offer  { people, eachUsd, inviteOnly?, expectedRevision? }
 *
 * The offer card's two decisions: how many people, and what each earns. The plan is recompiled by the
 * budget compiler with no model (`offerPlan`), saved as the next revision, and answered as the job.
 * `inviteOnly` keeps the test off every public list, for people the builder sends its link to.
 *
 * The plan's owner only, exactly as for an edit: a plan nobody owns yet (a handover) may be priced by
 * whoever holds its link, and a plan filed under an X account or another wallet may not.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const rl = rateLimit("submit", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many changes at once. Try again in a moment." }, { status: 429 });
  const { id } = await ctx.params;
  const job = getInspectionJob(id);
  if (!job) return NextResponse.json({ ok: false, error: "Test not found." }, { status: 404 });

  const session = await getFounderAddress();
  const founder = session ?? "anonymous";
  if (!sameFounder(job.founderWallet, founder) && job.founderWallet !== "anonymous") {
    return NextResponse.json({ ok: false, error: "Only the person who started this test can change it." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 });
  }
  const people = typeof body.people === "number" ? body.people : NaN;
  const eachBase = typeof body.eachUsd === "string" || typeof body.eachUsd === "number" ? usdToBase(body.eachUsd) : null;
  if (!Number.isInteger(people)) return NextResponse.json({ ok: false, error: "Choose how many people." }, { status: 400 });
  if (eachBase === null) return NextResponse.json({ ok: false, error: "Use dollars and whole cents, like 2.50." }, { status: 400 });

  const r = applyOffer(job, founder, {
    people,
    eachBase,
    inviteOnly: typeof body.inviteOnly === "boolean" ? body.inviteOnly : undefined,
    expectedRevision: typeof body.expectedRevision === "number" ? body.expectedRevision : undefined,
  });
  const view = jobToView(getInspectionJob(id)!);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, job: view }, { status: r.status });
  return NextResponse.json({ ok: true, changed: r.changed, job: view });
}
