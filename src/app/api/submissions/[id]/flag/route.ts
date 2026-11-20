import { NextResponse } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { flagAnswer } from "@/lib/campaigns/builder-flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/submissions/[id]/flag `{ reason }`: the builder flags an approved answer as not a real try,
 * inside the 30 minutes before it settles. The payout is revoked, the tester reads the reason, and the
 * place reopens for someone else; nothing is refunded. Rules: `src/lib/campaigns/builder-flag.ts`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
  const r = flagAnswer({ submissionId: id, by: await getFounderAddress(), reason: body?.reason });
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
