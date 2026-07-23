import { NextResponse, type NextRequest } from "next/server";
import { getAddress } from "viem";

import { getSessionAddress } from "@/lib/auth/session";
import { loadDeploymentForSession, deploymentView } from "@/lib/launch/deployment-access";
import { beginAttach, markLive, markRecoveryRequired, getDeployment } from "@/lib/db/deployments";
import { attachV2Campaign, type V2MissionSetupInput } from "@/lib/campaigns/v2-setup";
import { attachApprovedPolicyToCampaign } from "@/lib/campaigns/attach-policy";
import { getApprovedRevision } from "@/lib/db/plan-revisions";
import { checkRevisionPolicyForApproval } from "@/lib/launch/approve-policy";
import { payoutReplaySchemaReady } from "@/lib/deputy/canary-preflight";
import { deserializePlan } from "@/lib/launch/serde";
import { classifyVerifiability } from "@/lib/launch/validate-mission";
import { distillPrivateKey } from "@/lib/deputy/observation-verify";
import { explorationCounts } from "@/lib/launch/field-test";
import type { FieldTestSummary } from "@/lib/launch/schemas";
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
export async function POST(req: NextRequest, ctx: { params: Promise<{ deploymentId: string }> }): Promise<NextResponse> {
  const { deploymentId } = await ctx.params;
  // The founder's chosen payout mode from the wizard. Default autopilot — the agent that
  // designed the missions also pays them. Validated to the two allowed values.
  const body = (await req.json().catch(() => ({}))) as { autonomy?: unknown; perWalletCap?: unknown };
  const autonomy: "manual" | "autopilot" = body.autonomy === "manual" ? "manual" : "autopilot";
  // P18/P19 — the founder-set per-campaign per-wallet payout cap. Validated + clamped to [1, 1000];
  // anything invalid falls back to the safe default of 1. Chat-launch never sends it → default 1.
  const perWalletCap = Math.min(1000, Math.max(1, Math.round(Number(body.perWalletCap)) || 1));
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

  // Phase 2 — EARLY activation preflight (before the DB attach): if the approved revision carries a REQUIRED
  // VerificationPolicyV2, it must be schema-supported + complete + bound to this plan. Refuse up front rather
  // than creating a campaign that could never enforce its covenant. A non-required revision passes through.
  const approvedForPreflight = getApprovedRevision(deployment.jobId);
  if (approvedForPreflight?.verificationPolicyRequired) {
    if (!payoutReplaySchemaReady().ok) {
      return NextResponse.json({ ok: false, error: "Verification-policy schema is not present; cannot activate a required-policy campaign." }, { status: 409 });
    }
    const check = checkRevisionPolicyForApproval({
      verificationPolicy: approvedForPreflight.verificationPolicy ?? null,
      verificationPolicyDigest: approvedForPreflight.verificationPolicyDigest ?? null,
      verificationPolicyRequired: true,
      planMissionPlanDigest: deserializePlan(approvedForPreflight.planJson).missionPlanDigest,
    });
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: `The approved plan's verification policy is not activatable (${check.reason}).` }, { status: 409 });
    }
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
    // P16 money gate — recompute the lint class deterministically from the same mission prose the plan
    // classified (the durable job doesn't carry it). Same inputs → the class the founder was shown, and
    // the persisted value the settle-time gate reads. Never trusts an absent field into the pay path.
    verifiabilityClass: classifyVerifiability({
      objective: m.objective,
      criteria: m.criteria,
      evidenceRequirements: m.evidenceRequirements,
    }),
    rewardBase: BigInt(m.rewardBase),
    maxCompletions: BigInt(m.maxCompletions),
  }));

  // P16 — PIN the distilled private answer key at the instant the plan locks (before any tester sees a
  // card): Sage's field-test observations MINUS every public plan string, so a parrot of the card scores
  // structural zero. Its digest anchors the proof receipt; a thin key leaves the campaign founder-only.
  const fieldTest =
    (job?.result as { map?: { fieldTest?: FieldTestSummary | null } } | undefined)?.map?.fieldTest ?? null;
  const publicStrings = loaded.plan.missions.flatMap((m) => [
    m.title,
    m.objective,
    m.instructions,
    m.targetSurface,
    ...(m.criteria ?? []),
    ...(m.evidenceRequirements ?? []),
    ...((m as { whyItMatters?: string }).whyItMatters ? [(m as { whyItMatters?: string }).whyItMatters as string] : []),
  ]);
  const privateKey = distillPrivateKey(fieldTest, publicStrings);
  const explored = explorationCounts(fieldTest); // P23 — Sage's own exploration breadth, for the board

  const result = await attachV2Campaign(
    {
      publicCampaignId: loaded.plan.publicCampaignId,
      privateCorpus: privateKey.observations,
      privateCorpusDigest: privateKey.digest,
      privateCorpusSources: privateKey.distinctSources,
      exploredScreens: explored.screens,
      exploredElements: explored.elements,
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
      autonomy,
      perWalletCap,
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

  // Phase 2 — activation FAILS CLOSED. The approved revision's VerificationPolicyV2 MUST attach to the new
  // campaign (write-once, atomic) BEFORE the deployment is marked live. A required-but-missing / malformed /
  // incomplete / stale / conflicting policy → recovery_required + a bounded non-success; the deployment is
  // NEVER marked live with an unenforceable covenant. A non-required (non-canary) revision attaches nothing.
  const policyAttach = attachApprovedPolicyToCampaign(result.campaignId, deployment.jobId);
  if (!policyAttach.ok) {
    markRecoveryRequired(deploymentId, `attach_policy:${policyAttach.reason}`.slice(0, 280));
    return NextResponse.json(
      { ok: false, error: `Verification policy could not be attached (${policyAttach.reason}). Your vault is safe; retry attaching.`, stage: "policy_attach", deployment: deploymentView(getDeployment(deploymentId)!, tokenDecimals) },
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
