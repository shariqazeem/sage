import { getSessionAddress } from "@/lib/auth/session";
import { getDeputyOverview } from "@/lib/campaigns/overview";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your campaigns · Sage",
  description: "Every campaign you own, what your AI agent has released, and a link into each console.",
};

/**
 * `/dashboard` — the returning-founder home base for the V2 campaign flow. A founder
 * signs in with the wallet they launched from and sees EVERY campaign they own
 * (`getDeputyOverview` filters by `posterWallet`), what the Deputy has released, and
 * a link into each console — plus "Launch new." No fixtures: an unsigned visitor gets
 * a connect prompt, a signed founder with none gets a designed empty state.
 */
export default async function DashboardPage() {
  const wallet = await getSessionAddress();
  const overview = getDeputyOverview(wallet);
  return (
    <DashboardClient
      signedIn={!!wallet}
      address={wallet}
      campaigns={overview.campaigns}
      paidAmountBase={overview.paidAmountBase}
      approvedRecipients={overview.approvedRecipients}
      totalPaid={overview.totalPaid}
    />
  );
}
