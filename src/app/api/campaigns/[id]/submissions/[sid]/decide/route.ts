import { NextResponse, type NextRequest } from "next/server";
import { getSessionAddress, isSameWallet } from "@/lib/auth/session";
import { canDecide, type SubmissionStatus } from "@/lib/campaigns/status";
import { settleApprovedSubmission } from "@/lib/campaigns/settle-flow";
import { nowSeconds } from "@/lib/db/keys";
import { short } from "@/lib/format";
import {
  getCampaign,
  getSubmission,
  recordEvent,
  updateSubmission,
} from "@/lib/db/campaigns";

// Real chain writes on approve — never cached, Node runtime, longer budget for
// the queue→execute→requestSpend cascade.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The poster reviews one submission. Reject records the reason. Approve runs the
 * settle cascade for real: ensure the recipient is an allowlisted vendor, then
 * release the reward with the operator key. On a settled spend the submission
 * becomes `paid` with its payout tx, and the response carries a public proof URL.
 * Only the campaign's poster may decide, and only a `pending` submission.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; sid: string }> },
) {
  const { id, sid } = await ctx.params;

  const wallet = await getSessionAddress();
  if (!wallet) {
    return NextResponse.json({ error: "Sign in to review submissions." }, { status: 401 });
  }

  const campaign = getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (!isSameWallet(wallet, campaign.posterWallet)) {
    return NextResponse.json(
      { error: "Only the campaign poster can review submissions." },
      { status: 403 },
    );
  }

  const submission = getSubmission(sid);
  if (!submission || submission.campaignId !== id) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }
  if (!canDecide(submission.status as SubmissionStatus)) {
    return NextResponse.json(
      { error: "This submission was already decided." },
      { status: 409 },
    );
  }

  let body: { decision?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  /* ── reject ─────────────────────────────────────────────────────────── */
  if (body.decision === "reject") {
    const reason =
      typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : null;
    updateSubmission(sid, {
      status: "rejected",
      rejectReason: reason,
      decidedAt: nowSeconds(),
    });
    recordEvent({
      campaignId: id,
      submissionId: sid,
      kind: "submission_rejected",
      detail: short(submission.wallet),
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  if (body.decision !== "approve") {
    return NextResponse.json(
      { error: "decision must be 'approve' or 'reject'." },
      { status: 400 },
    );
  }

  /* ── approve → settle cascade ───────────────────────────────────────── */
  updateSubmission(sid, { status: "approved", decidedAt: nowSeconds() });
  recordEvent({
    campaignId: id,
    submissionId: sid,
    kind: "submission_approved",
    detail: short(submission.wallet),
  });

  let result;
  try {
    result = await settleApprovedSubmission(campaign, submission);
  } catch (err) {
    console.error("[campaigns/decide] settle failed:", err);
    return NextResponse.json(
      { error: "On-chain settlement failed. The submission is approved; retry to settle." },
      { status: 502 },
    );
  }
  const { outcome, vault } = result;

  return NextResponse.json({
    ok: true,
    status: outcome.settled ? "paid" : "approved",
    settled: outcome.settled,
    txHash: outcome.txHash,
    explorerUrl: outcome.explorerUrl,
    reason: outcome.reason,
    needsOwnerAdd: outcome.needsOwnerAdd,
    recipient: outcome.recipient,
    proofUrl: outcome.txHash ? `/proof/${outcome.txHash}` : null,
    vault,
  });
}
