import { defaultAutonomyFor } from "@/lib/campaigns/autonomy-default";
import { parseDirectTitle } from "@/lib/launch/direct-campaign";
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
import { getCampaignByVault } from "@/lib/db/campaigns";
import { recordEvent } from "@/lib/db/campaigns";
import { getFounderAddress } from "@/lib/auth/founder";
import { attachV2Campaign } from "@/lib/campaigns/v2-setup";
import { classifyVerifiability } from "@/lib/launch/validate-mission";
import { distillPrivateKey } from "@/lib/deputy/observation-verify";
import { explorationCounts } from "@/lib/launch/field-test";
import { readStarknetSnapshot } from "@/lib/starknet/vault-adapter";
import { getInspectionJob } from "@/lib/db/inspection";
import type { FieldTestSummary } from "@/lib/launch/schemas";

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

  /**
   * The vault is deployed NAMING the plan it is funded for, so attach can compare it against what
   * Sage derives independently. Refused rather than defaulted: a vault that names no plan can be
   * pointed at any plan afterwards, which is exactly what the agreement check exists to prevent.
   */
  if (!plan.plan.campaignIdHash || !plan.plan.missionPlanDigest) {
    return NextResponse.json(
      { error: "This plan has no on-chain identity, so a vault cannot be bound to it." },
      { status: 400 },
    );
  }

  const deployment = planVaultDeployment({
    campaignIdHash: plan.plan.campaignIdHash,
    missionPlanDigest: plan.plan.missionPlanDigest,
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
    /**
     * ONE MESSAGE FOR THREE VERY DIFFERENT SITUATIONS, and the founder hit the one it described
     * worst: the vault existed and was funded, it simply had not been accepted on chain yet when
     * this ran. "That address is not a Sage vault" told them their money had gone somewhere wrong.
     *
     * A retry is the remedy for a vault still landing, and it is safe: attaching is idempotent and
     * nothing here moves money. So this now says what to do rather than diagnosing wrongly.
     */
    return NextResponse.json(
      {
        error:
          "Sage could not read that vault yet. If you have just funded it, the transaction may still be landing — reload this page in a few seconds and it will pick up where it left off. Your funds are in the vault either way.",
        retryable: true,
      },
      { status: 400 },
    );
  }

  const job = getInspectionJob(id);
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

  /**
   * FROM HERE THE STARKNET RAIL RUNS THE SAME CODE AS GOAT.
   *
   * This used to call `createCampaign` and `createMission` directly, because `attachV2Campaign`
   * was viem-only and rejected a felt before it could start. Routing around it produced a campaign
   * that looked live and was structurally weaker in ways nobody could see from the outside: no
   * private corpus, so the judge had no answer key and autopay could never fire; no public campaign
   * id, so it never reached the marketplace; and neither the agreement check nor the public
   * identity invariant ever ran. A founder was told "your campaign is live" about something that
   * could not pay anyone.
   *
   * The shared path now takes both address families and reads the chain through one seam, so the
   * only Starknet-specific thing left here is which snapshot reader it uses.
   */
  const publicStrings = missions.flatMap((m) => [
    m.title,
    m.objective,
    m.instructions,
    m.targetSurface,
    ...(m.criteria ?? []),
    ...(m.evidenceRequirements ?? []),
  ]);
  const fieldTest =
    (job?.result as { map?: { fieldTest?: FieldTestSummary | null } } | undefined)?.map?.fieldTest ??
    null;
  // P16 — the distilled private answer key, pinned at the instant the plan locks. Sage's own
  // observations MINUS every public plan string, so a parrot of the card scores structural zero.
  const privateKey = distillPrivateKey(fieldTest, publicStrings);
  const explored = explorationCounts(fieldTest);

  const result = await attachV2Campaign(
    {
      publicCampaignId: plan.plan.publicCampaignId,
      // A direct campaign is titled by its OPERATOR, not by the product host — the first public gig
      // recorded "Testing campaign · sagepays.xyz" on this rail while the EVM runner already knew better.
      title: parseDirectTitle(job?.goal) ?? campaignTitle(job?.productUrl ?? ""),
      productUrl: job?.productUrl ?? "",
      chainId: STARKNET_MAINNET_KEY,
      expectedToken: cfg.tokenAddress,
      founderAddress: ownerAddress,
      operatorAddress: cfg.accountAddress,
      // The Cairo vault has no guardian; zero is what "none" means to the agreement check.
      guardian: "0x0000000000000000000000000000000000000000",
      // Provenance on Starknet is the class hash, checked by the adapter — there is no factory.
      factoryAddress: "0x0000000000000000000000000000000000000000",
      vaultAddress,
      missions: missions.map((m) => ({
        missionKey: m.missionKey,
        title: m.title,
        objective: m.objective,
        instructions: m.instructions,
        targetSurface: m.targetSurface,
        criteria: m.criteria,
        evidenceRequirements: m.evidenceRequirements,
        verifiabilityClass: m.verificationContract
          ? ("url-verifiable" as const)
          : classifyVerifiability({
              objective: m.objective,
              criteria: m.criteria,
              evidenceRequirements: m.evidenceRequirements,
            }),
        verificationContract: m.verificationContract,
        rewardBase: BigInt(m.rewardBase),
        maxCompletions: BigInt(m.maxCompletions),
      })),
      autonomy: defaultAutonomyFor(plan.plan.visibility),
      visibility: plan.plan.visibility,
      privateCorpus: privateKey.observations,
      privateCorpusDigest: privateKey.digest,
      privateCorpusSources: privateKey.distinctSources,
      exploredScreens: explored.screens,
      exploredElements: explored.elements,
      campaignKind: plan.plan.campaignKind,
      allowlist: plan.plan.allowlist,
      settlementRail: "starknet",
      vaultKind: "sage_vault_starknet",
    },
    { adapter: { readSnapshot: readStarknetSnapshot }, operatorAddress: () => cfg.accountAddress as `0x${string}` },
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: attachFailureMessage(result.stage, result.errors), stage: result.stage },
      { status: 400 },
    );
  }
  recordEvent({
    campaignId: result.campaignId,
    kind: "campaign_created",
    detail: `${parseDirectTitle(job?.goal) ?? campaignTitle(job?.productUrl ?? "")} · private-capable, vault ${vaultAddress.slice(0, 12)}…`,
  });

  return NextResponse.json({ ok: true, campaignId: result.campaignId, vaultAddress });
}

/** Titled by the product, exactly as the EVM rail titles it — not by whichever mission came first. */
function campaignTitle(productUrl: string): string {
  try {
    return `Testing campaign · ${new URL(productUrl).host}`;
  } catch {
    return "Sage testing campaign";
  }
}

/**
 * Say WHICH check refused, in words a founder can act on.
 *
 * The stages are not interchangeable: an agreement failure means the vault does not encode this
 * plan, which a retry cannot fix; a validation failure is about the plan itself. Collapsing them
 * into one message is how "that address is not a Sage vault" came to be shown about a vault that
 * was completely correct.
 */
function attachFailureMessage(stage: string, errors: string[]): string {
  const detail = errors.slice(0, 3).join(", ");
  if (stage === "agreement") {
    return `The vault on chain does not match this plan (${detail}). It cannot be attached to this campaign.`;
  }
  if (stage === "identity") {
    return `This plan's identity does not match the vault it was funded into (${detail}).`;
  }
  if (stage === "validation") return `This plan cannot be attached: ${detail}.`;
  return `Sage could not open the campaign (${detail}). Nothing was charged.`;
}
