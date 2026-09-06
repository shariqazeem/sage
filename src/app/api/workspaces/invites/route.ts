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
  let body: { workspaceId?: unknown; count?: unknown; single?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const ws = typeof body.workspaceId === "string" ? getWorkspace(body.workspaceId) : null;
  if (!ws) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  if (!canManage(memberRole(ws.id, ctx.memberKey))) return NextResponse.json({ error: "Only the workspace owner or an admin can invite." }, { status: 403 });
  const members = countMembers(ws.id);
  // INVITE MANY: an organisation onboards its people from a list — one single-use door each, so a
  // forwarded link admits exactly the person it was sent to. `count` is capped; the plan's member
  // limit is checked for the whole batch, not just the first seat.
  const count = typeof body.count === "number" && Number.isInteger(body.count) ? Math.min(50, Math.max(1, body.count)) : 1;
  const single = body.single === true || count > 1;
  for (let i = 0; i < count; i++) {
    if (!canAddMember(ws, members + i)) {
      return NextResponse.json(
        { error: `The ${limitsOf(ws).label} plan holds ${limitsOf(ws).members} members and this workspace has ${members}${count > 1 ? `; ${count} more would exceed it` : ""}. Upgrade to Pro to invite more.`, upgrade: true },
        { status: 402 },
      );
    }
  }
  const origin = siteUrl();
  const invites = Array.from({ length: count }, () => createInvite({ workspaceId: ws.id, createdBy: ctx.memberKey, ...(single ? { maxUses: 1 } : {}) })).map((inv) => ({
    code: inv.code,
    url: `${origin}/join/${inv.code}`,
    telegram: `https://t.me/sagedeputybot?start=${inv.code}`,
  }));
  return NextResponse.json({ ok: true, ...invites[0], invites });
}
