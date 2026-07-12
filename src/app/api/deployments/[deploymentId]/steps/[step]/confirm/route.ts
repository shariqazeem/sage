import { NextResponse, type NextRequest } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { loadDeploymentForSession, deploymentView } from "@/lib/launch/deployment-access";
import { confirmStep, markRecoveryRequired, getDeployment } from "@/lib/db/deployments";
import { DEPLOY_STEPS, type DeployStep } from "@/lib/launch/deployment-machine";
import { deploymentChainVerifier, verifyCreate, verifyApprove, verifyFund, verifyActivate, type StepVerdict } from "@/lib/launch/verify-receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deployments/<id>/steps/<step>/confirm — the server independently VERIFIES the
 * step's receipt + resulting chain state and only then advances the durable machine. It
 * never trusts a client "it worked". A create must emit the predicted vault whose on-chain
 * identity/owner/operator/token/hashes/rewards/caps/budget match the approved plan; approve
 * must leave an allowance ≥ the exact budget; fund must leave the vault balance ≥ budget;
 * activate must read active. Any mismatch routes to `recovery_required` — never `live`.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ deploymentId: string; step: string }> }): Promise<NextResponse> {
  const { deploymentId, step } = await ctx.params;
  const session = await getSessionAddress();
  const access = loadDeploymentForSession(deploymentId, session);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  if (!DEPLOY_STEPS.includes(step as DeployStep)) {
    return NextResponse.json({ ok: false, error: "Unknown step." }, { status: 400 });
  }
  const { deployment, loaded, settings, tokenDecimals } = access.ctx;
  const s = step as DeployStep;

  const verifier = deploymentChainVerifier(deployment, loaded.plan, settings);
  let verdict: StepVerdict;
  try {
    if (s === "create") verdict = await verifyCreate(deployment, loaded.plan, settings, verifier);
    else if (s === "approve") verdict = await verifyApprove(deployment, loaded.plan, settings, verifier);
    else if (s === "fund") verdict = await verifyFund(deployment, loaded.plan, settings, verifier);
    else verdict = await verifyActivate(deployment, loaded.plan, settings, verifier);
  } catch (err) {
    // TRANSIENT — an RPC error or a receipt still settling. Retryable; NEVER routes to
    // recovery (the tx may still be mining). The client polls this step again.
    const fresh = getDeployment(deploymentId)!;
    return NextResponse.json(
      { ok: false, retryable: true, error: `The ${s} step is still settling — retrying.`, reason: err instanceof Error ? err.message.slice(0, 80) : "settling", deployment: deploymentView(fresh, tokenDecimals) },
      { status: 409 },
    );
  }

  if (!verdict.ok) {
    // A DEFINITIVE on-chain mismatch/revert (the tx mined but the result disagrees with the
    // plan). If a vault already exists, this is a recovery situation (never a redeploy).
    if (deployment.deployedVault || s !== "create") {
      markRecoveryRequired(deploymentId, `${s}_verify_failed:${verdict.reason}`);
    }
    const fresh = getDeployment(deploymentId)!;
    return NextResponse.json({ ok: false, error: `Could not verify the ${s} step (${verdict.reason}).`, deployment: deploymentView(fresh, tokenDecimals) }, { status: 409 });
  }

  const advanced = confirmStep(deploymentId, s, s === "create" ? { deployedVault: verdict.deployedVault } : {});
  if (!advanced.ok) {
    const fresh = getDeployment(deploymentId)!;
    return NextResponse.json({ ok: false, error: advanced.reason, deployment: deploymentView(fresh, tokenDecimals) }, { status: 409 });
  }
  return NextResponse.json({ ok: true, deployment: deploymentView(advanced.deployment!, tokenDecimals) });
}
