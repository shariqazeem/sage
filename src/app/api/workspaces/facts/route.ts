import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { workspaceContext } from "@/lib/workspaces/context";
import { getWorkspaceFacts, rememberWorkspaceFacts } from "@/lib/db/workspace-facts";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * What the signed-in founder's workspace told Sage once (src/lib/launch/remembered.ts).
 *
 * GET  → { facts: { github_repo?: "owner/name", discord_invite?: "https://discord.gg/…", … } }
 * POST { facts: [{ kind, value }] } → remembers each one that is a clean value of its kind.
 *
 * The workspace is the one they own, else the first they belong to: the same one their jobs are posted
 * under. Nothing here moves money or is shown to anyone else.
 */
export async function GET(): Promise<NextResponse> {
  const ctx = await workspaceContext();
  const ws = ctx?.owned ?? ctx?.memberships[0]?.workspace ?? null;
  if (!ctx || !ws) return NextResponse.json({ facts: {} });
  return NextResponse.json({ facts: getWorkspaceFacts(ws.id) });
}

const body = z.object({ facts: z.array(z.object({ kind: z.string().max(40), value: z.string().max(300) })).max(10) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await workspaceContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const ws = ctx.owned ?? ctx.memberships[0]?.workspace ?? null;
  if (!ws) return NextResponse.json({ ok: true, kept: 0 });
  const rl = rateLimit("create", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, kept: rememberWorkspaceFacts(ws.id, parsed.facts) });
}
