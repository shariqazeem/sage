import { NextResponse, type NextRequest } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { loadDeploymentForSession, deploymentView } from "@/lib/launch/deployment-access";
import { recordStepBroadcast } from "@/lib/db/deployments";
import { DEPLOY_STEPS, type DeployStep } from "@/lib/launch/deployment-machine";
import { getDeployment } from "@/lib/db/deployments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deployments/<id>/steps/<step>/submitted — record the tx hash the founder's
 * wallet returned for a step, WRITE-ONCE. If the step already has a recorded hash, the
 * original is returned and nothing is resent (`broadcast: false`). This is what makes a
 * refresh or a duplicate click safe: a step is never broadcast twice. Ownership-gated.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ deploymentId: string; step: string }> }): Promise<NextResponse> {
  const { deploymentId, step } = await ctx.params;
  const session = await getSessionAddress();
  const access = loadDeploymentForSession(deploymentId, session);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  if (!DEPLOY_STEPS.includes(step as DeployStep)) {
    return NextResponse.json({ ok: false, error: "Unknown step." }, { status: 400 });
  }

  let body: { txHash?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const txHash = body.txHash;
  if (!txHash || !/^0x[0-9a-fA-F]+$/.test(txHash)) {
    return NextResponse.json({ ok: false, error: "A valid transaction hash is required." }, { status: 400 });
  }

  const res = recordStepBroadcast(deploymentId, step as DeployStep, txHash);
  if (!res.ok && res.reason && !res.txHash) {
    return NextResponse.json({ ok: false, error: res.reason }, { status: 409 });
  }
  const fresh = getDeployment(deploymentId)!;
  return NextResponse.json({
    ok: true,
    broadcast: res.broadcast,
    txHash: res.txHash ?? txHash,
    deployment: deploymentView(fresh, access.ctx.tokenDecimals),
  });
}
