import { NextResponse } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { loadApprovedPlan } from "@/lib/launch/deployment-service";
import { readVaultState } from "@/lib/starknet/vault";
import { starknetConfig } from "@/lib/starknet/config";
import { STARKNET_MAINNET_KEY } from "@/lib/deputy/networks";
import { createCampaign, createMission } from "@/lib/db/campaigns";
import { recordEvent } from "@/lib/db/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const owner = await getSessionAddress();
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

  if (BigInt(state.operator) !== BigInt(cfg.accountAddress)) {
    // A vault naming someone else's operator would accept work Sage can never pay for.
    return NextResponse.json(
      { error: "That vault does not name Sage as its operator, so Sage could never pay from it." },
      { status: 400 },
    );
  }
  if (BigInt(state.owner) !== BigInt(ownerAddress)) {
    return NextResponse.json(
      { error: "That vault is owned by a different wallet than the one that deployed it." },
      { status: 400 },
    );
  }
  if (state.statusLabel !== "active") {
    return NextResponse.json(
      { error: `That vault is ${state.statusLabel}, so it cannot pay anyone yet.` },
      { status: 400 },
    );
  }

  const missions = plan.plan.missions;
  const totalBase = missions.reduce(
    (sum: bigint, m) => sum + BigInt(m.rewardBase) * BigInt(m.maxCompletions),
    BigInt(0),
  );
  if (state.budgetCeilingBase < totalBase) {
    // A ceiling below the plan means the last workers could never be paid — better to refuse now
    // than to accept submissions against a budget that runs out.
    return NextResponse.json(
      { error: "That vault's ceiling is lower than this plan's total budget." },
      { status: 400 },
    );
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
