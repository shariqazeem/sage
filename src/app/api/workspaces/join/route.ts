import { NextResponse, type NextRequest } from "next/server";
import { workspaceContext } from "@/lib/workspaces/context";
import { getInvite, getWorkspace, redeemInvite } from "@/lib/db/workspaces";
import { limitsOf } from "@/lib/workspaces/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?code= — what the link opens onto (name only; nothing about members leaks to a stranger). */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") ?? "";
  const invite = getInvite(code);
  const ws = invite ? getWorkspace(invite.workspaceId) : null;
  if (!invite || !ws) return NextResponse.json({ error: "That invite link isn't valid." }, { status: 404 });
  const open = !invite.revokedAt && invite.uses < invite.maxUses;
  return NextResponse.json({ ok: true, workspace: { id: ws.id, name: ws.name }, open });
}

/** POST { code } — join as the signed-in wallet. */
export async function POST(req: NextRequest) {
  const ctx = await workspaceContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { code?: unknown; displayName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const invite = getInvite(code);
  const ws = invite ? getWorkspace(invite.workspaceId) : null;
  if (!invite || !ws) return NextResponse.json({ error: "That invite link isn't valid." }, { status: 404 });
  const r = redeemInvite(code, { memberKey: ctx.memberKey, address: ctx.address, displayName: typeof body.displayName === "string" ? body.displayName.slice(0, 40) : null }, { memberCap: limitsOf(ws).members });
  if (!r.ok) {
    const msg =
      r.reason === "member_cap"
        ? "This workspace is full on its current plan — ask the owner to upgrade."
        : r.reason === "revoked"
          ? "This invite link was revoked — ask for a new one."
          : r.reason === "exhausted"
            ? "This invite link has been used up — ask for a new one."
            : "That invite link isn't valid.";
    return NextResponse.json({ error: msg }, { status: r.reason === "not_found" ? 404 : 409 });
  }
  return NextResponse.json({ ok: true, workspace: { id: r.workspace.id, name: r.workspace.name }, already: r.already });
}
