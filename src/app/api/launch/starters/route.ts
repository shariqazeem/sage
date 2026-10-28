import { NextResponse } from "next/server";
import { workspaceContext } from "@/lib/workspaces/context";
import { listInspectionJobs } from "@/lib/db/inspection";
import { siteUrl } from "@/lib/site";
import { effectiveWorkspacePlan } from "@/lib/plans/founder-plan";
import { hasFeature } from "@/lib/plans/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_NAME = /\bworkspace\b|^my (team|company|startup)$/i;

/**
 * GET — what Post starts from: the workspace's name, the product Sage last tested for this founder
 * (where a product test starts, and the context a job is drafted against), and whether the workspace
 * can admit invited people yet. A plan the founder composed themselves is not a product test (its
 * "product" is its own board), so it never counts. Signed out, there is nothing to say.
 */
export async function GET(): Promise<NextResponse> {
  const ctx = await workspaceContext();
  if (!ctx) return NextResponse.json({ ok: true, product: null });
  const board = `${siteUrl()}/c/`;
  const tested = listInspectionJobs(ctx.address).find(
    (j) => j.provider !== "operator" && /^https?:\/\//.test(j.productUrl) && !j.productUrl.startsWith(board),
  );
  const ws = ctx.owned ?? ctx.memberships[0]?.workspace ?? null;
  // a workspace made without a name is "My workspace": no product is called that, so the jobs use the product's own address
  const name = ws?.name?.trim() && !GENERIC_NAME.test(ws.name.trim()) ? ws.name.trim() : null;
  // whether this workspace can admit invited people yet (members-only is Pro and up), so the job card is honest
  const canInvite = ws ? hasFeature(effectiveWorkspacePlan(ws), "membersOnly") : false;
  return NextResponse.json({ ok: true, product: { name, url: tested?.productUrl ?? null }, canInvite });
}
