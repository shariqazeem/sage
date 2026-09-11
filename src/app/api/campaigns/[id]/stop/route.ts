import { NextResponse } from "next/server";

import { getAddress } from "viem";
import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { ownsCampaign } from "@/lib/campaigns/review-actions";
import { getCampaign, resolveStoppedCampaignSubmissions, setCampaignStatus } from "@/lib/db/campaigns";
import { getAgentWalletByAddress } from "@/lib/db/agent-wallets";
import { stopCampaignViaPrivy } from "@/lib/privy/stop-campaign";
import { chainConfig, explorerTxUrl } from "@/lib/deputy/networks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/campaigns/<id>/stop — stop a campaign.
 *
 * Two owners, two signers. A vault the founder deployed from their OWN wallet is stopped by that
 * wallet in the console (revoke + withdrawRemaining, onlyOwner on-chain); this route then only
 * catalogues the row as cancelled. A vault the founder's ACCOUNT launched is owned by the account's
 * Privy wallet, so the browser wallet's revoke() would revert with NotAuthorized — measured
 * 2026-09-11: the console offered "Stop & withdraw" on an account-launched gig and the founder could
 * not stop it. For those, this route does the on-chain stop through the account (a scoped stop
 * policy, re-locked after), and the remaining USDC returns to the account, its vault owner.
 * Owner-gated either way: `ownsCampaign` knows the account's founder.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign) return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });

  const session = await getFounderAddress();
  if (!ownsCampaign(campaign, session)) {
    return NextResponse.json({ ok: false, error: "Not your campaign." }, { status: 403 });
  }

  // Launched from an account the founder holds: stop it through that account.
  const account = sameFounder(campaign.posterWallet, session) ? null : getAgentWalletByAddress(campaign.posterWallet);
  let viaAccount: { revokeTx: string | null; withdrawTx: string | null; recoveredBase: string; explorerUrl: string | null; alreadyRevoked: boolean } | null = null;
  if (account && campaign.vaultAddress && chainConfig(campaign.chainId).evm) {
    try {
      const r = await stopCampaignViaPrivy(account, getAddress(campaign.vaultAddress));
      const last = r.withdraw?.txHash ?? r.revoke?.txHash ?? null;
      viaAccount = {
        revokeTx: r.revoke?.txHash ?? null,
        withdrawTx: r.withdraw?.txHash ?? null,
        recoveredBase: r.recoveredBase.toString(),
        explorerUrl: last ? explorerTxUrl(campaign.chainId, last) : null,
        alreadyRevoked: r.alreadyRevoked,
      };
    } catch (e) {
      return NextResponse.json({ ok: false, error: `Could not stop it through your account: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` }, { status: 500 });
    }
  }

  setCampaignStatus(id, "cancelled");
  // Work still awaiting judgment can never be paid once the vault is revoked — resolve it with an
  // honest reason rather than leaving those testers reading "verifying" forever.
  const resolved = resolveStoppedCampaignSubmissions(id);
  return NextResponse.json({ ok: true, status: "cancelled", resolvedSubmissions: resolved, viaAccount });
}
