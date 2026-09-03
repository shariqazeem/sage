import { NextResponse, type NextRequest } from "next/server";
import { workspaceContext, canManage } from "@/lib/workspaces/context";
import { countMembers, createInvite, getWorkspace, memberRole } from "@/lib/db/workspaces";
import { canAddMember, limitsOf } from "@/lib/workspaces/plan";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { workspaceId } — mint an invite link. The plan's member cap is checked HERE, at the door. */
export async function POST(req: NextRequest) {
  const ctx = await workspaceContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { workspaceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const ws = typeof body.workspaceId === "string" ? getWorkspace(body.workspaceId) : null;
  if (!ws) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  if (!canManage(memberRole(ws.id, ctx.memberKey))) return NextResponse.json({ error: "Only the workspace owner or an admin can invite." }, { status: 403 });
  const members = countMembers(ws.id);
  if (!canAddMember(ws, members)) {
    return NextResponse.json(
      { error: `The ${limitsOf(ws).label} plan holds ${limitsOf(ws).members} members and this workspace has ${members}. Upgrade to Pro to invite more.`, upgrade: true },
      { status: 402 },
    );
  }
  const invite = createInvite({ workspaceId: ws.id, createdBy: ctx.memberKey });
  const origin = siteUrl();
  return NextResponse.json({
    ok: true,
    code: invite.code,
    url: `${origin}/join/${invite.code}`,
    telegram: `https://t.me/sagedeputybot?start=${invite.code}`,
  });
}
