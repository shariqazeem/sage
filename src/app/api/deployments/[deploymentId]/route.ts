import { NextResponse, type NextRequest } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { loadDeploymentForSession, deploymentView, deploymentCalls } from "@/lib/launch/deployment-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deployments/<id> — the durable, refresh-safe deployment state for the founder.
 * Ownership-gated (only the founder wallet may read it). This is the single source the
 * client resumes from after a reload: the state, per-step tx hashes, predicted/deployed
 * vault, and the one next action to take.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ deploymentId: string }> }): Promise<NextResponse> {
  const { deploymentId } = await ctx.params;
  const session = await getSessionAddress();
  const access = loadDeploymentForSession(deploymentId, session);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({
    ok: true,
    deployment: deploymentView(access.ctx.deployment, access.ctx.tokenDecimals),
    calls: deploymentCalls(access.ctx),
  });
}
