import { NextResponse, type NextRequest } from "next/server";
import { workspaceContext, canManage } from "@/lib/workspaces/context";
import { getWorkspace, memberRole, removeMember, setMemberRole } from "@/lib/db/workspaces";
import { effectiveWorkspacePlan } from "@/lib/plans/founder-plan";
import { cheapestWith, hasFeature, PLANS } from "@/lib/plans/catalog";

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

/**
 * PATCH { workspaceId, memberKey, role: "admin" | "member" } — the owner appoints an admin, or takes
 * it back. Admins are a Team feature. The owner's own role never changes here.
 */
export async function PATCH(req: NextRequest) {
  const ctx = await workspaceContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { workspaceId?: unknown; memberKey?: unknown; role?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const ws = typeof body.workspaceId === "string" ? getWorkspace(body.workspaceId) : null;
  if (!ws) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  if (memberRole(ws.id, ctx.memberKey) !== "owner") return NextResponse.json({ error: "Only the workspace owner can appoint admins." }, { status: 403 });
  if (body.role !== "admin" && body.role !== "member") return NextResponse.json({ error: "A role is admin or member." }, { status: 400 });
  if (body.role === "admin" && !hasFeature(effectiveWorkspacePlan(ws), "roles")) {
    return NextResponse.json({ error: `Admins are on ${PLANS[cheapestWith("roles")].name} and above.`, upgrade: cheapestWith("roles") }, { status: 402 });
  }
  const key = typeof body.memberKey === "string" ? body.memberKey : "";
  const changed = setMemberRole(ws.id, key, body.role);
  return NextResponse.json({ ok: changed, error: changed ? undefined : "That member's role can't be changed." }, { status: changed ? 200 : 400 });
}
