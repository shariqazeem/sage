import { NextResponse, type NextRequest } from "next/server";

import { authenticateAgent } from "@/lib/agent-api/auth";
import { opGetSubmission } from "@/lib/agent-api/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/submissions/[id] — one tester submission's status. Same operation the MCP
 * `sage_get_submission` tool runs: reviewing / verified / held / paid, the Deputy's confidence
 * + reason code, and a proof link once paid. Read-only; no evidence content.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = authenticateAgent(req);
  if (!auth.ok) return auth.res;

  const { id } = await ctx.params;
  const r = opGetSubmission(id);
  return r.ok
    ? NextResponse.json(r)
    : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
}
