import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { ownsCampaign } from "@/lib/campaigns/review-actions";
import { getCampaign } from "@/lib/db/campaigns";
import { seatLinkFor } from "@/lib/people/link-info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { campaignId } — the job's own link for its people (minted once, the same link after), how many
 * have joined, and the message to send. Owner only: the link admits people to the founder's work, so only
 * the founder can hand it out. On every plan (6 Nov 2026); the lasting team, with roles, is still Pro.
 */
export async function POST(req: NextRequest) {
  const session = await getFounderAddress();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { campaignId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const id = typeof body.campaignId === "string" ? body.campaignId.trim() : "";
  const campaign = id ? getCampaign(id) : null;
  if (!campaign) return NextResponse.json({ error: "That job wasn't found." }, { status: 404 });
  if (!ownsCampaign(campaign, session)) return NextResponse.json({ error: "Only the job's own founder can send its link." }, { status: 403 });
  // A link is for work for the founder's own people. A public job's board is its door, and a named list
  // grown from a link would lock everyone else out of it.
  const named = Array.isArray(campaign.allowlist) && campaign.allowlist.length > 0;
  if (campaign.visibility !== "unlisted" && !named) {
    return NextResponse.json({ error: "This job is open to anyone: its page is the link to send." }, { status: 409 });
  }
  if (campaign.status !== "live" && campaign.status !== "draft") {
    return NextResponse.json({ error: `This job is ${campaign.status}: there is nothing to send people to.` }, { status: 409 });
  }
  return NextResponse.json({ ok: true, link: seatLinkFor(campaign, session) });
}
