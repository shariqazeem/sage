import { NextResponse, type NextRequest } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { claimInspectionJob } from "@/lib/db/inspection";
import { createDeployment, recordClaim } from "@/lib/db/deployments";
import {
  loadApprovedPlan,
  buildSettings,
  defaultDailyCap,
  DEFAULT_DURATION_SECONDS,
  serializeSettings,
  LAUNCH_CHAIN_ID,
  isLaunchChain,
} from "@/lib/launch/deployment-service";
import { buildDeployBundle, deriveDeploymentInputs } from "@/lib/launch/deploy-plan";
import { verifyClaimSignature, type PlanClaim } from "@/lib/launch/claim";
import { deploymentView } from "@/lib/launch/deployment-access";
import { getAddress } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/launch/<id>/claim — consume a signed plan-claim and durably bind the founder
 * wallet to the deployment. Enforced here (fail-closed): the session equals the claimed
 * founder; the EIP-712 signature recovers to that wallet; the claim's hashes + revision +
 * budget still match the CURRENT approved plan (else it changed — reload); the nonce has
 * never been used (single-use, enforced at persist); and the anonymous namespace is
 * transferred to the wallet (never stolen from another). Creates the deployment in
 * `prepared` with default limits and advances it to `claimed`. Idempotent on refresh.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const session = await getSessionAddress();
  if (!session) return NextResponse.json({ ok: false, error: "Connect and sign in to claim this plan." }, { status: 401 });

  let body: { claim?: PlanClaim; signature?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const claim = body.claim;
  const signature = body.signature;
  if (!claim || !signature) return NextResponse.json({ ok: false, error: "Missing claim or signature." }, { status: 400 });
  if (claim.inspectionId !== id) return NextResponse.json({ ok: false, error: "Claim is for a different inspection." }, { status: 400 });
  if (claim.founder.toLowerCase() !== session.toLowerCase()) {
    return NextResponse.json({ ok: false, error: "Claim founder does not match your session wallet." }, { status: 403 });
  }

  // The chain the founder signed for (bound into the claim at challenge time).
  // Re-validate against the allowlist + server config — never trust a client-
  // returned claim. A tampered chainId also fails the EIP-712 check below, since
  // it is part of the signed domain.
  const chainId = claim.chainId ?? LAUNCH_CHAIN_ID;
  if (!isLaunchChain(chainId)) {
    return NextResponse.json({ ok: false, error: "That network isn't available for launches yet." }, { status: 400 });
  }

  // The plan must be unchanged since the challenge was issued.
  const loaded = loadApprovedPlan(id);
  if (!loaded) return NextResponse.json({ ok: false, error: "This inspection has no approved plan." }, { status: 409 });
  const budget = deriveDeploymentInputs(loaded.plan).totalBudgetBase;
  const planUnchanged =
    claim.approvedRevision === loaded.revisionNumber &&
    claim.campaignIdHash.toLowerCase() === loaded.plan.campaignIdHash.toLowerCase() &&
    claim.missionPlanDigest.toLowerCase() === loaded.plan.missionPlanDigest.toLowerCase() &&
    claim.totalBudgetBase === budget.toString() &&
    claim.publicCampaignId === loaded.plan.publicCampaignId;
  if (!planUnchanged) {
    return NextResponse.json({ ok: false, error: "This plan changed since you started — reload and claim again." }, { status: 409 });
  }

  // Verify the EIP-712 signature binds THIS wallet to THIS plan.
  const now = Math.floor(Date.now() / 1000);
  const verdict = await verifyClaimSignature(claim, signature as `0x${string}`, { expectedWallet: session, chainId, now });
  if (!verdict.ok) return NextResponse.json({ ok: false, error: `Claim signature rejected (${verdict.reason}).` }, { status: 400 });

  // Transfer ownership: anonymous → this wallet (or a no-op if already owned by it).
  const transfer = claimInspectionJob(id, session);
  if (!transfer.ok) return NextResponse.json({ ok: false, error: "This plan is owned by another wallet." }, { status: 403 });

  // Build the initial deployment with default limits (guardian = founder, cap = budget,
  // duration = 14d). The founder can lower these at the preview step before deploying.
  const settingsRes = buildSettings(
    loaded.plan,
    { owner: getAddress(session), guardian: getAddress(session), dailyVelocityCapBase: defaultDailyCap(loaded.plan), durationSeconds: DEFAULT_DURATION_SECONDS },
    chainId,
  );
  if (!settingsRes.ok) {
    return NextResponse.json({ ok: false, error: `Launch chain is not fully configured (${settingsRes.errors.join(", ")}).` }, { status: 503 });
  }
  const bundle = buildDeployBundle(loaded.plan, settingsRes.settings);

  const deployment = createDeployment({
    jobId: id,
    revisionId: loaded.revisionId,
    revisionNumber: loaded.revisionNumber,
    founderWallet: session,
    chainId,
    settings: serializeSettings(settingsRes.settings),
    campaignIdHash: loaded.plan.campaignIdHash,
    missionPlanDigest: loaded.plan.missionPlanDigest,
    calldataDigest: bundle.calldataDigest,
    totalBudgetBase: budget,
    predictedVault: bundle.predictedVault,
  });

  const claimed = recordClaim(deployment.id, { nonce: claim.nonce, signature, founderWallet: session });
  if (!claimed.ok) {
    // A nonce reuse or another wallet — surface honestly (the deployment stays prepared).
    return NextResponse.json({ ok: false, error: `Could not record claim (${claimed.reason}).` }, { status: 409 });
  }

  return NextResponse.json({ ok: true, deployment: deploymentView(claimed.deployment!, loaded.plan.tokenDecimals) });
}
