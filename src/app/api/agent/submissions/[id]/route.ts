import { NextResponse, type NextRequest } from "next/server";

import { authenticateAgent } from "@/lib/agent-api/auth";
import { getSubmission, getDecisionBySubmission } from "@/lib/db/campaigns";
import { briefFromRow } from "@/lib/deputy/decisions";
import { submissionState } from "@/lib/agent-api/views";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/submissions/[id] — one tester submission's status for the ClawUp agent:
 * reviewing / verified / held / paid, the Deputy's confidence + reason code, and a proof
 * link once paid. Read-only; no evidence content, no founder-private data.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = authenticateAgent(req);
  if (!auth.ok) return auth.res;

  const { id } = await ctx.params;
  const sub = getSubmission(id);
  if (!sub) return NextResponse.json({ ok: false, error: "Submission not found." }, { status: 404 });

  const decision = getDecisionBySubmission(id);
  const brief = decision ? briefFromRow(decision) : null;
  const state = submissionState(sub, brief);
  const base = siteUrl();

  return NextResponse.json({
    ok: true,
    submissionId: id,
    campaignId: sub.campaignId,
    state,
    confidence: brief?.confidence ?? null,
    reason: brief?.reasonCode ?? null,
    payoutTx: state === "paid" ? sub.payoutTx : null,
    proofUrl: state === "paid" && sub.payoutTx ? `${base}/proof/${sub.payoutTx}` : null,
  });
}
