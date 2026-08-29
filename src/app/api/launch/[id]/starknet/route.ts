import { NextResponse } from "next/server";

import { loadApprovedPlan } from "@/lib/launch/deployment-service";
import {
  readMission,
  readVaultBalance,
  readVaultState,
  type MissionTerms,
} from "@/lib/starknet/vault";
import { verifyVaultBacksPlan } from "@/lib/starknet/verify-attach";
import { toFelt } from "@/lib/starknet/felt";
import { starknetConfig, starknetVaultClassHash } from "@/lib/starknet/config";
import { planVaultDeployment, saltForJob } from "@/lib/starknet/vault-calls";
import { STARKNET_MAINNET_KEY } from "@/lib/deputy/networks";
import { createCampaign, createMission, getCampaignByVault } from "@/lib/db/campaigns";
import { recordEvent } from "@/lib/db/campaigns";
import { getFounderAddress } from "@/lib/auth/founder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/launch/<id>/starknet — everything the founder's wallet needs to stand up their vault.
 *
 * THE SERVER COMPUTES THE CALLS, THE BROWSER ONLY SIGNS THEM. It would be simpler to hand the
 * browser the raw numbers and let it assemble the transaction, and that is precisely the mistake:
 * the mission felts written into the vault here must equal the felts settlement looks up months
 * later, and two independent derivations are two chances to drift. When they drift the vault
 * answers NO_SUCH_MISSION — after a worker has already done the work. One derivation, server-side,
 * makes that impossible rather than unlikely.
 *
 * Nothing returned here is a secret: a class hash, public addresses, and the founder's own plan.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;

  const owner = await getFounderAddress();
  if (!owner) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const cfg = starknetConfig();
  const classHash = starknetVaultClassHash();
  if (!cfg || !classHash) {
    return NextResponse.json(
      { error: "Private-capable campaigns are not available on this deployment." },
      { status: 503 },
    );
  }

  const plan = loadApprovedPlan(id);
  if (!plan) {
    return NextResponse.json({ error: "No approved plan for this inspection." }, { status: 404 });
  }

  const missions = plan.plan.missions;
  for (const m of missions) {
    if (!m.missionIdHash) {
      return NextResponse.json(
        { error: `"${m.title}" has no mission id and cannot settle on this rail.` },
        { status: 400 },
      );
    }
  }

  const totalBase = missions.reduce(
    (sum: bigint, m) => sum + BigInt(m.rewardBase) * BigInt(m.maxCompletions),
    BigInt(0),
  );

  const planned = missions.map((m) => ({
    title: m.title,
    missionId: toFelt(m.missionIdHash as string),
    rewardBase: String(m.rewardBase),
    maxCompletions: Number(m.maxCompletions),
  }));

  // Without a connected wallet there is no deployer, so no address to predict yet. The founder
  // still sees what the campaign will cost and what it will pay for.
  const ownerParam = new URL(req.url).searchParams.get("owner")?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(ownerParam)) {
    return NextResponse.json({
      ok: true,
      classHash,
      operator: cfg.accountAddress,
      token: cfg.tokenAddress,
      totalBase: totalBase.toString(),
      missions: planned,
    });
  }

  const deployment = planVaultDeployment({
    classHash,
    owner: ownerParam,
    operator: cfg.accountAddress,
    token: cfg.tokenAddress,
    // Derived from the job, not from randomness, so a launch interrupted between the wallet
    // confirming and Sage being told resumes at the SAME address, instead of sending the founder
    // to a fresh empty vault and orphaning the funded one.
    salt: saltForJob(id),
    budgetCeilingBase: totalBase,
    dailyCapBase: totalBase,
    fundingBase: totalBase,
    missions: planned.map((m) => ({
      missionId: m.missionId,
      rewardBase: BigInt(m.rewardBase),
      maxCompletions: m.maxCompletions,
    })),
  });

  // ALREADY DONE? Checked so that a founder returning to an interrupted launch is not asked to
  // fund a vault they have already funded — the flow resumes at attaching instead.
  let deployed = false;
  try {
    await readVaultState(deployment.vaultAddress);
    deployed = true;
  } catch {
    /* not deployed yet, which is the normal case */
  }

  return NextResponse.json({
    ok: true,
    classHash,
    operator: cfg.accountAddress,
    token: cfg.tokenAddress,
    totalBase: totalBase.toString(),
    missions: planned,
    vaultAddress: deployment.vaultAddress,
    calls: deployment.calls,
    deployed,
  });
}

