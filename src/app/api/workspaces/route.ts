import { NextResponse, type NextRequest } from "next/server";
import { workspaceContext } from "@/lib/workspaces/context";
import { createWorkspace, renameWorkspace } from "@/lib/db/workspaces";
import { founderStorageKey } from "@/lib/auth/founder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { name } — create the caller's workspace (one per founder), or rename it. */
export async function POST(req: NextRequest) {
  const ctx = await workspaceContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 60) return NextResponse.json({ error: "Give the workspace a name (2–60 characters)." }, { status: 400 });
  if (ctx.owned) {
    renameWorkspace(ctx.owned.id, name);
    return NextResponse.json({ ok: true, workspace: { id: ctx.owned.id, name, slug: ctx.owned.slug }, renamed: true });
  }
  const ws = createWorkspace({ name, ownerKey: founderStorageKey(ctx.address), ownerAddress: ctx.address });
  return NextResponse.json({ ok: true, workspace: { id: ws.id, name: ws.name, slug: ws.slug }, renamed: false });
}
