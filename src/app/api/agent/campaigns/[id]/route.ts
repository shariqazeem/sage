import { NextResponse, type NextRequest } from "next/server";

import { authenticateAgent } from "@/lib/agent-api/auth";
import { opGetCampaign } from "@/lib/agent-api/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/campaigns/[id] — campaign status + activity for the ClawUp agent to report.
 * Same operation the MCP `sage_get_campaign` tool runs: live/paused/closed, network + truthful
 * token, funded/paid/remaining, mission slots, and recent submissions with the Deputy's
 * decision truth + payout tx + proof link. Public-safe, read-only.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = authenticateAgent(req);
  if (!auth.ok) return auth.res;

  const { id } = await ctx.params;
  const r = opGetCampaign(id);
  return r.ok
    ? NextResponse.json(r)
    : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
}