/**
 * POST /api/launch/<id>/starknet — attach a founder-deployed vault and take the campaign live.
 *
 * The founder's wallet deploys the vault, funds it, and writes each mission's terms into it. Sage
 * is not a party to any of that, which is the point: the contract's owner is the person who funded
 * it, and Sage only ever holds the operator key.
 *
 * SO THIS VERIFIES RATHER THAN TRUSTS. The address arrives from a browser, and a browser can send
 * anything. Before a campaign is created against it this reads the vault back off chain and
 * refuses unless it is genuinely a vault, genuinely owned by the caller, and genuinely names Sage's
 * operator — because a campaign attached to a contract Sage does not control would accept
 * submissions it can never pay, and one attached to a vault owned by someone else would let a
 * stranger revoke a founder's campaign.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;

  const owner = await getFounderAddress();
  if (!owner) {
    return NextResponse.json({ error: "Sign in to attach a vault." }, { status: 401 });
  }

  const cfg = starknetConfig();
  if (!cfg) {
    return NextResponse.json({ error: "Starknet settlement is not configured." }, { status: 503 });
  }

  let body: { vaultAddress?: unknown; ownerAddress?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const vaultAddress = typeof body.vaultAddress === "string" ? body.vaultAddress.trim() : "";
  const ownerAddress = typeof body.ownerAddress === "string" ? body.ownerAddress.trim() : "";
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(vaultAddress) || !/^0x[0-9a-fA-F]{1,64}$/.test(ownerAddress)) {
    return NextResponse.json({ error: "A vault and owner address are required." }, { status: 400 });
  }

  const plan = loadApprovedPlan(id);
  if (!plan) {
    return NextResponse.json({ error: "No approved plan for this inspection." }, { status: 404 });
  }

  // ATTACHING TWICE MUST NOT CREATE TWO CAMPAIGNS. The founder signs one transaction and then
  // tells Sage about it; a retry, a double-click or a reloaded tab can repeat that message. Two
  // campaigns on one vault would each treat the whole ceiling as theirs and together promise twice
  // what the vault can pay. Returning the existing campaign makes the retry harmless.
  const already = getCampaignByVault(vaultAddress);
  if (already) {
    return NextResponse.json({ ok: true, campaignId: already.id, vaultAddress, existing: true });
  }

  // READ THE CHAIN. Everything below is checked against the deployed contract, not the request.
  let state;
  try {
    state = await readVaultState(vaultAddress);
  } catch {
    return NextResponse.json(
      { error: "That address is not a Sage vault, or the network could not be reached." },
      { status: 400 },
    );
  }

  const missions = plan.plan.missions;
  for (const m of missions) {
    if (!m.missionIdHash) {
      // Settlement's fallback keys on the campaign's id, which does not exist yet — so guessing
      // one here could disagree with the felt actually looked up later. Refuse instead: every V2
      // plan carries this hash, and one that does not is not a plan this rail can honour.
      return NextResponse.json(
        { error: `"${m.title}" has no mission id, so its terms could not be matched on chain.` },
        { status: 400 },
      );
    }
  }

  // Read what the chain says about the money and the terms, then let the pure verifier decide.
  let balanceBase: bigint;
  const onChainMissions = new Map<string, MissionTerms>();
  try {
    balanceBase = await readVaultBalance(vaultAddress);
    for (const m of missions) {
      const felt = toFelt(m.missionIdHash as string);
      onChainMissions.set(felt, await readMission(vaultAddress, felt));
    }
  } catch {
    return NextResponse.json(
      { error: "Could not read the vault from Starknet. Try again in a moment." },
      { status: 502 },
    );
  }

  const verdict = verifyVaultBacksPlan({
    state,
    balanceBase,
    onChainMissions,
    sageOperator: cfg.accountAddress,
    claimedOwner: ownerAddress,
    missions: missions.map((m) => ({
      title: m.title,
      missionId: toFelt(m.missionIdHash as string),
      rewardBase: BigInt(m.rewardBase),
      maxCompletions: Number(m.maxCompletions),
    })),
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  const first = missions[0];
  const campaign = createCampaign({
    title: first?.title ?? "Private-capable campaign",
    descriptionMd: "",
    criteria: first?.criteria ?? [],
    conditionType: "approval",
    onchainCheck: null,
    rewardAmount: Number(first?.rewardBase ?? 0),
    maxRecipients: missions.reduce((n: number, m) => n + Number(m.maxCompletions), 0),
    vaultAddress,
    posterWallet: owner,
    ownerIsSage: false,
    status: "live",
    autonomy: "autopilot",
    chainId: STARKNET_MAINNET_KEY,
    settlementRail: "starknet",
    vaultKind: "sage_vault_starknet",
    campaignIdHash: plan.plan.campaignIdHash,
    missionPlanDigest: plan.plan.missionPlanDigest,
    commitmentVersion: 2,
  });

  for (const m of missions) {
    createMission({
      campaignId: campaign.id,
      missionKey: m.missionKey,
      missionIdHash: m.missionIdHash,
      specDigest: m.specDigest,
      title: m.title,
      objective: m.objective,
      instructions: m.instructions,
      targetSurface: m.targetSurface,
      criteria: m.criteria,
      evidenceList: m.evidenceRequirements,
      rewardAmount: Number(m.rewardBase),
      maxCompletions: Number(m.maxCompletions),
      // `active`, not `draft`: the vault already holds this mission's terms, so it can pay for it
      // the moment a submission is judged. A draft mission cannot settle.
      status: "active",
    });
  }

  recordEvent({
    campaignId: campaign.id,
    kind: "campaign_created",
    detail: `${campaign.title} · private-capable, vault ${vaultAddress.slice(0, 12)}…`,
  });

  return NextResponse.json({ ok: true, campaignId: campaign.id, vaultAddress });
}
