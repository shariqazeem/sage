import { NextResponse, type NextRequest } from "next/server";
import { getSessionAddress, isSameWallet } from "@/lib/auth/session";
import { settleApprovedSubmission } from "@/lib/campaigns/settle-flow";
import { getCampaign, getSubmission } from "@/lib/db/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Settle an already-approved submission. This is the founder-vault re-fire: after
 * the poster (the vault owner) allowlists the recipient client-side, the operator
 * can finally release the reward. Also the unit the "Settle all approved" batch
 * calls per submission. Poster-gated; only valid on an `approved` (unpaid) row.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; sid: string }> },
) {
  const { id, sid } = await ctx.params;

  const wallet = await getSessionAddress();
  if (!wallet) {
    return NextResponse.json({ error: "Sign in to settle." }, { status: 401 });
  }

  const campaign = getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (!isSameWallet(wallet, campaign.posterWallet)) {
    return NextResponse.json(
      { error: "Only the campaign poster can settle." },
      { status: 403 },
    );
  }

  const submission = getSubmission(sid);
  if (!submission || submission.campaignId !== id) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }
  if (submission.status !== "approved") {
    return NextResponse.json(
      { error: "Only an approved, unsettled submission can be settled." },
      { status: 409 },
    );
  }

  let result;
  try {
    result = await settleApprovedSubmission(campaign, submission);
  } catch (err) {
    console.error("[campaigns/settle] failed:", err);
    return NextResponse.json(
      { error: "On-chain settlement failed. Retry to settle." },
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
