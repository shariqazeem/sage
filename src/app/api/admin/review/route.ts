import { NextResponse, type NextRequest } from "next/server";
import { getCampaign, getSubmission } from "@/lib/db/campaigns";
import {
  listHeldSubmissions,
  releaseSubmission,
  rejectSubmission,
} from "@/lib/campaigns/review-actions";
import { autonomousResolutionStats } from "@/lib/campaigns/held-triage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Operator backstop for reviewing HELD work out-of-band from Telegram (scripts/review.mjs). It
 * reuses the SAME releaseSubmission the chat tools + decide route use — no money logic lives here,
 * and a release lands in the proven settle path. Gated on SAGE_ADMIN_SECRET: fail-closed (404)
 * when unset, exactly like the deputy sweep. Not the model's; this is the human operator's.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.SAGE_ADMIN_SECRET?.trim();
  if (!secret) return false; // no secret configured → endpoint is off
  const header = req.headers.get("x-sage-admin-secret")?.trim();
  return !!header && header === secret;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: { action?: string; campaignId?: string; submissionId?: string; why?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.action === "list") {
    const campaign = getCampaign(body.campaignId ?? "");
    if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    return NextResponse.json({ ok: true, held: listHeldSubmissions(campaign), autonomy: autonomousResolutionStats(campaign.id) });
  }

  if (body.action === "reject") {
    const submission = getSubmission(body.submissionId ?? "");
    if (!submission) return NextResponse.json({ error: "submission not found" }, { status: 404 });
    const res = rejectSubmission(submission.campaignId, submission.id, body.why);
    return NextResponse.json(res, { status: res.ok ? 200 : 409 });
  }

  if (body.action === "release") {
    const submission = getSubmission(body.submissionId ?? "");
    if (!submission) return NextResponse.json({ error: "submission not found" }, { status: 404 });
    const res = await releaseSubmission(submission.campaignId, submission.id);
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  }

  return NextResponse.json({ error: "action must be list | release | reject" }, { status: 400 });
}
