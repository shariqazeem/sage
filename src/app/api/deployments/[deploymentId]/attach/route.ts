import { NextResponse, type NextRequest } from "next/server";
import { getAddress } from "viem";

import { getSessionAddress } from "@/lib/auth/session";
import { loadDeploymentForSession, deploymentView } from "@/lib/launch/deployment-access";
import { beginAttach, markLive, markRecoveryRequired, getDeployment } from "@/lib/db/deployments";
import { attachV2Campaign, type V2MissionSetupInput } from "@/lib/campaigns/v2-setup";
import { deploymentAttachDeps, deploymentChainVerifier, verifyActivate } from "@/lib/launch/verify-receipts";
import { getInspectionJob } from "@/lib/db/inspection";
import { getCampaign } from "@/lib/db/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deployments/<id>/attach — the final, atomic step: after independently
 * confirming the vault is active, verify the DEPLOYED vault against the approved plan
 * (agreement + public identity, the SAME checks settlement uses) and atomically persist
 * the campaign + missions. Success → `live`. Failure → `recovery_required` (retry only the
 * DB attach; NEVER redeploy or create a second vault). Idempotent if already attached.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ deploymentId: string }> }): Promise<NextResponse> {
  const { deploymentId } = await ctx.params;
  const session = await getSessionAddress();
  const access = loadDeploymentForSession(deploymentId, session);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { deployment, loaded, settings, tokenDecimals } = access.ctx;

  if (!deployment.deployedVault) {
    return NextResponse.json({ ok: false, error: "The vault is not deployed yet." }, { status: 409 });
  }
  // Idempotent: if the campaign already exists for this vault, we are already live.
  const existing = getCampaign(loaded.plan.publicCampaignId);
  if (existing && existing.vaultAddress?.toLowerCase() === deployment.deployedVault.toLowerCase()) {
    if (deployment.state !== "live") markLive(deploymentId, existing.id);
    return NextResponse.json({ ok: true, deployment: deploymentView(getDeployment(deploymentId)!, tokenDecimals) });
  }

  // Independently re-confirm the vault is active before attaching (never trust the client).
  const verifier = deploymentChainVerifier(deployment, loaded.plan, settings);
  const active = await verifyActivate(deployment, loaded.plan, settings, verifier);
  if (!active.ok) {
    return NextResponse.json({ ok: false, error: `The vault is not active (${active.reason}).` }, { status: 409 });
  }

  if (deployment.state === "active") beginAttach(deploymentId);

  const job = getInspectionJob(deployment.jobId);
  const missions: V2MissionSetupInput[] = loaded.plan.missions.map((m) => ({
    missionKey: m.missionKey,
    title: m.title,
    objective: m.objective,
    instructions: m.instructions,
    targetSurface: m.targetSurface,
    criteria: m.criteria,
    evidenceRequirements: m.evidenceRequirements,
    rewardBase: BigInt(m.rewardBase),
    maxCompletions: BigInt(m.maxCompletions),
  }));

  const result = await attachV2Campaign(
    {
      publicCampaignId: loaded.plan.publicCampaignId,
      title: campaignTitle(job?.productUrl ?? ""),
      productUrl: job?.productUrl ?? "",
      chainId: settings.chainId,
      expectedToken: getAddress(settings.token),
      founderAddress: getAddress(settings.owner),
      operatorAddress: getAddress(settings.operator),
      guardian: getAddress(settings.guardian),
      factoryAddress: getAddress(settings.factory),
      vaultAddress: getAddress(deployment.deployedVault),
      missions,
    },
    deploymentAttachDeps(deployment, loaded.plan, settings),
  );

  if (!result.ok) {
    // The vault exists + is funded — a failed attach recovers (retry the DB attach only),
    // it NEVER triggers another deployment.
    markRecoveryRequired(deploymentId, `attach_${result.stage}:${result.errors.join(",")}`.slice(0, 280));
    return NextResponse.json(
      { ok: false, error: `Attachment did not complete (${result.stage}). Your vault is safe; retry attaching.`, stage: result.stage, details: result.errors, deployment: deploymentView(getDeployment(deploymentId)!, tokenDecimals) },
      { status: 409 },
    );
  }

  const live = markLive(deploymentId, result.campaignId);
  return NextResponse.json({ ok: true, campaignId: result.campaignId, deployment: deploymentView(live.deployment ?? getDeployment(deploymentId)!, tokenDecimals) });
}

function campaignTitle(productUrl: string): string {
  try {
    return `Testing campaign · ${new URL(productUrl).host}`;
  } catch {
    return "Sage testing campaign";
  }
}
