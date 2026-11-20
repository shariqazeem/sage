import { NextResponse, after } from "next/server";

import { getFounderAddress } from "@/lib/auth/founder";
import { hasMissionPlan } from "@/lib/campaigns/vault-kind";
import { getCampaign } from "@/lib/db/campaigns";
import { openFindings } from "@/lib/report";
import { liveView } from "@/lib/test-page/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/t/<campaign id>: a live test as this visitor may see it (`LiveView`, src/lib/test-page/live.ts).
 *
 * The test page asks again every few seconds while the test is live, so tickets move when the rows
 * do. The owner's read also queues a fresh grouping of the findings when one is due (the report's own
 * cooldown holds), and never waits for it. A draft is its owner's alone.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign || !hasMissionPlan(campaign.vaultKind)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const viewer = await getFounderAddress();
  const view = liveView(campaign, viewer);
  if (campaign.status === "draft" && view.viewer !== "owner") return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (view.viewer === "owner") openFindings(campaign, "owner", view.findings?.findingsPublic ?? false, (fn) => after(fn));
  return NextResponse.json(view, { headers: { "cache-control": "private, no-store" } });
}
