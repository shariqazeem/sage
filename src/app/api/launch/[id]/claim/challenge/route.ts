import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

import { getSessionAddress } from "@/lib/auth/session";
import { getInspectionJob } from "@/lib/db/inspection";
import { loadApprovedPlan, LAUNCH_CHAIN_ID } from "@/lib/launch/deployment-service";
import { deriveDeploymentInputs } from "@/lib/launch/deploy-plan";
import { buildClaimTypedData, CLAIM_SCHEMA_VERSION, CLAIM_TTL_SECONDS, type PlanClaim } from "@/lib/launch/claim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/launch/<id>/claim/challenge — issue the exact EIP-712 plan-claim the founder's
 * wallet will sign to take ownership of an approved plan. Requires an authenticated
 * session (the founder). The claim binds the wallet to the current approved revision +
 * canonical hashes + exact budget with a fresh single-use nonce and a short expiry. The
 * security is all enforced at /claim (signature, plan-unchanged, nonce single-use); this
 * just hands back a well-formed claim + typed data. Refused if the plan is already owned
 * by a different wallet.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const session = await getSessionAddress();
  if (!session) return NextResponse.json({ ok: false, error: "Connect and sign in to claim this plan." }, { status: 401 });

  const job = getInspectionJob(id);
  if (!job) return NextResponse.json({ ok: false, error: "Inspection not found." }, { status: 404 });
  if (job.founderWallet !== "anonymous" && job.founderWallet !== session.toLowerCase()) {
    return NextResponse.json({ ok: false, error: "This plan is owned by another wallet." }, { status: 403 });
  }

  const loaded = loadApprovedPlan(id);
  if (!loaded) return NextResponse.json({ ok: false, error: "This inspection has no approved plan to claim." }, { status: 409 });

  const now = Math.floor(Date.now() / 1000);
  const claim: PlanClaim = {
    schemaVersion: CLAIM_SCHEMA_VERSION,
    inspectionId: id,
    approvedRevision: loaded.revisionNumber,
    publicCampaignId: loaded.plan.publicCampaignId,
    campaignIdHash: loaded.plan.campaignIdHash,
    missionPlanDigest: loaded.plan.missionPlanDigest,
    totalBudgetBase: deriveDeploymentInputs(loaded.plan).totalBudgetBase.toString(),
    founder: session,
    chainId: LAUNCH_CHAIN_ID,
    nonce: `n_${randomBytes(16).toString("hex")}`,
    issuedAt: now,
    expiry: now + CLAIM_TTL_SECONDS,
  };

  // buildClaimTypedData returns bigint fields (viem message) — serialize for JSON transport.
  const typed = buildClaimTypedData(claim);
  const typedData = JSON.parse(JSON.stringify(typed, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  return NextResponse.json({ ok: true, claim, typedData });
}
