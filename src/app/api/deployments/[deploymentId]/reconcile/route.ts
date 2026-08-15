import { NextResponse, type NextRequest } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { loadDeploymentForSession, deploymentView, deploymentNextAction } from "@/lib/launch/deployment-access";
import { confirmStep, getDeployment } from "@/lib/db/deployments";
import type { DeploymentState, DeployStep } from "@/lib/launch/deployment-machine";
import { deploymentChainVerifier, verifyCreate, verifyApprove, verifyFund, verifyActivate, type StepVerdict } from "@/lib/launch/verify-receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deployments/<id>/reconcile — resume from the durable state after a refresh,
 * crash, or lost receipt. If the deployment is mid-broadcast (a step's tx hash is recorded
 * but not yet confirmed), the server re-reads the chain and advances the step if it has
 * since confirmed — WITHOUT ever re-broadcasting. Otherwise it just returns the current
 * state + the safe next action. Never resends a step; never redeploys.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ deploymentId: string }> }): Promise<NextResponse> {
  const { deploymentId } = await ctx.params;
  const session = await getSessionAddress();
  const access = loadDeploymentForSession(deploymentId, session);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { deployment, loaded, settings, tokenDecimals } = access.ctx;

  let reason: string | null = null;
  const next = deploymentNextAction(deployment.state as DeploymentState);
  // Only a pending "confirm" step can be reconciled forward. A "broadcast" step waits for
  // the wallet; a claim/limits/attach/live/recovery state has nothing to reconcile here.
  if (next.mode === "confirm" && next.step) {
    const s = next.step as DeployStep;
    const verifier = deploymentChainVerifier(deployment, loaded.plan, settings);
    let verdict: StepVerdict;
    try {
      if (s === "create") verdict = await verifyCreate(deployment, loaded.plan, settings, verifier);
      else if (s === "approve") verdict = await verifyApprove(deployment, loaded.plan, settings, verifier);
      else if (s === "fund") verdict = await verifyFund(deployment, loaded.plan, settings, verifier);
      else verdict = await verifyActivate(deployment, loaded.plan, settings, verifier);
    } catch {
      verdict = { ok: false, reason: "not_yet_confirmed" };
    }
    if (verdict.ok) {
      confirmStep(deploymentId, s, s === "create" ? { deployedVault: verdict.deployedVault } : {});
    } else {
      // A non-ok verdict here is NOT a failure — the tx may simply not be mined yet, and the UI
      // keeps polling. But it was DISCARDED, and a founder whose step can never confirm (a real
      // mismatch, not a slow block) then watched "Setting up…" forever with nothing, anywhere,
      // saying why. Measured 2026-08-15: a create tx mined cleanly, sent to the right factory, both
      // events present — and the deployment still would not advance. Diagnosing it meant reading
      // the chain by hand because the one place that knew the reason threw it away.
      reason = verdict.reason ?? "not_yet_confirmed";
      console.warn(`[reconcile] ${deploymentId} step=${s} not confirmed: ${reason}`);
    }
  }

  const fresh = getDeployment(deploymentId)!;
  return NextResponse.json({
    ok: true,
    deployment: deploymentView(fresh, tokenDecimals),
    // present only while a step is still unconfirmed; the UI shows it once it has been a while.
    ...(reason ? { pendingReason: reason } : {}),
  });
}
