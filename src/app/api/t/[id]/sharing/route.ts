import { NextResponse, type NextRequest } from "next/server";

import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { ownsCampaign } from "@/lib/campaigns/review-actions";
import { getCampaign } from "@/lib/db/campaigns";
import { getInspectionJob } from "@/lib/db/inspection";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { setSharing } from "@/lib/sharing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/t/<id>/sharing  { postMission?, postResult?, findingsPublic? }
 *
 * The builder's answers about their own test: may Sage share the mission, may it post the result, are
 * the findings public. `<id>` is the test's id at either stage. Before it is paid for, the answers are
 * kept under the id the test will have once it is live, and only the plan's signed-in owner may give
 * them; afterwards only the test's owner. A field that is missing or not a boolean changes nothing.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const rl = rateLimit("submit", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const { id } = await ctx.params;
  const session = await getFounderAddress();
  if (!session) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  let campaignId: string | null = null;
  const campaign = getCampaign(id);
  if (campaign) {
    if (!ownsCampaign(campaign, session)) return NextResponse.json({ ok: false, error: "Only the test's owner can change how it is shared." }, { status: 403 });
    campaignId = campaign.id;
  } else {
    const job = getInspectionJob(id);
    if (!job) return NextResponse.json({ ok: false, error: "Test not found." }, { status: 404 });
    if (!sameFounder(job.founderWallet, session)) return NextResponse.json({ ok: false, error: "Only the test's owner can change how it is shared." }, { status: 403 });
    // a live test is its own row above; this plan's answers wait under the id it will launch as
    const launched = getCampaign(job.publicCampaignId);
    if (launched && !ownsCampaign(launched, session)) return NextResponse.json({ ok: false, error: "Only the test's owner can change how it is shared." }, { status: 403 });
    campaignId = job.publicCampaignId;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 });
  }
  const sharing = setSharing(campaignId, {
    ...(typeof body.postMission === "boolean" ? { postMission: body.postMission } : {}),
    ...(typeof body.postResult === "boolean" ? { postResult: body.postResult } : {}),
    ...(typeof body.findingsPublic === "boolean" ? { findingsPublic: body.findingsPublic } : {}),
  });
  return NextResponse.json({ ok: true, sharing });
}
