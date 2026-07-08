import { NextResponse } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import { getCampaign, getWalletSubmission } from "@/lib/db/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The authenticated wallet's own submission to this campaign, or null. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const wallet = await getSessionAddress();
  if (!wallet) return NextResponse.json({ submission: null, authed: false });
  if (!getCampaign(id)) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  const sub = getWalletSubmission(id, wallet);
  return NextResponse.json({
    authed: true,
    submission: sub
      ? { id: sub.id, status: sub.status, payoutTx: sub.payoutTx, evidenceUrl: sub.evidenceUrl }
      : null,
  });
}
