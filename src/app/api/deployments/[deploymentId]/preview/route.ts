import { NextResponse, type NextRequest } from "next/server";
import { getAddress } from "viem";

import { getSessionAddress } from "@/lib/auth/session";
import { loadDeploymentForSession, deploymentView, deploymentCalls } from "@/lib/launch/deployment-access";
import {
  buildSettings,
  defaultDailyCap,
  DEFAULT_DURATION_SECONDS,
  serializeSettings,
  LAUNCH_CHAIN_ID,
  type FounderLimits,
} from "@/lib/launch/deployment-service";
import { buildDeployBundle, deriveDeploymentInputs } from "@/lib/launch/deploy-plan";
import { rebindDeployment, markPreflightReady, getDeployment } from "@/lib/db/deployments";
import { readDeploymentPreview } from "@/lib/launch/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deployments/<id>/preview — apply the founder's chosen limits (daily cap,
 * duration, guardian), re-bind the deployment to the recomputed predicted vault + calldata
 * (only allowed before any create tx), read the live chain preview, and advance to
 * `preflight_ready`. The owner is ALWAYS the deployment's founder and the factory/token/
 * operator ALWAYS come from server config — the client cannot supply them. Returns the
 * server-produced preview the founder reviews before signing.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ deploymentId: string }> }): Promise<NextResponse> {
  const { deploymentId } = await ctx.params;
  const session = await getSessionAddress();
  const access = loadDeploymentForSession(deploymentId, session);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { deployment, loaded } = access.ctx;

  let body: { dailyCapBase?: string; durationSeconds?: string; guardian?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* limits optional — fall back to defaults */
  }

  // Founder-chosen limits (validated in buildSettings). Owner is fixed to the founder.
  const limits: FounderLimits = {
    owner: getAddress(deployment.founderWallet),
    guardian: body.guardian ? getAddress(body.guardian) : getAddress(deployment.founderWallet),
    dailyVelocityCapBase: body.dailyCapBase ? BigInt(body.dailyCapBase) : defaultDailyCap(loaded.plan),
    durationSeconds: body.durationSeconds ? BigInt(body.durationSeconds) : DEFAULT_DURATION_SECONDS,
  };
  const settingsRes = buildSettings(loaded.plan, limits, LAUNCH_CHAIN_ID);
  if (!settingsRes.ok) {
    return NextResponse.json({ ok: false, error: "These limits aren't valid.", details: settingsRes.errors }, { status: 400 });
  }

  const bundle = buildDeployBundle(loaded.plan, settingsRes.settings);
  const budget = deriveDeploymentInputs(loaded.plan).totalBudgetBase;

  // Re-bind only while limits are still changeable (claimed / preflight_ready, no create tx).
  if (deployment.state === "claimed" || deployment.state === "preflight_ready") {
    const rebind = rebindDeployment(deployment.id, {
      settings: serializeSettings(settingsRes.settings),
      predictedVault: bundle.predictedVault,
      calldataDigest: bundle.calldataDigest,
      totalBudgetBase: budget,
    });
    if (!rebind.ok) return NextResponse.json({ ok: false, error: rebind.reason }, { status: 409 });
    if (deployment.state === "claimed") markPreflightReady(deployment.id);
  }

  let preview;
  try {
    preview = await readDeploymentPreview(loaded.plan, settingsRes.settings);
  } catch {
    return NextResponse.json({ ok: false, error: "Could not read the chain for a preview. Please try again." }, { status: 502 });
  }

  // Reload the context so the returned view + calls reflect the (possibly re-bound) bundle.
  const reloaded = loadDeploymentForSession(deployment.id, session);
  const calls = reloaded.ok ? deploymentCalls(reloaded.ctx) : [];
  const fresh = getDeployment(deployment.id)!;
  return NextResponse.json({ ok: true, preview, calls, deployment: deploymentView(fresh, loaded.plan.tokenDecimals) });
}
