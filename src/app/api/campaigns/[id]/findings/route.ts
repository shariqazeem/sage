import { NextResponse, after } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { ownsCampaign } from "@/lib/campaigns/review-actions";
import { getCampaign } from "@/lib/db/campaigns";
import { openFindings } from "@/lib/report";
import { sharingFor } from "@/lib/sharing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/campaigns/[id]/findings: "What N people found".
 *
 * The owner always reads it, with the contacts of the people who asked to hear back. Anyone else
 * reads it only when the owner made the findings public, and then without any contact. Otherwise
 * the answer is 404, the same as a test that doesn't exist. The shape is `FindingsView`
 * (src/lib/report/index.ts). The owner's visit queues a fresh build when one is due; the read never
 * waits on it (`rebuilding` says to ask again).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!campaign) return notFound();
  const owner = ownsCampaign(campaign, await getFounderAddress());
  const { findingsPublic } = sharingFor(campaign.id);
  if (!owner && (!findingsPublic || campaign.status === "draft")) return notFound();
  const view = openFindings(campaign, owner ? "owner" : "public", findingsPublic, (fn) => after(fn));
  return NextResponse.json(view, { headers: { "cache-control": "private, no-store" } });
}
