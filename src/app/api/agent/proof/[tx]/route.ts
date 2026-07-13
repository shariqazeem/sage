import { NextResponse, type NextRequest } from "next/server";

import { authenticateAgent } from "@/lib/agent-api/auth";
import { opGetProof } from "@/lib/agent-api/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/proof/[tx] — the canonical verified-proof summary for a payout tx. Same
 * operation the MCP `sage_get_proof` tool runs; `verified` is recomputed on-chain, never a
 * stored flag. Read-only.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tx: string }> },
): Promise<NextResponse> {
  const auth = authenticateAgent(req);
  if (!auth.ok) return auth.res;

  const { tx } = await ctx.params;
  const r = await opGetProof(tx);
  return r.ok
    ? NextResponse.json(r)
    : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
}
