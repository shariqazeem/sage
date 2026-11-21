import { NextResponse } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { ownsCampaign } from "@/lib/campaigns/review-actions";
import { getCampaign } from "@/lib/db/campaigns";
import { findingsView } from "@/lib/report";
import { sharingFor } from "@/lib/sharing";
import { firstUsersView, wordDrafts } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET YOUR FIRST USERS, FOR A TEST'S OWNER (21 Nov 2026): the drafts a builder posts themselves.
 *
 *   GET   → the drafts as they stand (worded ones if this version was worded, else the plain ones).
 *           Never asks a model.
 *   POST  → the owner tapped "Have Sage reword them": one model call on the DRAFT lane, at most once
 *           per version of the facts, every draft checked in code. Answers with the drafts either way.
 *
 * Only the owner reads or asks; anyone else gets 404, the same as a test that doesn't exist. Nothing
 * here posts or messages anyone: these are words for the builder's own tap.
 */
async function ownedCampaign(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign) return null;
  return ownsCampaign(campaign, await getFounderAddress()) ? campaign : null;
}

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });
const headers = { "cache-control": "private, no-store" };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const campaign = await ownedCampaign(ctx);
  if (!campaign) return notFound();
  const users = firstUsersView(campaign, findingsView(campaign, "owner", sharingFor(campaign.id).findingsPublic));
  if (!users) return notFound();
  return NextResponse.json({ ok: true, users }, { headers });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const campaign = await ownedCampaign(ctx);
  if (!campaign) return notFound();
  const users = await wordDrafts(campaign);
  if (!users) return notFound();
  return NextResponse.json({ ok: true, users }, { headers });
}
