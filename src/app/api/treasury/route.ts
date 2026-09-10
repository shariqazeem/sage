import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { createWebTreasury, listWebTreasuries } from "@/lib/treasury/web";
import { webTreasuryStatus } from "@/lib/treasury/launch";
import { isLaunchChain } from "@/lib/launch/deployment-service";
import { treasuryChainId } from "@/lib/privy/onboarding";
import { chainConfig } from "@/lib/deputy/networks";
import { accountUnavailableBecause as unavailableBecause } from "@/lib/treasury/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?chainId= — the founder's account on that chain (default: the mandate's chain), or { linked: false }. */
export async function GET(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const asked = Number(req.nextUrl.searchParams.get("chainId"));
  const chainId = Number.isFinite(asked) && asked > 0 ? asked : treasuryChainId();
  const status = await webTreasuryStatus(founder, chainId);
  const accounts = listWebTreasuries(founder).map((t) => ({ chainId: t.chainId, network: chainConfig(t.chainId).name, address: t.privyWalletAddress, isMainnet: chainConfig(t.chainId).isMainnet }));
  const because = unavailableBecause(founder);
  return NextResponse.json(
    status
      ? { linked: true, available: true, accounts, ...status }
      : { linked: false, available: because === null, reason: because, chainId, network: chainConfig(chainId).name, accounts },
  );
}

/** POST { perCampaignCapUsd, chainId? } — open the account on a chain (once per chain). */
export async function POST(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const because = unavailableBecause(founder);
  if (because === "starknet") return NextResponse.json({ error: "The account is a wallet Sage holds for you on an Ethereum-style chain, so it opens with an email or an Ethereum wallet sign-in. Your Starknet work is unaffected." }, { status: 400 });
  if (because === "unconfigured") return NextResponse.json({ error: "Accounts aren't configured on this deployment." }, { status: 503 });
  let body: { perCampaignCapUsd?: unknown; chainId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const cap = typeof body.perCampaignCapUsd === "number" && Number.isFinite(body.perCampaignCapUsd) ? body.perCampaignCapUsd : 50;
  const chainId = typeof body.chainId === "number" && Number.isFinite(body.chainId) ? body.chainId : treasuryChainId();
  if (!isLaunchChain(chainId)) return NextResponse.json({ error: "That chain is not one Sage opens accounts on here." }, { status: 400 });
  try {
    await createWebTreasury(founder, cap, chainId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "Could not open the account." }, { status: 500 });
  }
  const status = await webTreasuryStatus(founder, chainId);
  return NextResponse.json({ ok: true, linked: true, available: true, ...status });
}
