import { NextResponse, type NextRequest } from "next/server";

import { authenticateAgent } from "@/lib/agent-api/auth";
import { opGetInspection } from "@/lib/agent-api/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/inspections/[id] — poll a durable inspection. Same operation the MCP
 * `sage_get_inspection` tool runs: honest stage, needs-input / failure, and when ready a
 * concise plan summary + the founder approval link. Read-only.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = authenticateAgent(req);
  if (!auth.ok) return auth.res;

  const { id } = await ctx.params;
  const r = opGetInspection(id);
  return r.ok
    ? NextResponse.json(r)
    : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
}
