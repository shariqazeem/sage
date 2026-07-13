import {
  activeNetwork,
  getOperatorPayoutHistory,
  getOperatorVaultState,
  getOperatorVendorNames,
} from "@/lib/deputy/chain";
import { getSessionAddress } from "@/lib/auth/session";
import { getDeputyOverview } from "@/lib/campaigns/overview";
import { getAgentIdentity } from "@/lib/erc8004/identity";
import { getAgentPnL, getAgentReputation } from "@/lib/erc8004/reputation";
import { ensureFlagshipCampaign, feeTotals } from "@/lib/db/campaigns";
import { isX402Live } from "@/lib/x402/facilitator";
import { USDC_DECIMALS } from "@/lib/x402/facilitator";
import { redirect } from "next/navigation";
import { SageApp } from "@/components/app/sage-app";

export const dynamic = "force-dynamic";

/**
 * `/app` is the legacy V1 policy-vault "Deputy" console. The canonical founder
 * journey is now `/launch` (Sage inspects a product → designs paid missions →
 * founder funds a CampaignVaultV2). Ordinary visitors are sent to `/launch`;
 * the V1 console is preserved for existing records behind `?legacy=1` so no
 * historical vault becomes unreachable.
 */
export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ legacy?: string }>;
}) {
  const sp = await searchParams;
  if (sp.legacy !== "1") redirect("/launch");

  ensureFlagshipCampaign();
  const net = activeNetwork();
  const wallet = await getSessionAddress();

  const [vault, vendors] = await Promise.all([
    getOperatorVaultState("launch-growth"),
    getOperatorVendorNames("launch-growth"),
  ]);
  // Payout history reads the token's decimals from the vault we just read, so it
  // needs no extra token call. Resilient: [] if the log read fails.
  const history = await getOperatorPayoutHistory(
    "launch-growth",
    vault?.raw.decimals ?? 6,
  );
  // The Deputy's real state for the signed-in founder — their campaigns, live
  // submission counts, released totals, and the work journal. Empty if not a
  // signed-in poster (the UI shows a designed empty state, never fixtures).
  const overview = getDeputyOverview(wallet);
  const identity = getAgentIdentity();
  // The Deputy's grounded reputation — real settled payouts / blocks / decisions.
  const reputation = getAgentReputation();
  // x402 rail status for the Proof / Wallet surfaces — real, no simulation.
  const totals = feeTotals();
  const x402 = {
    live: isX402Live(),
    feesPaid: totals.paidCount,
    feesPaidUsd: totals.paidBase / 10 ** USDC_DECIMALS,
    feesPending: totals.pendingCount,
  };

  return (
    <SageApp
      x402={x402}
      vault={vault}
      vendors={vendors}
      overview={overview}
      identity={identity}
      reputation={reputation}
      pnl={getAgentPnL()}
      history={history}
      network={{
        name: net.name,
        chainId: net.chainId,
        explorer: net.blockExplorerUrl,
      }}
      vaultAddress={process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? null}
      usdcAddress={process.env.NEXT_PUBLIC_USDC_ADDRESS ?? null}
    />
  );
}
