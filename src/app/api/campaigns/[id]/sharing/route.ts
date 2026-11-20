import { NextResponse } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { ownsCampaign } from "@/lib/campaigns/review-actions";
import { getCampaign } from "@/lib/db/campaigns";
import { setSharing, sharingFor, type Sharing } from "@/lib/sharing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * HOW A TEST IS SHARED, AS ITS OWNER ANSWERS (relaunch, 20 Nov 2026). The offer card's switches and
 * "Let Sage post the result" land here: whether Sage's X account and Telegram channel post the mission
 * (`postMission`) and the result (`postResult`), and whether the findings are public (`findingsPublic`).
 *
 * Only the test's owner reads or changes them; anyone else gets 404, the same as a test that doesn't
 * exist. A partial body changes only what it names (`setSharing`). With no answer, a test stays quiet.
 */
async function ownedCampaign(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign) return null;
  return ownsCampaign(campaign, await getFounderAddress()) ? campaign : null;
}

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const campaign = await ownedCampaign(ctx);
  if (!campaign) return notFound();
  return NextResponse.json({ ok: true, sharing: sharingFor(campaign.id) }, { headers: { "cache-control": "private, no-store" } });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const campaign = await ownedCampaign(ctx);
  if (!campaign) return notFound();
  const body = (await req.json().catch(() => null)) as Partial<Record<keyof Sharing, unknown>> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send the switches to change, as true or false." }, { status: 400 });
  const patch: Partial<Sharing> = {};
  for (const key of ["postMission", "postResult", "findingsPublic"] as const) {
    if (typeof body[key] === "boolean") patch[key] = body[key] as boolean;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change: name postMission, postResult or findingsPublic as true or false." }, { status: 400 });
  return NextResponse.json({ ok: true, sharing: setSharing(campaign.id, patch) });
}
