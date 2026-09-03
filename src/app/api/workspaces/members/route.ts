import { NextResponse, type NextRequest } from "next/server";
import { workspaceContext, canManage } from "@/lib/workspaces/context";
import { getWorkspace, memberRole, removeMember } from "@/lib/db/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE { workspaceId, memberKey } — remove a member (never the owner). */
export async function DELETE(req: NextRequest) {
  const ctx = await workspaceContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { workspaceId?: unknown; memberKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const ws = typeof body.workspaceId === "string" ? getWorkspace(body.workspaceId) : null;
  if (!ws) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  if (!canManage(memberRole(ws.id, ctx.memberKey))) return NextResponse.json({ error: "Only the workspace owner or an admin can remove members." }, { status: 403 });
  const key = typeof body.memberKey === "string" ? body.memberKey : "";
  const removed = removeMember(ws.id, key);
  return NextResponse.json({ ok: removed, error: removed ? undefined : "That member can't be removed." });
}
