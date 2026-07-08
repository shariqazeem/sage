import { NextResponse, type NextRequest } from "next/server";
import { getAddress } from "viem";
import { getSessionAddress } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isAddressLike, validateCampaignInput } from "@/lib/campaigns/validate";
import { sanitizeChatId } from "@/lib/telegram/format";
import { createCampaign, recordEvent } from "@/lib/db/campaigns";
import { getVaultOperator, getVaultOwner } from "@/lib/deputy/chain";
import { operatorAddress } from "@/lib/deputy/signer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a reward campaign. The poster is the authenticated wallet (never the
 * body). The funding vault is the poster's own (if supplied) or the seeded demo
 * vault; either way we verify ON-CHAIN that our operator can release from it —
 * otherwise every future payout would soft-reject and the campaign is a lie.
 */
export async function POST(req: NextRequest) {
  const wallet = await getSessionAddress();
  if (!wallet) {
    return NextResponse.json(
      { error: "Sign in with your wallet to create a campaign." },
      { status: 401 },
    );
  }

  const rl = rateLimit("create", clientIp(req.headers));
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = validateCampaignInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Resolve the funding vault: the poster's own, else the seeded demo vault.
  const demoVault = process.env.NEXT_PUBLIC_VAULT_ADDRESS;
  let vaultAddress: `0x${string}`;
  if (isAddressLike(body.vaultAddress)) {
    vaultAddress = getAddress(body.vaultAddress as string);
  } else if (demoVault) {
    vaultAddress = getAddress(demoVault);
  } else {
    return NextResponse.json({ error: "No funding vault available." }, { status: 400 });
  }

  // Our operator must be the vault's operator, or it can never release rewards.
  let operator: string, owner: string;
  try {
    [operator, owner] = await Promise.all([
      getVaultOperator(vaultAddress),
      getVaultOwner(vaultAddress),
    ]);
  } catch {
    return NextResponse.json(
      { error: "Could not read the funding vault on-chain." },
      { status: 400 },
    );
  }
  const ours = operatorAddress().toLowerCase();
  if (operator.toLowerCase() !== ours) {
    return NextResponse.json(
      { error: "Sage is not the operator of that vault, so it can't release rewards from it." },
      { status: 400 },
    );
  }

  const campaign = createCampaign({
    title: parsed.value.title,
    descriptionMd: parsed.value.descriptionMd,
    criteria: parsed.value.criteria,
    conditionType: "approval",
    onchainCheck: null,
    rewardAmount: parsed.value.rewardAmount,
    maxRecipients: parsed.value.maxRecipients,
    vaultAddress,
    posterWallet: wallet,
    ownerIsSage: owner.toLowerCase() === ours,
    status: "live",
    autonomy: parsed.value.autonomy,
    autopilotThreshold: parsed.value.autopilotThreshold,
    // optional public Telegram announce target (outbound only); null if invalid.
    announceChatId: sanitizeChatId(body.announceChatId),
  });

  recordEvent({
    campaignId: campaign.id,
    kind: "campaign_created",
    detail: campaign.title,
  });

  return NextResponse.json({ id: campaign.id, slug: campaign.id });
}
