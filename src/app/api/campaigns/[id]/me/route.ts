import { NextResponse, type NextRequest } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import {
  getCampaign,
  getDecisionBySubmission,
  getWalletSubmission,
  getWalletMissionSubmission,
  listCampaignEvents,
} from "@/lib/db/campaigns";
import { briefFromRow } from "@/lib/deputy/decisions";
import { decodeDetail } from "@/lib/campaigns/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The latest autonomous outcome for one submission (events are newest-first). */
function ownAutopay(
  campaignId: string,
  submissionId: string,
): { state: "settled" | "held"; reason: string | null } | null {
  for (const e of listCampaignEvents(campaignId)) {
    if (e.submissionId !== submissionId) continue;
    if (e.kind !== "autopay_settled" && e.kind !== "autopay_held") continue;
    const text = decodeDetail(e.detail).text ?? "";
    const parts = text.split(" · ");
    return {
      state: e.kind === "autopay_settled" ? "settled" : "held",
      reason:
        e.kind === "autopay_held"
          ? parts.length > 1
            ? parts.slice(1).join(" · ")
            : text
          : null,
    };
  }
  return null;
}

/**
 * The authenticated wallet's OWN submission to this campaign, or null — now with
 * its decision brief + autonomous outcome so the worker watches the Deputy verify
 * and pay their own entry live. Own-scope ONLY: no other submitter's note, wallet,
 * or brief is ever exposed here.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const wallet = await getSessionAddress();
  if (!wallet) return NextResponse.json({ submission: null, authed: false });
  if (!getCampaign(id)) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  // V2: a wallet's submission is scoped to a mission (?mission=<missionIdHash>). Without it,
  // the campaign-level (V1) submission is returned — backward compatible.
  const mission = req.nextUrl.searchParams.get("mission");
  const sub = mission ? getWalletMissionSubmission(mission, wallet) : getWalletSubmission(id, wallet);
  if (!sub) return NextResponse.json({ authed: true, submission: null });

  const stored = getDecisionBySubmission(sub.id);
  return NextResponse.json({
    authed: true,
    submission: {
      id: sub.id,
      status: sub.status,
      payoutTx: sub.payoutTx,
      evidenceUrl: sub.evidenceUrl,
      brief: stored ? briefFromRow(stored) : null,
      autopay: ownAutopay(id, sub.id),
    },
  });
}
